# TrustLens Backend API

Base URLs:

- Internal TrueNAS: `http://172.20.20.251:5072`
- Public: `https://trustlens.z2hs.au`

## Endpoints

- `GET /health` - service status, API version, public runtime config.
- `GET /v1/schema` - machine-readable request/response guide.
- `POST /v1/assess` - credibility/risk assessment.
- `GET /v1/evidence` - protected self-host training evidence list.
- `GET /v1/evidence/{id}` - protected evidence metadata.
- `GET /v1/evidence/{id}/image` - protected stored crop image.

## Request Rules

- Send `Content-Type: application/json`.
- `client` must be `android` or `chrome`.
- At least one evidence field is required: `visibleText`, `selectedText`, `screenshotOcrText`, `extractedLinks`, `imageCrop`, or `url`.
- Max request body defaults to `3,500,000` bytes.
- Text fields are capped at `6000` chars.
- `visibleProfileSignals` is capped at `12` items, `280` chars each.
- `accountContext.recentPosts` is capped at `5` visible post samples, `1000` chars each.
- `extractedLinks` is capped at `16` links.
- `extractedLinks[].source` can be `visible`, `ocr`, `dom`, or `manual`.
- `imageCrop.dataUrl` must be a PNG, JPEG, or WebP base64 data URL.
- `imageCrop.crop` coordinates alone do not count as evidence; include `imageCrop.dataUrl`, `imageCrop.description`, or `screenshotOcrText`.
- Decoded image crop bytes are capped at about `1.8MB`.
- Docker/self-host can OCR `imageCrop.dataUrl` with Tesseract when `OCR_ENABLED=true`.
- Cloudflare Worker does not run local OCR; send `screenshotOcrText` from the client or enable OpenAI vision.
- Optional web source checking is available with `verificationMode: "web"` when `WEB_VERIFICATION_ENABLED=true`.

## Minimal Request

```sh
curl -X POST https://trustlens.z2hs.au/v1/assess \
  -H "Content-Type: application/json" \
  -d '{"client":"chrome","visibleText":"Act now to verify your account and claim your prize"}'
```

## Rich Request

```json
{
  "client": "chrome",
  "url": "https://example.com/post",
  "pageTitle": "Example post",
  "visibleText": "Act now to verify your myGov account and claim your prize today",
  "selectedText": "",
  "screenshotOcrText": "Urgent claim prize now",
  "authorName": "Example Support",
  "authorHandle": "@example-support",
  "visibleProfileSignals": ["posted 2h ago"],
  "accountContext": {
    "profileUrl": "https://www.facebook.com/example-support",
    "displayName": "Example Support",
    "handle": "@example-support",
    "bioText": "Daily support and giveaways",
    "accountAgeText": "Joined this week",
    "followerCountText": "18 followers",
    "verificationSignals": [],
    "recentPosts": [
      {
        "text": "DM me to claim your prize before it disappears",
        "postedAtText": "Yesterday"
      },
      {
        "text": "Limited time account verification reward",
        "postedAtText": "Today"
      }
    ]
  },
  "extractedLinks": [
    {
      "text": "my.gov.au",
      "href": "https://account-verify-prize.example.com/login",
      "source": "dom"
    }
  ],
  "imageCrop": {
    "description": "Cropped image says urgent claim prize now",
    "mediaType": "image/png",
    "crop": { "x": 0, "y": 0, "width": 500, "height": 300 }
  },
  "contentType": "post",
  "locale": "en-AU",
  "verificationMode": "fast",
  "consentToStoreEvidence": false,
  "consentLabel": "training-qa-v1"
}
```

## Response

