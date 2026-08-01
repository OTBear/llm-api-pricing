# llm-api-pricing

A daily-updated snapshot of LLM API pricing for **Google Gemini**, **OpenAI**, **Anthropic (Claude)**, and **OpenRouter**, scraped directly from each provider's official pricing docs (and OpenRouter's public models API). Meant to be pulled straight into your own scripts/dashboards instead of hardcoding prices that go stale.

Data is regenerated every day via [GitHub Actions](.github/workflows/update-pricing.yml) by [`pricing_scraper.py`](pricing_scraper.py).

**Live table:** https://otbear.github.io/llm-api-pricing/

## Schema

All prices are **USD per 1,000,000 tokens**, at each provider's standard (non-batch, non-priority) tier.

```json
{
  "provider": {
    "api-model-name": {
      "input": 0.00,
      "output": 0.00
    }
  }
}
```

- `input` — price per 1M input tokens
- `output` — price per 1M output tokens

## Files

| File | Description |
| --- | --- |
| [`llm_pricing.json`](llm_pricing.json) | Combined file, all providers: `{ "provider": { "model": { "input", "output" } } }` |
| [`google.json`](google.json) | Google Gemini models only: `{ "model": { "input", "output" } }` |
| [`openai.json`](openai.json) | OpenAI models only |
| [`anthropic.json`](anthropic.json) | Anthropic (Claude) models only |
| [`openrouter.json`](openrouter.json) | Models available through OpenRouter, keyed by their `provider/model` slug |

Use the raw file URLs to pull data directly into a script, e.g.:

```
https://raw.githubusercontent.com/OTBear/llm-api-pricing/main/llm_pricing.json
https://raw.githubusercontent.com/OTBear/llm-api-pricing/main/openai.json
```

```python
import requests

pricing = requests.get(
    "https://raw.githubusercontent.com/OTBear/llm-api-pricing/main/llm_pricing.json"
).json()

print(pricing["anthropic"]["claude-sonnet-5"])
# {'input': 2.0, 'output': 10.0}
```

## Price history

`history/<provider>/` holds a changelog per model, updated daily by [`update_history.py`](update_history.py):

- `history/<provider>/index.json` maps each model ID to its on-disk file, e.g. `{ "gpt-5": "gpt-5.jsonl" }`. Needed because some IDs (mostly on OpenRouter, e.g. `anthropic/claude-fable-5:batch`) contain characters that aren't safe as filenames.
- `history/<provider>/<model>.jsonl` is [JSON Lines](https://jsonlines.org/): one `{"date": "2026-08-01", "input": 1.25, "output": 10.0}` object per line. A new line is only added when the price actually changes, so this is a changelog of price *changes*, not a daily snapshot — treat gaps between dates as "price unchanged."
- `history/<provider>/active.json` is internal bookkeeping (which model IDs existed on the last run, used to detect new/removed models) — not something you need to read directly.

On the [live table](https://otbear.github.io/llm-api-pricing/), click any model to see its price history charted on `model.html?provider=<provider>&model=<model>`.

## News feed

[`news/log.jsonl`](news/log.jsonl) is a daily digest of what changed, also written by `update_history.py`: one line per day that had at least one change, e.g.

```json
{"date": "2026-08-02", "events": [
  {"type": "price_up", "provider": "openai", "model": "gpt-5", "field": "output", "old": 10.0, "new": 12.0, "pct": 20.0},
  {"type": "new", "provider": "google", "model": "gemini-4-flash", "input": 0.5, "output": 2.0},
  {"type": "removed", "provider": "anthropic", "model": "claude-opus-4-1", "last_input": 15.0, "last_output": 75.0}
]}
```

`type` is `price_up`, `price_down`, `new`, or `removed`. Within a day, events are ordered price changes first (biggest `%` move first), then new/removed models for Google, OpenAI and Anthropic, then new/removed models for OpenRouter last — its catalog changes constantly, so its arrivals/departures are the least newsworthy part of the feed. The [live table](https://otbear.github.io/llm-api-pricing/) shows the latest day's changes at the top (collapsed, with a "show all" toggle); the full log is browsable on `news.html`.

## Sources

- Google Gemini: [ai.google.dev/gemini-api/docs/pricing](https://ai.google.dev/gemini-api/docs/pricing)
- OpenAI: [developers.openai.com/api/docs/pricing](https://developers.openai.com/api/docs/pricing)
- Anthropic: [platform.claude.com/docs/en/about-claude/pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- OpenRouter: [openrouter.ai/api/v1/models](https://openrouter.ai/api/v1/models)

## Scope and limitations

- Only plain text input/output token pricing is included. Per-image, per-second (audio/video/TTS), per-character, and per-request pricing (image/video generation, transcription, web search, etc.) is not represented.
- Pricing reflects each provider's standard tier; Batch, Flex, and Priority tiers are not included.
- OpenRouter data comes from its models API, which covers chat/completion models only — reranker and embedding-only listings (e.g. `voyageai/rerank-2.5-lite`) are not included, since those only exist on the client-rendered `openrouter.ai/models` page.
- Anthropic model display names (e.g. "Claude Opus 4.1") are mapped to their API IDs via a lookup table in the script, since the pricing page doesn't list API IDs directly.

## Running it yourself

```
python pricing_scraper.py
python update_history.py
```

Requires Python 3 with no external dependencies (standard library only).
