# Credibility Validator Backend

Cloudflare Workers API for scoring visible social media/news evidence.

## Commands

```powershell
npm install
npm test
npm run typecheck
npx wrangler deploy --dry-run
npm run dev
```

## Environment

Local development uses `backend/.dev.vars`:

```text
OPENAI_API_KEY=sk-your-key
OPENAI_MODEL=gpt-5
```

Production secret:

```powershell
npx wrangler secret put OPENAI_API_KEY
```

`OPENAI_MODEL` is configured in `wrangler.jsonc` and defaults to `gpt-5`.

## Endpoint

`POST /v1/assess`

Required:

- `client`: `android` or `chrome`
- At least one of `visibleText`, `selectedText`, `screenshotOcrText`, or `url`

Optional useful fields:

- `pageTitle`
- `authorName`
- `authorHandle`
- `visibleProfileSignals`
- `locale`
- `contentType`: `post`, `article`, `reel`, or `unknown`

The API returns `score`, `band`, `confidence`, `plainLanguageSummary`, `evidenceFor`, `evidenceAgainst`, `missingSignals`, and `recommendedAction`.

## Privacy

The Worker does not store raw post text. Runtime logs contain only request ID, client type, latency, result band, and error category.

## Fallback Behavior

If `OPENAI_API_KEY` is missing, or if the OpenAI call fails, the Worker returns a local heuristic assessment. This keeps the client usable during setup and makes local testing easier.