```json
{
  "score": 22,
  "band": "red",
  "riskLevel": "high",
  "label": "Suspicious",
  "confidence": "medium",
  "plainLanguageSummary": "This looks risky because the wording uses urgency, pressure, or scam-like promises.",
  "why": [
    "The post refers to an official topic but no official source domain is visible.",
    "The wording uses urgency, pressure, or scam-like promises."
  ],
  "advice": "Do not click the link or enter details. Go to the official website yourself or ask someone you trust to check it.",
  "evidenceFor": ["A link or page address is available for checking."],
  "evidenceAgainst": ["The wording uses urgency, pressure, or scam-like promises."],
  "missingSignals": ["No account age, verification, or profile history is visible."],
  "recommendedAction": "Do not click. Type the official website address yourself.",
  "riskSignals": [
    {
      "category": "link-mismatch",
      "severity": "high",
      "message": "Shortened or risky-looking link detected."
    }
  ],
  "requestedActions": [
    {
      "action": "click_link",
      "risk": "high",
      "target": "https://account-verify-prize.example.com/login",
      "advice": "Do not click the link. Type the official website address yourself."
    }
  ],
  "accountCredibility": {
    "level": "low",
    "summary": "The account profile or recent posts contain scam-like promotional patterns.",
    "signalsFor": ["The poster account identity was captured."],
    "signalsAgainst": [
      "The account appears new or recently created.",
      "The account profile or recent posts contain scam-like promotional patterns."
    ],
    "missingSignals": ["Follower or friend count was not visible."]
  },
  "analysisVersion": "risk-rules-2026-04-29.3",
  "evidenceId": "only-present-when-stored",
  "storedEvidenceUrl": "/v1/evidence/only-present-when-stored"
}
```

`webVerification` appears only when the request uses `verificationMode: "web"` and the backend has `WEB_VERIFICATION_ENABLED=true` with an OpenAI key. Fast mode omits it.

`evidenceId` and `storedEvidenceUrl` appear only on self-host Docker when evidence storage is enabled and the request includes `consentToStoreEvidence: true`.

## Evidence Capture Guide

| Need | Send these fields |
| --- | --- |
| Source identity | `authorName`, `authorHandle`, `visibleProfileSignals` |
| Facebook account/poster credibility | `accountContext.profileUrl`, `accountContext.displayName`, `accountContext.handle`, `accountContext.accountAgeText`, `accountContext.verificationSignals`, `accountContext.recentPosts[]` |
| Claim text | `visibleText`, `selectedText`, `screenshotOcrText` |
| Link checking | `url`, `extractedLinks[].href`, `extractedLinks[].text` |
| Image-dependent claims | `imageCrop.description`, `imageCrop.dataUrl`, `screenshotOcrText` |
| Reels/video limitation | `contentType: "reel"` |

## Source And Claim Checking

Source credibility is heuristic, not a live reputation lookup. It considers visible author/profile signals, official-looking domains, and risky domain patterns.

For Facebook-style posts, the backend does not scrape private Facebook data. The client should capture visible public account evidence and send it as `accountContext`. The fast risk engine checks whether the displayed author matches the profile context, whether account age/history is visible, whether verification or official signals are present, and whether recent visible posts look repetitive, promotional, or scam-like. The response returns `accountCredibility` so the frontend can show who posted it and how much account evidence was available.

Trusted examples include `.gov.au`, `.edu.au`, `.gov`, `.edu`, `.nhs.uk`, `abc.net.au`, `bbc.com`, `reuters.com`, `apnews.com`, `who.int`, and `bom.gov.au`.

The backend also has a small reputable-source registry for screenshot/logo cues. Current entries include Reuters, Associated Press/AP News, BBC News, ABC News, SBS News, The Guardian, The New York Times, Washington Post, Al Jazeera, WHO, and Australian Government sources. A visible reputable source logo/name can raise credibility and reduce unsupported-claim penalties, but it is not a free pass: synthetic/demo, edited, scam-like, or manipulated image signals can still make the result suspicious.

Risky patterns include URL shorteners, punycode `xn--`, IP-address links, and domains containing `login`, `verify`, `account`, `prize`, `gift`, or `claim`.

Claim verification means checking whether supplied evidence supports the claim. OCR text and image descriptions are treated as claim text, not just link text. Product, wellness, skin, supplement, cure, anti-aging, or before/after claims extracted from a screenshot are lowered when no trusted support is visible.

AI-image suspicion is also checked from screenshot evidence. Synthetic/demo labels, AI-generated wording, deepfake/editing/manipulation terms, and before/after transformation imagery lower credibility because the visual evidence may be staged, edited, or generated.

When `verificationMode` is `web` and the backend has `WEB_VERIFICATION_ENABLED=true`, the backend asks OpenAI's hosted web search tool to look for supporting or contradicting public sources. This is slower than fast mode and should be used for a details view or user-requested source check.
