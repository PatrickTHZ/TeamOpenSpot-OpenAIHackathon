# TrustLens

**A calm credibility layer for the internet's noisiest moments.**

TrustLens is an Android-first credibility companion for social feeds, screenshots, links, and fast-moving claims. It waits until a user pauses, reads the visible evidence in front of them, and returns a simple risk label with the reasons behind it. The goal is not to make people suspicious of everything. The goal is to help them slow down at exactly the moment a scam, hoax, or panic-share wants them to rush.

[![Build Android APK](https://github.com/PatrickTHZ/TeamOpenSpot-OpenAIHackathon/actions/workflows/android-apk.yml/badge.svg)](https://github.com/PatrickTHZ/TeamOpenSpot-OpenAIHackathon/actions/workflows/android-apk.yml?query=branch%3Amain)

[Open TrustLens](https://trustlens.z2hs.au) · [Download the latest APK](https://trustlens.z2hs.au/download) · [View Android builds](https://github.com/PatrickTHZ/TeamOpenSpot-OpenAIHackathon/actions/workflows/android-apk.yml?query=branch%3Amain)

## Why TrustLens

Online harm rarely arrives wearing a warning label. It looks like a prize notification, a breaking-news screenshot, a health claim from a friend, a fake delivery message, or a post that feels just urgent enough to share before checking. Most people do not need a lecture in that moment. They need a quick, respectful pause.

TrustLens gives users that pause. It looks at the text, links, screenshot context, source clues, and visible account signals already on screen, then explains what looks supported, what looks risky, and what is missing. Instead of pretending to be a final truth machine, TrustLens acts like a careful second set of eyes: calm, transparent, and useful before the user taps, shares, registers, or pays.

It is designed for everyday uncertainty:

- A parent sees an alarming school notice screenshot with no source.
- A student gets a prize link in a group chat.
- A shopper sees a too-good-to-be-true marketplace deal.
- A user wants to know whether a post is credible enough to read, share, or ignore.

TrustLens turns that moment into a clear next step: open the original source, avoid the link, verify the account, or continue with normal caution.

## App Preview

![TrustLens scan flow mock GIF](docs/assets/trustlens-scan-flow.gif)

TrustLens stays quiet while the user scrolls. After a pause, the floating bubble scans the visible post, screenshot, and link context, then returns a compact label such as `Likely safe`, `Needs checking`, `Suspicious`, or `Cannot verify`.

![TrustLens explanation panel mock GIF](docs/assets/trustlens-explain-panel.gif)

Tapping the bubble opens a plain-language explanation with the strongest visible signals, such as shortened links, urgent wording, missing sources, account context, OCR text, and the safest action before sharing.

## Download Android APK

The website download route sends users straight to the latest Android APK:

```text
https://trustlens.z2hs.au/download
```

Direct APK URL:

```text
https://github.com/PatrickTHZ/TeamOpenSpot-OpenAIHackathon/raw/refs/heads/main/trustlens-debug.apk
```

## Features

- Pause-aware capture: TrustLens waits for a natural pause instead of scanning constantly while the user scrolls.
- Visible-evidence scoring: the backend weighs text, OCR hints, links, source hosts, page titles, and account signals.
- Plain-language labels: results become `Likely safe`, `Needs checking`, `Suspicious`, or `Cannot verify`.
- Link and source checks: shortened links, mismatched domains, missing official sources, and suspicious cues are surfaced clearly.
- Screenshot-aware analysis: OCR text from screenshots can be assessed with the same risk logic as normal post text.
- Privacy-conscious evidence handling: raw evidence storage is off by default and requires explicit consent.
- Docker-hosted website and API: `/` serves the TrustLens homepage, `/download` serves the APK handoff, and `/v1/assess` remains the API.
- Android APK pipeline: GitHub Actions builds the Android prototype so testers can download the latest package quickly.

## What TrustLens Checks

TrustLens combines fast heuristics with optional AI-backed assessment. The response is intentionally explainable, so the app can show users why a post needs caution instead of dropping a mysterious score on them.

| Signal | What TrustLens looks for | Why it matters |
| --- | --- | --- |
| Urgency | "Act now", countdowns, limited-time pressure | Scams often force fast decisions before users verify. |
| Link safety | Shorteners, mismatched domains, hidden destinations | Risky posts often hide where a tap will really go. |
| Source quality | Official domains, visible author, account signals | Credible claims usually have traceable origin context. |
| Claim type | Money, health, prizes, identity, emergencies | High-impact claims deserve stronger evidence. |
| Missing context | No date, no link, cropped screenshot, no publisher | Missing context does not prove harm, but it lowers confidence. |
| Screenshot text | OCR from image crops or shared screenshots | Many viral claims spread as images with the original source removed. |

## User Flow

```text
User opens Facebook or a web feed
-> TrustLens waits while the user scrolls
-> user pauses on a post
-> app captures visible text, OCR hints, and links
-> backend checks scam language, source signals, link mismatch, and visible evidence
-> TrustLens shows Low / Medium / High risk
-> user taps for why and what to do next
```

## Example Assessments

TrustLens is built to explain context, not just return a score. A good result means the visible post gives the user enough stable evidence to keep reading with normal caution. A bad result means the post is using pressure, hiding its source, asking for sensitive action, or sending the user somewhere risky.

### Good Example: Official Local Update

Visible context:

```text
Severe weather update: Sandbag collection points are open from 8 AM at the local council depot.
Full details: https://www.citycouncil.example.gov.au/emergency-updates
```

API request:

```json
{
  "client": "android",
  "url": "https://www.citycouncil.example.gov.au/emergency-updates",
  "pageTitle": "Emergency updates",
  "visibleText": "Severe weather update: Sandbag collection points are open from 8 AM at the local council depot. Full details: https://www.citycouncil.example.gov.au/emergency-updates",
  "authorName": "Example City Council",
  "visibleProfileSignals": ["Official council page", "Date visible"],
  "extractedLinks": [
    {
      "text": "Full details",
      "href": "https://www.citycouncil.example.gov.au/emergency-updates",
      "source": "dom"
    }
  ],
  "contentType": "social_post",
  "locale": "en-AU"
}
```

Result:

```json
{
  "score": 84,
  "band": "green",
  "riskLevel": "low",
  "label": "Likely safe",
  "confidence": "medium",
  "plainLanguageSummary": "This post has a named public source, a visible official link, and no strong pressure tactics.",
  "why": [
    "The visible link points to an official-looking council domain.",
    "The post gives concrete public information instead of asking for payment or personal details.",
    "The author and date are visible enough for the user to cross-check."
  ],
  "advice": "Open the linked council page before acting, especially if conditions are changing quickly.",
  "missingSignals": ["TrustLens has not independently confirmed the council page content in this example."]
}
```

### Bad Example: Prize Scam

Visible context:

```text
URGENT: You have won a $500 grocery voucher. Claim in the next 10 minutes or it expires.
Tap here: https://bit.ly/claim-free-voucher-now
```

API request:

```json
{
  "client": "android",
  "visibleText": "URGENT: You have won a $500 grocery voucher. Claim in the next 10 minutes or it expires. Tap here: https://bit.ly/claim-free-voucher-now",
  "authorName": "Rewards Support",
  "visibleProfileSignals": ["No verified badge", "New-looking account"],
  "extractedLinks": [
    {
      "text": "Tap here",
      "href": "https://bit.ly/claim-free-voucher-now",
      "source": "dom"
    }
  ],
  "contentType": "social_post",
  "locale": "en-AU"
}
```

Result:

```json
{
  "score": 18,
  "band": "red",
  "riskLevel": "high",
  "label": "Suspicious",
  "confidence": "high",
  "plainLanguageSummary": "This looks risky because it combines urgency, a prize claim, and a shortened link with no visible official source.",
  "why": [
    "The post pressures the user to act quickly.",
    "The prize claim is not backed by a visible official source.",
    "The shortened link hides the destination before the user taps."
  ],
  "advice": "Do not open the link or enter personal details. Search for the official company site separately.",
  "evidenceAgainst": [
    "Urgent wording",
    "Shortened link",
    "No official source visible"
  ]
}
```

### Unclear Example: Screenshot With Missing Source

Visible context:

```text
Screenshot text: New rule starts tomorrow. Everyone must register online before 5 PM.
No visible date, author, link, or official source.
```

Result:

```json
{
  "score": 42,
  "band": "yellow",
  "riskLevel": "medium",
  "label": "Cannot verify",
  "confidence": "low",
  "plainLanguageSummary": "The screenshot may be important, but the visible evidence is too thin to verify from the capture alone.",
  "why": [
    "The claim asks people to take action soon.",
    "No source, date, or official link is visible.",
    "Screenshots can lose important context from the original post or page."
  ],
  "advice": "Look for the same announcement on an official website before sharing or registering.",
  "missingSignals": [
    "Original URL",
    "Publisher name",
    "Publication date",
    "Official source link"
  ]
}
```

### High-Risk Example: Account Recovery Phishing

Visible context:

```text
Your account will be locked today. Confirm your password immediately:
https://secure-login.example-reset.com
```

Result:

```json
{
  "score": 12,
  "band": "red",
  "riskLevel": "high",
  "label": "Suspicious",
  "confidence": "high",
  "plainLanguageSummary": "This looks like a phishing attempt because it threatens account loss and sends the user to a login-style domain that is not clearly official.",
  "why": [
    "The message creates urgent pressure around account access.",
    "It asks the user to confirm sensitive credentials.",
    "The destination domain does not clearly match a trusted service."
  ],
  "advice": "Do not enter your password. Open the service directly from its official app or typed website address.",
  "evidenceAgainst": [
    "Credential request",
    "Threat of account lockout",
    "Suspicious login-style domain"
  ]
}
```

## Project Structure

- `backend/` - TypeScript Cloudflare Worker and Docker self-host server.
- `backend/android/` - Android accessibility-service prototype that builds into an APK.
- `shared/` - shared assessment contract for Android, Chrome, and future clients.
- `docs/API.md` - API fields, examples, source checking, and storage reference.
- `docs/assets/` - mock TrustLens app GIFs used by GitHub and the website.
- `deploy/truenas/` - TrueNAS-ready deployment for `trustlens.z2hs.au`.
- `.github/workflows/android-apk.yml` - Android SDK workflow that publishes `trustlens-debug-apk`.
- `.github/workflows/docker-image.yml` - Docker image build for GHCR.

## Run Locally

Backend and website in Docker:

```powershell
Copy-Item .env.example .env
docker compose up --build
```

Open:

```text
http://localhost:5072
```

Routes:

- `GET /` - TrustLens landing page.
- `GET /download` - redirect to the latest Android APK.
- `GET /health` - service health and public runtime config.
- `POST /v1/assess` - credibility assessment API.
- `GET /v1/schema` - machine-readable API schema summary.

Backend development:

```powershell
cd backend
npm install
npm test
npm run typecheck
npm run typecheck:selfhost
npm run dev
```

## API Example

`POST /v1/assess`

TrustLens clients send the backend the visible context they can safely collect: text on screen, known URL, page title, links, source hints, screenshot OCR, and whether the user consented to evidence storage. The backend returns a compact result for the floating app UI plus enough explanation to open a richer detail panel.

```powershell
Invoke-RestMethod http://localhost:5072/v1/assess `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"client":"android","url":"https://example.com","visibleText":"Act now to claim your prize","extractedLinks":[{"href":"https://bit.ly/example","source":"dom"}]}'
```

Example response fields:

```json
{
  "score": 48,
  "band": "yellow",
  "riskLevel": "medium",
  "label": "Needs checking",
  "confidence": "medium",
  "why": [
    "The post asks you to act urgently.",
    "The link destination is shortened or unclear."
  ],
  "advice": "Open the original source before sharing."
}
```

Full API reference: [docs/API.md](docs/API.md)

## Deployment

The public service is designed to sit behind `https://trustlens.z2hs.au`:

- `https://trustlens.z2hs.au/` - homepage
- `https://trustlens.z2hs.au/download` - latest APK download
- `https://trustlens.z2hs.au/v1/assess` - API endpoint
- `https://trustlens.z2hs.au/health` - health check

See [deploy/truenas/README.md](deploy/truenas/README.md) for the TrueNAS deployment notes.

## Design Direction

TrustLens uses a calm safety palette:

- Navy ink: `#20283a`
- Teal signal: `#66b7b8`
- Lavender verification accent: `#aaa2e6`
- Warm paper: `#fbfaf7`

The goal is not to scare users. The goal is to slow down risky sharing just enough for a better decision.
