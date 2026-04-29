# Credibility Validator Backend

Cloudflare Workers API for scoring visible social media/news evidence. The same scoring module can also run in Docker for quick backend-only testing.

## Commands

```powershell
npm install
npm test
npm run typecheck
npx wrangler deploy --dry-run
npm run dev
```

Backend-only Docker from the repo root:

```powershell
Copy-Item .env.example .env
docker compose up --build
Invoke-RestMethod http://localhost:5072/health
```

## Environment

Local development uses `backend/.dev.vars`:

```text
OPENAI_API_KEY=sk-your-key
OPENAI_MODEL=gpt-5.2
```

Production secret:

```powershell
npx wrangler secret put OPENAI_API_KEY
```

`OPENAI_MODEL` is configured in `wrangler.jsonc` and defaults to `gpt-5.2`.

## Endpoint

`GET /health`

Returns a small health payload for Docker, reverse proxies, and smoke tests.

`GET /v1/schema`

Returns a machine-readable summary of request fields, response fields, and public runtime limits.

`POST /v1/assess`

Required:

- `client`: `android` or `chrome`
- At least one of `visibleText`, `selectedText`, `screenshotOcrText`, `extractedLinks`, `imageCrop`, or `url`

Request rules:

- `Content-Type` must be `application/json`.
- Request body max defaults to `3,500,000` bytes.
- `imageCrop.dataUrl` must be PNG/JPEG/WebP base64 and decoded image bytes must be under about `1.8MB`.
- Invalid `contentType` values are ignored.

Optional useful fields:

- `pageTitle`
- `authorName`
- `authorHandle`
- `visibleProfileSignals`
- `accountContext`: optional visible poster profile details and recent visible post samples
- `extractedLinks`: links from DOM, OCR, visible text, or manual selection
- `imageCrop`: optional cropped screenshot data URL or description for OCR/image-risk analysis. Crop coordinates alone do not count as evidence.
- `consentToStoreEvidence`: must be `true` before self-host training evidence can be stored
- `consentLabel`: short consent/audit label, such as `training-qa-v1`
- `locale`
- `contentType`: `post`, `article`, `reel`, or `unknown`

The API returns `score`, `band`, `confidence`, `plainLanguageSummary`, `evidenceFor`, `evidenceAgainst`, `missingSignals`, and `recommendedAction`.

It also returns UI-ready risk fields:

- `riskLevel`: `low`, `medium`, `high`, or `unknown`
- `label`: `Likely safe`, `Needs checking`, `Suspicious`, or `Cannot verify`
- `why`: short explanation bullets for the tapped Trust Bubble
- `advice`: elderly-friendly next step

The Android and Chrome clients should show `riskLevel` and `label` in the floating bubble, then show `why` and `advice` after tap.

Optional storage response fields:

- `evidenceId`: returned only when evidence storage is enabled and the request includes consent.
- `storedEvidenceUrl`: protected self-host URL for later training/QA retrieval.

## Privacy

The Worker does not store raw post text. Runtime logs contain only request ID, client type, latency, result band, and error category.

## Fallback Behavior

If `OPENAI_API_KEY` is missing, or if the OpenAI call fails, the Worker returns a local heuristic assessment. This keeps the client usable during setup and makes local testing easier.

## Risk Pipeline

The API is optimized for a fast response:

```text
validate request
-> deterministic risk rules
-> optional OpenAI refinement with timeout
-> normalized elderly-friendly response
```

Runtime knobs:

- `OPENAI_TIMEOUT_MS`: defaults to `2500`; max `6000`.
- `OPENAI_ENABLE_VISION`: defaults to `false`. Keep this off for fast demos unless the client sends small cropped images and you specifically want model vision.
- `MAX_REQUEST_BYTES`: defaults to `3500000`.
- `OCR_ENABLED`: defaults to `false`. Docker/self-host only; Cloudflare Worker does not run local OCR.
- `OCR_ENGINE`: defaults to `tesseract`.
- `OCR_LANG`: defaults to `eng`.
- `OCR_TIMEOUT_MS`: defaults to `3000`; OCR failure does not fail assessment.
- `WEB_VERIFICATION_ENABLED`: defaults to `false`; enables requested web source checking.
- `WEB_VERIFICATION_TIMEOUT_MS`: defaults to `6000`; source checking failure does not fail assessment.

The deterministic rules cover:

- scam language: urgency, prizes, account verification, guaranteed cures, investment pressure
- account credibility: poster/profile match, account age/history, verification hints, and recent visible post patterns
- source credibility: visible author/profile signals, official-looking domains, suspicious domain patterns
- reputable source registry: common trusted domains and screenshot/logo cues for outlets such as Reuters, AP, BBC, ABC News, SBS, Guardian, NYT, Washington Post, Al Jazeera, WHO, and Australian Government sources
- link mismatch: shortened links, official wording pointing to unrelated domains, anchor text/domain mismatch
- claim verification: whether high-impact claims, including OCR-extracted screenshot claims, have supplied trusted source evidence
- AI-image suspicion: OCR/image descriptions that mention synthetic demos, AI generation, editing, deepfakes, manipulation, or before/after transformation claims

## Web Source Checking

Fast mode does not browse the web. If the client sends `verificationMode: "web"` and the server has `WEB_VERIFICATION_ENABLED=true`, the backend asks OpenAI's hosted web search tool to look for supporting or contradicting public sources.

Use this for a details view or an explicit "check sources" action, not for every feed scan:

```json
{
  "client": "chrome",
  "visibleText": "Example claim to verify",
  "verificationMode": "web"
}
```

The response may include `webVerification` with claim verdicts and source URLs. If search times out or is unavailable, the API still returns the normal risk assessment.

## OCR

The preferred fast path is still for Android/Chrome to send `screenshotOcrText` directly. The Docker self-host backend can also OCR `imageCrop.dataUrl` when enabled:

```text
OCR_ENABLED=true
OCR_ENGINE=tesseract
OCR_LANG=eng
OCR_TIMEOUT_MS=3000
```

The Docker image installs system Tesseract. OCR is best-effort: if Tesseract is unavailable, slow, or cannot read the image, the API continues using the visible text, links, image description, and optional OpenAI refinement. Cloudflare Worker deployment does not run backend OCR. OpenAI vision is separate from OCR: it only runs during model refinement when `OPENAI_ENABLE_VISION=true`.

OCR text is not just used to discover links. It is fed into the same scam-language, claim-verification, requested-action, and AI-image suspicion rules as visible post text. For example, a screenshot that says a wellness gel changed someone's face in 3 months can be flagged as an unsupported product/health transformation claim even when there is no clickable link in the image.

## Claim Verification

This backend does not claim to independently fact-check the internet in v1. It checks whether the claim is supported by evidence supplied in the request.

Examples:

- Health, emergency, finance, tax, police, legal, or recall claims need an official or established source domain.
- Product, wellness, skin, supplement, cure, anti-aging, or before/after claims extracted from OCR need trusted support too.
- Specific numbers, dates, or urgent instructions need a captured link/source.
- Claims that depend on an image are checked from OCR text and image descriptions, and synthetic/demo/AI-generated cues lower credibility.

If that evidence is missing, the response should say `Needs checking`, `Suspicious`, or `Cannot verify` instead of pretending the claim is true or false.

## Source Credibility

Source credibility is a visible-evidence score, not a reputation database. It considers:

- official domains such as `.gov.au`, `.edu.au`, `who.int`, `bom.gov.au`, and established news domains
- trusted screenshot/logo cues from the small reputable-source registry
- visible author/account names and profile signals
- verified/official profile hints supplied by the frontend
- risky domain patterns such as shortened links, punycode, IP-address links, or login/verify/prize-style domains

The frontend should capture as much source evidence as possible: page URL, post links, author name, author handle, verification badge text, account age text, and OCR text from screenshots.

A reputable logo/name in a screenshot raises credibility only when the rest of the evidence is consistent. It does not override synthetic/demo labels, edited-image cues, scam wording, or suspicious link behavior.

## Facebook Account Credibility

The backend does not scrape Facebook or access private posts. For a deeper Facebook account check, the frontend should capture what is visible to the user and send `accountContext`:

```json
{
  "accountContext": {
    "profileUrl": "https://www.facebook.com/example",
    "displayName": "Example Name",
    "handle": "@example",
    "bioText": "Visible bio text",
    "accountAgeText": "Joined 2018",
    "followerCountText": "4.2K followers",
    "verificationSignals": ["verified badge visible"],
    "recentPosts": [
      { "text": "Visible recent post text", "postedAtText": "Yesterday" }
    ]
  }
}
```

The response may include `accountCredibility` with `level`, `summary`, `signalsFor`, `signalsAgainst`, and `missingSignals`. This is designed for a "who posted this?" panel in the app.

## Evidence Storage For Training/QA

Self-host Docker can store opt-in evidence for later review. It is disabled by default and not used by the Cloudflare Worker path.

Required server env:

```text
EVIDENCE_STORAGE_ENABLED=true
EVIDENCE_STORAGE_DIR=/data/evidence
EVIDENCE_STORE_RAW_TEXT=false
EVIDENCE_HASH_SALT=change-me
EVIDENCE_ADMIN_TOKEN=long-random-token
```

## Container Assessment Logs

The self-host container writes one structured JSON line per assessment to stdout. TrueNAS and Docker show these in the container logs.

```sh
docker logs -f trustlens-backend
```

Set `ASSESSMENT_LOG_DETAIL` to control verbosity:

- `debug` logs the detailed safe result trace and is the TrueNAS default.
- `summary` logs request ID, safe source host, evidence types, score, band, label, risk signals, latency, OCR, and storage status.
- `off` disables assessment result logs.

Raw post text and image data are not written to runtime logs.

Required request fields:

```json
{
  "consentToStoreEvidence": true,
  "consentLabel": "training-qa-v1"
}
```

By default, stored records include metadata, text lengths, URL/domain hashes, result labels, and the image crop file if supplied. Raw post text is not stored unless `EVIDENCE_STORE_RAW_TEXT=true`; keep that off unless you have explicit consent and a retention process.

Protected training endpoints:

```text
GET /v1/evidence
GET /v1/evidence/{evidenceId}
GET /v1/evidence/{evidenceId}/image
Authorization: Bearer <EVIDENCE_ADMIN_TOKEN>
```

Examples:

```sh
curl -H "Authorization: Bearer $EVIDENCE_ADMIN_TOKEN" http://localhost:5072/v1/evidence
curl -H "Authorization: Bearer $EVIDENCE_ADMIN_TOKEN" http://localhost:5072/v1/evidence/<id>
curl -H "Authorization: Bearer $EVIDENCE_ADMIN_TOKEN" http://localhost:5072/v1/evidence/<id>/image --output crop.png
```
