"""
Maintains a per-model price changelog under history/<provider>/...

Run this after pricing_scraper.py, in the same daily workflow step. It reads
the combined snapshot (llm_pricing.json) that script just produced and, for
every model, appends a line to history/<provider>/<model>.jsonl whenever the
price differs from the last recorded entry - so each file is a log of price
*changes* over time, not a dense daily snapshot.

Some model IDs (mostly on OpenRouter, e.g. "anthropic/claude-fable-5:batch")
contain characters that aren't safe as filenames. To avoid every consumer
having to re-derive the same sanitization rule, each provider gets an
history/<provider>/index.json mapping real model ID -> on-disk filename.
"""

import datetime
import json
import os
import re

SNAPSHOT_FILE = "llm_pricing.json"
HISTORY_DIR = "history"

_UNSAFE_CHARS = re.compile(r"[^A-Za-z0-9._-]+")


def sanitize_segment(segment):
    return _UNSAFE_CHARS.sub("_", segment).strip("_") or "_"


def model_rel_path(model_id, used_paths):
    """Turns a model ID into a filesystem-safe relative .jsonl path, avoiding
    collisions between different IDs that sanitize to the same string."""
    segments = [sanitize_segment(s) for s in model_id.split("/")]
    base = "/".join(segments) + ".jsonl"
    rel_path = base
    n = 2
    while rel_path in used_paths and used_paths[rel_path] != model_id:
        rel_path = base[: -len(".jsonl")] + "-" + str(n) + ".jsonl"
        n += 1
    used_paths[rel_path] = model_id
    return rel_path


def read_last_entry(path):
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        lines = [line for line in f if line.strip()]
    return json.loads(lines[-1]) if lines else None


def rewrite_last_line(path, entry):
    with open(path, "r", encoding="utf-8") as f:
        lines = [line for line in f if line.strip()]
    lines[-1] = json.dumps(entry, sort_keys=True) + "\n"
    with open(path, "w", encoding="utf-8") as f:
        f.writelines(lines)


def append_line(path, entry):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, sort_keys=True) + "\n")


def price_differs(last, entry):
    return last["input"] != entry["input"] or last["output"] != entry["output"]


def update_provider(provider, models, today):
    provider_dir = os.path.join(HISTORY_DIR, provider)
    index_path = os.path.join(provider_dir, "index.json")

    index = {}
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            index = json.load(f)

    used_paths = {rel_path: model_id for model_id, rel_path in index.items()}
    changed = 0

    for model_id in sorted(models):
        price = models[model_id]
        rel_path = index.get(model_id)
        if rel_path is None:
            rel_path = model_rel_path(model_id, used_paths)
            index[model_id] = rel_path

        full_path = os.path.join(provider_dir, rel_path)
        entry = {"date": today, "input": price["input"], "output": price["output"]}
        last = read_last_entry(full_path)

        if last is None:
            append_line(full_path, entry)
            changed += 1
        elif last["date"] == today:
            if price_differs(last, entry):
                rewrite_last_line(full_path, entry)
                changed += 1
        elif price_differs(last, entry):
            append_line(full_path, entry)
            changed += 1

    os.makedirs(provider_dir, exist_ok=True)
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(index, f, indent=2, ensure_ascii=False, sort_keys=True)

    return changed


def main():
    with open(SNAPSHOT_FILE, "r", encoding="utf-8") as f:
        snapshot = json.load(f)

    today = datetime.datetime.now(datetime.timezone.utc).date().isoformat()

    for provider, models in snapshot.items():
        changed = update_provider(provider, models, today)
        print(f"{provider}: {changed} price change(s) recorded for {today}")


if __name__ == "__main__":
    main()
