# Credibility Validator Prototype

This workspace contains a split prototype for a social media/news credibility helper:

- `backend/` - Cloudflare Workers API that scores visible post/page evidence with OpenAI.
- `shared/` - API contract shared by both clients.
- `TEAM_PLAN.md` - 4-person split: 2 frontend roles and 2 backend roles.
- `deploy/truenas/` - Docker Compose self-hosting plan for `trustlens.z2hs.au:5072`.

Per the current handoff scope, this repo stops after the shared contract and backend. The Chrome extension and Android app can be implemented next against the stable `/v1/assess` contract below.

The product is intentionally cautious: it produces a credibility estimate, not a final fact-check verdict. Missing public evidence is reported as missing instead of invented.

## Target User Flow

```text
User opens Facebook/web feed
-> Trust Bubble appears
-> user scrolls
-> app waits, no capture
-> user pauses for about 1.5 seconds
-> capture visible post area
-> extract text, image/OCR text, and links
-> backend analyses scam language, source signals, link mismatch, and visible evidence
-> bubble shows Low / Medium / High risk
-> user taps bubble for a simple explanation and advice
```

Post labels:

- `Likely safe`
- `Needs checking`
- `Suspicious`
- `Cannot verify`

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
  "riskLevel": "low",
  "label": "Likely safe",
  "confidence": "medium",
  "plainLanguageSummary": "This looks reasonably credible based on the visible source and wording.",
  "why": [
    "A link or page address is available for checking.",
    "No strong scam or urgency warning signs were found in the readable text."
  ],
  "advice": "Still read the full source before sharing.",
  "evidenceFor": ["A link or page address is available for checking."],
  "evidenceAgainst": [],
  "missingSignals": ["No account age is visible."],
  "recommendedAction": "Still read the full source before sharing."
}
```

High-risk example explanation:

```text
Risk: High
Label: Suspicious

Why:
1. The post asks you to act urgently.
2. The link does not match the official website.
3. No trusted source confirms this claim.

Advice:
Do not click the link. Ask a family member or check the official website.
```
