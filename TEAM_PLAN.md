# Team Plan: Trust Bubble Credibility Validator

This plan splits the hackathon work across 4 people: 2 frontend and 2 backend. The product should still feel like one smooth app, so everyone works around the same flow and API contract.

## Shared Product Flow

```text
User opens Facebook / web / social feed
-> Trust Bubble is available
-> user scrolls
-> app waits, no capture
-> user pauses for about 1.5 seconds
-> frontend captures visible post/page evidence
-> backend analyses text, links, OCR, author/page signals, and source risk
-> frontend shows Low / Medium / High risk
-> user taps bubble
-> frontend shows simple explanation and advice
```

User-facing labels:

- `Likely safe`
- `Needs checking`
- `Suspicious`
- `Cannot verify`

Risk colors:

- Low risk: green
- Medium risk: yellow
- High risk: red
- Cannot verify: grey/yellow

## Frontend 1: Android Trust Bubble

Owns the Android app and overlay experience.

Responsibilities:

- Build the Android app in Kotlin + Jetpack Compose.
- Create onboarding for Accessibility and overlay permissions.
- Detect scroll/pause behavior and wait about 1.5 seconds before scanning.
- Extract visible text from the screen using Accessibility Service first.
- Prepare for screenshot/OCR fallback, but keep manual scan working first.
- Group visible content into 1-3 likely post blocks.
- Call `POST /v1/assess` for each post candidate.
- Show a small floating Trust Bubble near the post.
- Let the user tap the bubble for `why` and `advice`.
- Keep fonts large, high contrast, and easy for elderly users.

Android first milestone:

```text
Manual "Check screen" button
-> captures visible accessibility text
-> sends one post/page payload to backend
-> shows Trust Bubble result
```

Android second milestone:

```text
Auto scan after scroll pause
-> detects top 1-3 visible post candidates
-> shows max 2-3 bubbles
```

## Frontend 2: Chrome / Chromium Extension

Owns the browser extension and fastest demo path.

Responsibilities:

- Build a Manifest V3 Chrome/Chromium extension.
- Add extension popup with current-page scan.
- Add right-click menu item: `Check credibility`.
- Extract page URL, title, selected text, visible article/post text, links, author/date hints.
- Call `POST /v1/assess`.
- Show result in popup using `label`, `riskLevel`, `why`, and `advice`.
- Add optional small in-page badge for selected text or main article/post.
- Add settings for backend API URL.
- Handle loading, backend unavailable, and cannot verify states.

Chrome first milestone:

```text
Select text
-> right click "Check credibility"
-> popup shows risk label, why, and advice
```

Chrome second milestone:

```text
Open any webpage
-> click extension
-> scan page
-> show result
```

## Backend 1: API / OpenAI Scoring

Owns the Cloudflare Worker endpoint and AI response quality.

Responsibilities:

- Maintain `POST /v1/assess`.
- Keep the OpenAI API key server-side only.
- Use OpenAI structured output matching `shared/credibility-contract.ts`.
- Improve the prompt for elderly-friendly risk explanations.
- Return stable fields for frontend:
  - `score`
  - `band`
  - `riskLevel`
  - `label`
  - `confidence`
  - `plainLanguageSummary`
  - `why`
  - `advice`
  - `evidenceFor`
  - `evidenceAgainst`
  - `missingSignals`
  - `recommendedAction`
- Ensure the model never invents hidden account age or private verification data.
- Keep raw post text out of logs.

Backend API first milestone:

```text
POST /v1/assess
-> validates request
-> calls OpenAI if configured
-> returns structured Trust Bubble result
```

Backend API second milestone:

```text
Better scoring prompt
-> scam language
-> source credibility
-> link mismatch
-> claim support
-> missing evidence
```

## Backend 2: Evidence Extraction / Risk Rules / QA

Owns deterministic checks, test samples, and backend reliability.

Responsibilities:

- Improve local heuristic fallback in `backend/src/scoring.ts`.
- Add deterministic rules before/after OpenAI:
  - urgent wording
  - suspicious links
  - link/domain mismatch
  - missing author/source
  - short/low-evidence posts
  - reels/video limitation note
- Build sample payloads for credible, suspicious, satire/opinion, missing-source, and reels cases.
- Add tests for scoring thresholds, validation, OpenAI failure fallback, and cannot verify cases.
- Verify Cloudflare Worker dry run and deployment setup.
- Document local setup and example requests.

Backend reliability first milestone:

```text
npm test
npm run typecheck
npx wrangler deploy --dry-run
```

Backend reliability second milestone:

```text
Sample request set
-> expected labels
-> expected risk levels
-> expected advice style
```

## API Contract Everyone Uses

Endpoint:

```text
POST /v1/assess
```

Example request:

```json
{
  "client": "android",
  "url": "https://example.com/post",
  "pageTitle": "Example post",
  "visibleText": "Visible claim or post text",
  "authorName": "Example Page",
  "authorHandle": "@example",
  "visibleProfileSignals": ["posted 2h ago", "verified badge visible"],
  "selectedText": "",
  "screenshotOcrText": "",
  "extractedLinks": [
    {
      "text": "official update",
      "href": "https://example.com/post",
      "source": "dom"
    }
  ],
  "imageCrop": {
    "description": "Optional cropped screenshot area for OCR and image-risk analysis.",
    "dataUrl": "data:image/png;base64,..."
  },
  "contentType": "post",
  "locale": "en-AU"
}
```

Example response:

```json
{
  "score": 38,
  "band": "red",
  "riskLevel": "high",
  "label": "Suspicious",
  "confidence": "medium",
  "plainLanguageSummary": "This post looks risky because it uses urgent wording and the source is unclear.",
  "why": [
    "The post asks you to act urgently.",
    "The link does not clearly match an official website.",
    "No trusted source is visible."
  ],
  "advice": "Do not click the link. Check the official website or ask someone you trust.",
  "evidenceFor": [],
  "evidenceAgainst": ["Urgent wording", "Unclear source"],
  "missingSignals": ["No clear account age", "No trusted source visible"],
  "recommendedAction": "Do not share yet."
}
```

## Integration Rules

- Frontend should display `label`, `riskLevel`, `why`, and `advice` first.
- Frontend can use `score` and `band` for color and sorting, but should not overemphasize the number.
- Backend should always return a usable response when possible, even if OpenAI is unavailable.
- Android and Chrome should not contain the OpenAI API key.
- If evidence is weak, use `Cannot verify` rather than guessing.
- Reels/video content in v1 should say video/audio was not fully analysed unless transcript/audio analysis is added later.

## Demo Order

1. Chrome extension checks selected text or a web post.
2. Backend returns Trust Bubble response.
3. Android prototype shows the same response style as an overlay.
4. Demo highlights elderly-friendly advice and the "Cannot verify" safety behavior.

