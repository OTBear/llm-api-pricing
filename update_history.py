"""
Maintains a per-model price changelog under history/<provider>/..., and a
daily news log of what changed (news/log.jsonl).

Run this after pricing_scraper.py, in the same daily workflow step. It reads
the combined snapshot (llm_pricing.json) that script just produced and, for
every model, appends a line to history/<provider>/<model>.jsonl whenever the
price differs from the last recorded entry - so each file is a log of price
*changes* over time, not a dense daily snapshot.

Some model IDs (mostly on OpenRouter, e.g. "anthropic/claude-fable-5:batch")
contain characters that aren't safe as filenames. To avoid every consumer
having to re-derive the same sanitization rule, each provider gets an
history/<provider>/index.json mapping real model ID -> on-disk filename.

Each provider also gets history/<provider>/active.json, a snapshot of which
model IDs were present on the previous run - used only to detect models that
appeared or disappeared since then (index.json itself never shrinks, since
history should stay browsable for retired models).

news/log.jsonl gets one line per day that had at least one change: price
moves (with % change), new models, and removed models. Price changes are
listed first (biggest % move first), then new/removed models for Google,
OpenAI and Anthropic, then new/removed models for OpenRouter last - its
catalog churns constantly, so its arrivals/departures are the least
newsworthy part of the feed.
"""

import datetime
import json
import os
import re

SNAPSHOT_FILE = "llm_pricing.json"
HISTORY_DIR = "history"
NEWS_FILE = os.path.join("news", "log.jsonl")

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
    dirname = os.path.dirname(path)
    if dirname:
        os.makedirs(dirname, exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, sort_keys=True) + "\n")


def price_differs(last, entry):
    return last["input"] != entry["input"] or last["output"] != entry["output"]


def pct_change(old, new):
    if old == 0:
        return None
    return round((new - old) / old * 100, 1)


def price_change_events(provider, model_id, last, entry):
    events = []
    for field in ("input", "output"):
        old, new = last[field], entry[field]
        if old == new:
            continue
        events.append({
            "type": "price_up" if new > old else "price_down",
            "provider": provider,
            "model": model_id,
            "field": field,
            "old": old,
            "new": new,
            "pct": pct_change(old, new),
        })
    return events


def update_provider(provider, models, today):
    provider_dir = os.path.join(HISTORY_DIR, provider)
    index_path = os.path.join(provider_dir, "index.json")
    active_path = os.path.join(provider_dir, "active.json")

    index = {}
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            index = json.load(f)

    is_first_run = not os.path.exists(active_path)
    current_active = set(models.keys())
    if is_first_run:
        # Nothing to compare against yet - seed silently, no new/removed noise.
        previous_active = set(current_active)
    else:
        with open(active_path, "r", encoding="utf-8") as f:
            previous_active = set(json.load(f))

    used_paths = {rel_path: model_id for model_id, rel_path in index.items()}
    changed = 0
    events = []

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
            if model_id not in previous_active:
                events.append({
                    "type": "new", "provider": provider, "model": model_id,
                    "input": entry["input"], "output": entry["output"],
                })
        elif last["date"] == today:
            if price_differs(last, entry):
                rewrite_last_line(full_path, entry)
                events.extend(price_change_events(provider, model_id, last, entry))
                changed += 1
        elif price_differs(last, entry):
            append_line(full_path, entry)
            events.extend(price_change_events(provider, model_id, last, entry))
            changed += 1

    for model_id in sorted(previous_active - current_active):
        rel_path = index.get(model_id)
        last = read_last_entry(os.path.join(provider_dir, rel_path)) if rel_path else None
        events.append({
            "type": "removed", "provider": provider, "model": model_id,
            "last_input": last["input"] if last else None,
            "last_output": last["output"] if last else None,
        })

    os.makedirs(provider_dir, exist_ok=True)
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(index, f, indent=2, ensure_ascii=False, sort_keys=True)
    with open(active_path, "w", encoding="utf-8") as f:
        json.dump(sorted(current_active), f, indent=2, ensure_ascii=False)

    return changed, events


def write_news(today, events):
    entry = {"date": today, "events": events}
    last = read_last_entry(NEWS_FILE)
    if last is not None and last.get("date") == today:
        rewrite_last_line(NEWS_FILE, entry)
    else:
        append_line(NEWS_FILE, entry)


def main():
    with open(SNAPSHOT_FILE, "r", encoding="utf-8") as f:
        snapshot = json.load(f)

    today = datetime.datetime.now(datetime.timezone.utc).date().isoformat()

    price_events = []
    priority_new_removed = []
    openrouter_new_removed = []

    for provider, models in snapshot.items():
        changed, events = update_provider(provider, models, today)
        print(f"{provider}: {changed} price change(s) recorded for {today}")
        for e in events:
            if e["type"] in ("price_up", "price_down"):
                price_events.append(e)
            elif provider == "openrouter":
                openrouter_new_removed.append(e)
            else:
                priority_new_removed.append(e)

    price_events.sort(key=lambda e: abs(e["pct"]) if e["pct"] is not None else 0, reverse=True)
    priority_new_removed.sort(key=lambda e: (e["type"], e["provider"], e["model"]))
    openrouter_new_removed.sort(key=lambda e: (e["type"], e["model"]))

    all_events = price_events + priority_new_removed + openrouter_new_removed
    if all_events:
        write_news(today, all_events)
        print(f"news: {len(all_events)} event(s) recorded for {today}")
    else:
        print("news: no changes to report")


if __name__ == "__main__":
    main()
