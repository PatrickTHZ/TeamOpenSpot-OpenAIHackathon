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
- `extractedLinks` is capped at `16` links.
- `extractedLinks[].source` can be `visible`, `ocr`, `dom`, or `manual`.
- `imageCrop.dataUrl` must be a PNG, JPEG, or WebP base64 data URL.
- Decoded image crop bytes are capped at about `1.8MB`.

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
  "evidenceId": "only-present-when-stored",
  "storedEvidenceUrl": "/v1/evidence/only-present-when-stored"
}
```

`evidenceId` and `storedEvidenceUrl` appear only on self-host Docker when evidence storage is enabled and the request includes `consentToStoreEvidence: true`.

## Evidence Capture Guide

| Need | Send these fields |
| --- | --- |
| Source identity | `authorName`, `authorHandle`, `visibleProfileSignals` |
| Claim text | `visibleText`, `selectedText`, `screenshotOcrText` |
| Link checking | `url`, `extractedLinks[].href`, `extractedLinks[].text` |
| Image-dependent claims | `imageCrop.description`, `imageCrop.dataUrl`, `screenshotOcrText` |
| Reels/video limitation | `contentType: "reel"` |

## Source And Claim Checking

Source credibility is heuristic, not a live reputation lookup. It considers visible author/profile signals, official-looking domains, and risky domain patterns.

Trusted examples include `.gov.au`, `.edu.au`, `.gov`, `.edu`, `.nhs.uk`, `abc.net.au`, `bbc.com`, `reuters.com`, `apnews.com`, `who.int`, and `bom.gov.au`.

Risky patterns include URL shorteners, punycode `xn--`, IP-address links, and domains containing `login`, `verify`, `account`, `prize`, `gift`, or `claim`.

Claim verification means checking whether supplied evidence supports the claim. It does not browse the web or prove claims independently.
