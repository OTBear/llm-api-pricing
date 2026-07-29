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
```

Requires Python 3 with no external dependencies (standard library only).
