"""
Fetches current LLM pricing from Google Gemini, OpenAI, Anthropic (Claude)
and OpenRouter, and saves it as JSON.

Combined output (llm_pricing.json):
{
    "provider": {
        "api-model-name": {
            "input": 0.00,   # USD per 1M input tokens
            "output": 0.00   # USD per 1M output tokens
        }
    }
}

In addition, one flat file per provider is written (e.g. google.json):
{
    "api-model-name": {
        "input": 0.00,
        "output": 0.00
    }
}

Note on openrouter.ai/models: the page is client-side rendered (Next.js), so a
plain HTML fetch contains no data at all - confirmed by testing, including on
individual model pages (even the ".md" variant just returns the JS app shell,
unlike the docs.*/developers.* sites used for the other providers). The same
data that fills that page is served by the public API below, using the same
"provider/model" slugs shown in the page's links (e.g. "openai/gpt-5"). That
API only covers chat/completion models (~367 at the time of writing) - it does
not include reranker/embedding-only listings (e.g. "voyageai/rerank-2.5-lite"),
which only exist in the client-rendered page and would require a headless
browser (e.g. Playwright) to scrape. Given the added dependency and fragility,
this script intentionally sticks to the API and skips those.
"""

import json
import re
import sys
import urllib.request

HEADERS = {"User-Agent": "Mozilla/5.0 (pricing-scraper)"}

GEMINI_URL = "https://ai.google.dev/gemini-api/docs/pricing.md.txt"
OPENAI_URL = "https://developers.openai.com/api/docs/pricing.md"
CLAUDE_PRICING_URL = "https://platform.claude.com/docs/en/about-claude/pricing.md"
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/models"

COMBINED_OUTPUT_FILE = "llm_pricing.json"
PROVIDER_OUTPUT_FILE = "{provider}.json"


