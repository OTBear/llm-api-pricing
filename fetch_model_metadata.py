"""
Maintains a "living" cache of per-model metadata - parameter count (in
billions) and OpenRouter/Artificial Analysis "intelligence index" score -
in model_metadata.json, alongside llm_pricing.json.

Unlike pricing_scraper.py, this does NOT re-fetch everything on every run.
It only looks up models that don't already have a cache entry (even a null
one - "we looked and found nothing" still counts as done), so it's safe to
run daily without hammering OpenRouter/Hugging Face for data that never
changes.

Sources (all public, no authentication required - verified by testing):
- https://openrouter.ai/api/frontend/v1/catalog/models - per-model catalog
  entries, including an optional `hf_slug` (Hugging Face model id) used to
  look up parameter counts.
- https://openrouter.ai/api/frontend/v1/rankings/benchmarks - Artificial
  Analysis intelligence index scores, keyed by an OpenRouter slug that
  OpenRouter itself resolves for us via `openrouter_slug` /
  `heuristic_openrouter_slug` - no need to build our own fuzzy matcher.
- https://huggingface.co/api/models/{hf_slug} - `safetensors.total` gives an
  exact parameter count for open-weight models. Closed models (GPT, Claude,
  Gemini) have no hf_slug and so get params_b = null, but can still get an
  intelligence_index since Artificial Analysis benchmarks those too.

Matching our own model IDs to OpenRouter's catalog slugs:
- provider "openrouter": our model IDs already ARE OpenRouter slugs (that's
  where pricing_scraper.py sources them from), so the match is exact.
- providers "anthropic"/"openai"/"google": OpenRouter's catalog uses its own
  slug per model (e.g. "anthropic/claude-opus-4.1" vs. our native
  "claude-opus-4-1"), so both sides are normalized (lowercased, everything
  but [a-z0-9] stripped) before comparing within that provider's namespace.
  Not every native model has an OpenRouter equivalent (preview/live/TTS
  variants, deprecated pins) - those simply get null metadata.
"""

import datetime
import json
import re
import sys
import time
import urllib.error
import urllib.request

HEADERS = {"User-Agent": "Mozilla/5.0 (pricing-scraper)"}

CATALOG_URL = "https://openrouter.ai/api/frontend/v1/catalog/models"
BENCHMARKS_URL = "https://openrouter.ai/api/frontend/v1/rankings/benchmarks"
HF_API_URL = "https://huggingface.co/api/models/{hf_slug}"

PRICING_FILE = "llm_pricing.json"
METADATA_FILE = "model_metadata.json"

HF_REQUEST_DELAY_SECONDS = 0.15

_NORMALIZE_RE = re.compile(r"[^a-z0-9]+")


def fetch_json(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def normalize(s):
    return _NORMALIZE_RE.sub("", s.lower())


def load_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def find_new_pairs(pricing, metadata):
    pairs = []
    for provider, models in pricing.items():
        have = metadata.get(provider, {})
        for model_id in models:
            if model_id not in have:
                pairs.append((provider, model_id))
    return pairs


def build_catalog_index(catalog_json):
    """Returns (slug -> entry, {provider: {normalized_name -> slug}}, {permaslug -> slug})."""
    by_slug = {}
    by_provider_normalized = {}
    by_permaslug = {}
    for entry in catalog_json.get("data", []):
        slug = entry.get("slug")
        if not slug or "/" not in slug:
            continue
        by_slug[slug] = entry
        provider, _, rest = slug.partition("/")
        by_provider_normalized.setdefault(provider, {})[normalize(rest)] = slug
        permaslug = entry.get("permaslug")
        if permaslug:
            by_permaslug[permaslug] = slug
    return by_slug, by_provider_normalized, by_permaslug


def build_intelligence_index(benchmarks_json, by_permaslug):
    """Returns {openrouter_slug -> score}, from the aaData.intelligence table.

    Prefers OpenRouter's own openrouter_slug/heuristic_openrouter_slug, and
    falls back to matching the benchmark entry's permaslug against the
    catalog's permaslug (both are dated/pinned identifiers, e.g.
    "qwen/qwen3.7-plus-20260602") when OpenRouter didn't resolve a slug
    itself - tested live, this alone recovers 35 of 96 entries that would
    otherwise be dropped (e.g. Qwen3.7 Plus, whose heuristic slug is null).
    """
    scores = {}
    entries = benchmarks_json.get("data", {}).get("aaData", {}).get("intelligence", [])
    for entry in entries:
        slug = (
            entry.get("openrouter_slug")
            or entry.get("heuristic_openrouter_slug")
            or by_permaslug.get(entry.get("permaslug"))
        )
        score = entry.get("score")
        if not slug or score is None:
            continue
        # Multiple dated benchmark runs can resolve to the same slug - keep the best.
        if slug not in scores or score > scores[slug]:
            scores[slug] = score
    return scores


def resolve_slug(provider, model_id, by_provider_normalized):
    if provider == "openrouter":
        return model_id
    return by_provider_normalized.get(provider, {}).get(normalize(model_id))


def fetch_params_b(hf_slug, hf_cache):
    if hf_slug in hf_cache:
        return hf_cache[hf_slug]
    try:
        time.sleep(HF_REQUEST_DELAY_SECONDS)
        data = fetch_json(HF_API_URL.format(hf_slug=hf_slug))
        total = (data.get("safetensors") or {}).get("total")
        params_b = round(total / 1_000_000_000, 1) if total else None
    except (urllib.error.URLError, urllib.error.HTTPError, ValueError, json.JSONDecodeError):
        params_b = None
    hf_cache[hf_slug] = params_b
    return params_b


def main():
    pricing = load_json(PRICING_FILE, {})
    metadata = load_json(METADATA_FILE, {})

    new_pairs = find_new_pairs(pricing, metadata)
    if not new_pairs:
        print("model metadata: nothing new, no requests made", file=sys.stderr)
        return

    print(f"model metadata: {len(new_pairs)} model(s) need lookup", file=sys.stderr)

    print("Fetching OpenRouter catalog...", file=sys.stderr)
    by_slug, by_provider_normalized, by_permaslug = build_catalog_index(fetch_json(CATALOG_URL))

    print("Fetching OpenRouter benchmarks...", file=sys.stderr)
    intelligence_by_slug = build_intelligence_index(fetch_json(BENCHMARKS_URL), by_permaslug)

    today = datetime.datetime.now(datetime.timezone.utc).date().isoformat()

    hf_cache = {}
    found_params = found_intel = 0
    for provider, model_id in new_pairs:
        slug = resolve_slug(provider, model_id, by_provider_normalized)

        intelligence_index = intelligence_by_slug.get(slug) if slug else None
        params_b = None
        catalog_entry = by_slug.get(slug) if slug else None
        if catalog_entry and catalog_entry.get("hf_slug"):
            params_b = fetch_params_b(catalog_entry["hf_slug"], hf_cache)

        if intelligence_index is not None:
            found_intel += 1
        if params_b is not None:
            found_params += 1

        metadata.setdefault(provider, {})[model_id] = {
            "params_b": params_b,
            "intelligence_index": intelligence_index,
            "updated": today,
        }

    print(
        f"model metadata: {found_intel} intelligence score(s), "
        f"{found_params} param count(s) found out of {len(new_pairs)} new model(s)",
        file=sys.stderr,
    )

    with open(METADATA_FILE, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2, ensure_ascii=False, sort_keys=True)
    print(f"Saved {METADATA_FILE}", file=sys.stderr)


if __name__ == "__main__":
    main()
