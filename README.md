# TrustLens

TrustLens is an Android-first credibility companion for social feeds, screenshots, links, and fast-moving claims. It waits for the user to pause, captures the visible context they are looking at, and returns a plain-language risk label before a scam, hoax, or panic-share gets a chance to travel.

[Open the homepage](https://trustlens.z2hs.au) · [Download the Android APK](https://github.com/PatrickTHZ/TeamOpenSpot-OpenAIHackathon/releases/latest/download/trustlens-debug.apk) · [View the public GitHub build](https://github.com/PatrickTHZ/TeamOpenSpot-OpenAIHackathon/actions/workflows/android-apk.yml) · [Open the repository](https://github.com/PatrickTHZ/TeamOpenSpot-OpenAIHackathon)

## Why It Matters

TrustLens is built for the moment when someone sees an urgent post, a miracle product, a suspicious link, or a screenshot that looks official enough to share. Instead of pretending to be an all-knowing fact checker, it looks at the evidence the user can actually see and explains what is supported, what is missing, and what deserves caution.

The product is intentionally careful: it produces a credibility estimate, not a final verdict. Missing public evidence is reported as missing instead of invented.

## What Is Included

- `backend/` - TypeScript Cloudflare Workers API and Docker self-host server.
- `backend/android/` - Android accessibility-service prototype that can be built into an APK.
- `shared/` - Shared assessment contract for Android, Chrome, and future clients.
- `docs/API.md` - API fields, examples, source checking, and storage reference.
- `deploy/truenas/` - TrueNAS-ready Docker Compose deployment for `trustlens.z2hs.au`.
- `.github/workflows/android-apk.yml` - Android SDK build that publishes `trustlens-debug.apk` as a workflow artifact and attaches it to tagged releases.
- `.github/workflows/docker-image.yml` - Docker image build for GHCR.

## Try The Landing Page

The Docker self-host server now serves a TrustLens landing page at `/`, using the TrustLens cream, teal, lavender, and navy palette from the brand direction.

```powershell
Copy-Item .env.example .env
docker compose up --build
```

Public homepage:

```text
https://trustlens.z2hs.au
```

Local preview:

```text
http://localhost:5072
```

Health check:

```powershell
Invoke-RestMethod http://localhost:5072/health
```

The homepage and API share the same service without colliding: `/` serves the landing page, while `/v1/assess`, `/v1/schema`, `/v1/evidence`, and `/health` remain API and monitoring routes.

## Download The APK

The stable public download URL is:

```text
https://github.com/PatrickTHZ/TeamOpenSpot-OpenAIHackathon/releases/latest/download/trustlens-debug.apk
```

To publish a new public APK:

```powershell
git tag v0.1.0
git push origin v0.1.0
```

GitHub Actions will build `backend/android`, upload the APK artifact, and attach `trustlens-debug.apk` to the GitHub release for that tag.

## Android Build

The Android project uses the Android Gradle Plugin and is built by GitHub Actions with Java 17, the Android SDK, and Gradle.

Local build, if Android tooling is installed:

```powershell
gradle -p backend/android assembleDebug
```

Output:

```text
backend/android/app/build/outputs/apk/debug/app-debug.apk
```

## User Flow

```text
User opens Facebook or a web feed
-> TrustLens appears
-> user scrolls
-> app waits without capture
-> user pauses for about 1.5 seconds
-> app captures visible post area
-> app extracts text, image/OCR text, and links
-> backend analyses scam language, source signals, link mismatch, and visible evidence
-> TrustLens shows Low / Medium / High risk
-> user taps for a simple explanation and next step
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
OPENAI_MODEL=gpt-5.2
OPENAI_TIMEOUT_MS=2500
OPENAI_ENABLE_VISION=false
```

For production, store the key as a Cloudflare Worker secret:

```powershell
npx wrangler secret put OPENAI_API_KEY
```

## Docker API

The same TypeScript scoring stack runs in Docker for self-hosted demos:

```powershell
Copy-Item .env.example .env
docker compose up --build
```

Test an assessment:

```powershell
Invoke-RestMethod http://localhost:5072/v1/assess `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"client":"chrome","url":"https://example.com","visibleText":"Act now to claim your prize","extractedLinks":[{"href":"https://bit.ly/example","source":"dom"}]}'
```

## API Contract

`POST /v1/assess`

Full API reference: [docs/API.md](docs/API.md)

Example request:

```json
{
  "client": "android",
  "url": "https://example.com/news/story",
  "pageTitle": "Local flood warning issued",
  "visibleText": "The local council published evacuation routes...",
  "authorName": "Example News",
  "visibleProfileSignals": ["Named source", "Published date visible"],
  "extractedLinks": [
    {
      "text": "Read more",
      "href": "https://example.com/news/story",
      "source": "dom"
    }
  ],
  "imageCrop": {
    "description": "Optional cropped screenshot area for OCR and image-risk analysis.",
    "dataUrl": "data:image/png;base64,..."
  },
  "consentToStoreEvidence": false,
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

## Design Direction

TrustLens uses a calm safety palette:

- Navy ink: `#20283a`
- Teal signal: `#66b7b8`
- Lavender verification accent: `#aaa2e6`
- Warm paper: `#fbfaf7`

The landing page carries that look into the Docker-hosted TypeScript server and links directly to the public APK build path.
