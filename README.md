# Credibility Validator Prototype

This workspace contains a split prototype for a social media/news credibility helper:

- `backend/` - Cloudflare Workers API that scores visible post/page evidence with OpenAI.
- `shared/` - API contract shared by both clients.

Per the current handoff scope, this repo stops after the shared contract and backend. The Chrome extension and Android app can be implemented next against the stable `/v1/assess` contract below.

The product is intentionally cautious: it produces a credibility estimate, not a final fact-check verdict. Missing public evidence is reported as missing instead of invented.

## Backend Quick Start

```powershell
cd backend
npm install
npm test
npm run dev
```

Set your OpenAI key locally in `backend/.dev.vars`:

```text
OPENAI_API_KEY=sk-your-key
OPENAI_MODEL=gpt-5
```

For production, store the key as a Cloudflare Worker secret:

```powershell
npx wrangler secret put OPENAI_API_KEY
```

## API Contract

`POST /v1/assess`

Example request:

```json
{
  "client": "chrome",
  "url": "https://example.com/news/story",
  "pageTitle": "Local flood warning issued",
  "visibleText": "The local council published evacuation routes...",
  "authorName": "Example News",
  "visibleProfileSignals": ["Named source", "Published date visible"],
  "locale": "en-AU",
  "contentType": "article"
}
```

Example response:

```json
{
  "score": 82,
  "band": "green",
  "confidence": "medium",
  "plainLanguageSummary": "This looks reasonably credible based on the visible source and wording.",
  "evidenceFor": ["A link or page address is available for checking."],
  "evidenceAgainst": [],
  "missingSignals": ["No account age is visible."],
  "recommendedAction": "Still read the full source before sharing."
}
```