def fetch(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8")


def first_price(cell):
    """Extracts the first USD amount from a table cell, e.g. '$1.50, prompts...' -> 1.50."""
    m = re.search(r"\$(\d+(?:\.\d+)?)", cell)
    return float(m.group(1)) if m else None


def split_row(line):
    """Splits a markdown table row '| a | b | c |' into a list of cells."""
    cells = line.strip().split("|")
    if cells and cells[0].strip() == "":
        cells = cells[1:]
    if cells and cells[-1].strip() == "":
        cells = cells[:-1]
    return [c.strip() for c in cells]


def parse_md_tables(text):
    """Returns all markdown pipe tables in the text as (header_cells, [row_cells, ...])."""
    lines = text.splitlines()
    tables = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.strip().startswith("|") and i + 1 < len(lines) and re.match(
            r"^\s*\|[\s:\-|]+\|\s*$", lines[i + 1]
        ):
            header = split_row(line)
            i += 2
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append(split_row(lines[i]))
                i += 1
            tables.append((header, rows))
        else:
            i += 1
    return tables


# ---------------------------------------------------------------------------
# Gemini
# ---------------------------------------------------------------------------

def parse_gemini(text):
    models = {}
    sections = re.split(r"\n## ", text)[1:]
    for section in sections:
        title, _, body = section.partition("\n")
        if title.strip().lower() in ("notes", "pricing for tools", "pricing for agents"):
            continue

        ids = re.findall(r"`([a-zA-Z0-9][a-zA-Z0-9.\-]*)`", body.split("\n\n", 1)[0])
        if not ids:
            continue

        # Restrict to the "Standard" tier (the first one), skipping Batch/Flex/Priority.
        standard_block = re.split(r"\n### (?:Batch|Flex|Priority)\b", body)[0]

        input_price = output_price = None
        for line in standard_block.splitlines():
            stripped = line.strip()
            if stripped.startswith("| Input price"):
                cells = split_row(stripped)
                if len(cells) >= 3:
                    input_price = first_price(cells[2])
            elif stripped.startswith("| Output price"):
                cells = split_row(stripped)
                if len(cells) >= 3:
                    output_price = first_price(cells[2])

        if input_price is None and output_price is None:
            continue

        for model_id in ids:
            models[model_id] = {
                "input": input_price if input_price is not None else 0.0,
                "output": output_price if output_price is not None else 0.0,
            }
    return models


# ---------------------------------------------------------------------------
# OpenAI
# ---------------------------------------------------------------------------

def clean_openai_name(name):
    return re.sub(r"\s*\(.*?\)\s*$", "", name).strip()


def parse_openai(text):
    models = {}
    tables = parse_md_tables(text)

    chat_header = [
        "Model", "Short context input", "Short context cached input",
        "Short context cache writes", "Short context output",
        "Long context input", "Long context cached input",
        "Long context cache writes", "Long context output",
    ]
    specialized_header = ["Category", "Model", "Input", "Cached input", "Output"]

    for header, rows in tables:
        if header == chat_header:
            for row in rows:
                name = clean_openai_name(row[0])
                inp = first_price(row[1])
                out = first_price(row[4])
                if inp is None:
                    continue
                models[name] = {"input": inp, "output": out if out is not None else 0.0}

        elif header == specialized_header:
            categories = {r[0] for r in rows}
            if not ({"ChatGPT", "Embedding"} & categories):
                continue  # Batch/Priority variant of the same table shape - skip it.
            for row in rows:
                name = clean_openai_name(row[1])
                if row[2].strip().lower() == "free":
                    inp = 0.0
                else:
                    inp = first_price(row[2])
                if inp is None:
                    continue
                out = first_price(row[4])
                models[name] = {"input": inp, "output": out if out is not None else 0.0}

    return models


# ---------------------------------------------------------------------------
# Claude
# ---------------------------------------------------------------------------

CLAUDE_NAME_TO_ID = {
    "claude fable 5": "claude-fable-5",
    "claude mythos 5": "claude-mythos-5",
    "claude opus 5": "claude-opus-5",
    "claude opus 4.8": "claude-opus-4-8",
    "claude opus 4.7": "claude-opus-4-7",
    "claude opus 4.6": "claude-opus-4-6",
    "claude opus 4.5": "claude-opus-4-5",
    "claude opus 4.1": "claude-opus-4-1",
    "claude opus 4": "claude-opus-4-0",
    "claude sonnet 5": "claude-sonnet-5",
    "claude sonnet 4.6": "claude-sonnet-4-6",
    "claude sonnet 4.5": "claude-sonnet-4-5",
    "claude sonnet 4": "claude-sonnet-4-0",
    "claude haiku 4.5": "claude-haiku-4-5",
    "claude haiku 3.5": "claude-3-5-haiku-latest",
}
# Longest keys first, so e.g. "claude opus 4.5" is matched before "claude opus 4".
_CLAUDE_KEYS_BY_LEN = sorted(CLAUDE_NAME_TO_ID, key=len, reverse=True)


def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def claude_model_id(raw_name):
    # Strip markdown links '[text](url)' and any parentheses left empty behind them.
    cleaned = re.sub(r"\[.*?\]\(.*?\)", "", raw_name)
    cleaned = re.sub(r"\(\s*\)", "", cleaned).strip()
    lowered = cleaned.lower()
    for key in _CLAUDE_KEYS_BY_LEN:
        if lowered.startswith(key):
            rest = lowered[len(key):]
            if rest == "" or not rest[0].isdigit():
                return CLAUDE_NAME_TO_ID[key]
    # Unknown model (not yet in the mapping above) - best-effort fallback slug.
    return slugify(cleaned)


def parse_claude(text):
    models = {}
    tables = parse_md_tables(text)
    price_header = [
        "Model", "Base Input Tokens", "5m Cache Writes",
        "1h Cache Writes", "Cache Hits & Refreshes", "Output Tokens",
    ]
    for header, rows in tables:
        if header != price_header:
            continue
        for row in rows:
            model_id = claude_model_id(row[0])
            inp = first_price(row[1])
            out = first_price(row[5])
            if inp is None or out is None:
                continue
            if model_id in models:
                continue  # First match wins (e.g. Sonnet 5's introductory price row).
            models[model_id] = {"input": inp, "output": out}
        break
    return models


# ---------------------------------------------------------------------------
# OpenRouter
# ---------------------------------------------------------------------------

def parse_openrouter(raw_json):
    data = json.loads(raw_json).get("data", [])
    models = {}
    for entry in data:
        model_id = entry.get("id")
        pricing = entry.get("pricing") or {}
        prompt = pricing.get("prompt")
        completion = pricing.get("completion")
        if not model_id or prompt is None or completion is None:
            continue
        try:
            inp = float(prompt) * 1_000_000
            out = float(completion) * 1_000_000
        except ValueError:
            continue
        models[model_id] = {"input": round(inp, 6), "output": round(out, 6)}
    return models


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    result = {}

    print("Fetching Gemini pricing...", file=sys.stderr)
    result["google"] = parse_gemini(fetch(GEMINI_URL))

    print("Fetching OpenAI pricing...", file=sys.stderr)
    result["openai"] = parse_openai(fetch(OPENAI_URL))

    print("Fetching Claude pricing...", file=sys.stderr)
    result["anthropic"] = parse_claude(fetch(CLAUDE_PRICING_URL))

    print("Fetching OpenRouter pricing...", file=sys.stderr)
    result["openrouter"] = parse_openrouter(fetch(OPENROUTER_API_URL))

    with open(COMBINED_OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False, sort_keys=True)
    print(f"Saved combined pricing to {COMBINED_OUTPUT_FILE}", file=sys.stderr)

    for provider, models in result.items():
        path = PROVIDER_OUTPUT_FILE.format(provider=provider)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(models, f, indent=2, ensure_ascii=False, sort_keys=True)
        print(f"{provider}: {len(models)} models -> {path}", file=sys.stderr)


if __name__ == "__main__":
    main()
