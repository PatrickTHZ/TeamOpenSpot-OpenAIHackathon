# TrustLens on TrueNAS

This guide runs TrustLens as a self-hosted Docker service on TrueNAS. The same container serves both the public homepage and the credibility assessment API, so `trustlens.z2hs.au` can be a polished product page while `/v1/assess` stays available for the Android app, browser clients, and demos.

## What You Are Deploying

TrustLens is a TypeScript backend packaged as a Docker image. In this TrueNAS setup it provides:

- `GET /` - the TrustLens landing page.
- `GET /download` - the latest Android APK download handoff.
- `GET /health` - runtime health, version, endpoints, and public config.
- `POST /v1/assess` - the credibility assessment API.
- `GET /v1/schema` - a compact machine-readable API summary.
- `GET /v1/evidence/:id` - optional evidence retrieval when storage is enabled.

The container listens on port `5072`. A reverse proxy should terminate HTTPS and forward the full path to the container.

## Target Environment

| Item | Value |
| --- | --- |
| Public hostname | `trustlens.z2hs.au` |
| TrueNAS UI / server IP | `http://172.20.20.251/` |
| Container port | `5072` |
| Public homepage | `https://trustlens.z2hs.au/` |
| Public APK page | `https://trustlens.z2hs.au/download` |
| Public API endpoint | `https://trustlens.z2hs.au/v1/assess` |
| Local API endpoint | `http://172.20.20.251:5072/v1/assess` |

## Files

- `docker-compose.yml` - TrueNAS/Docker Compose service definition using the published GHCR image.
- `.env.example` - environment template for model, CORS, OCR, verification, and evidence settings.

Do not commit `.env`. It contains secrets and deployment-specific values.

## Quick Start

1. Copy the TrueNAS deployment files into a directory on the TrueNAS host:

```sh
mkdir -p /mnt/pool/apps/trustlens
cp deploy/truenas/docker-compose.yml /mnt/pool/apps/trustlens/docker-compose.yml
cp deploy/truenas/.env.example /mnt/pool/apps/trustlens/.env
cd /mnt/pool/apps/trustlens
```

2. Edit `.env` and add your real values:

```text
OPENAI_API_KEY=sk-your-real-key
OPENAI_MODEL=gpt-5.2
OPENAI_TIMEOUT_MS=2500
OPENAI_ENABLE_VISION=false
MAX_REQUEST_BYTES=3500000
OCR_ENABLED=false
OCR_ENGINE=tesseract
OCR_LANG=eng
OCR_TIMEOUT_MS=3000
WEB_VERIFICATION_ENABLED=false
WEB_VERIFICATION_TIMEOUT_MS=6000
CORS_ORIGIN=*
EVIDENCE_STORAGE_ENABLED=false
EVIDENCE_STORAGE_DIR=/data/evidence
EVIDENCE_STORE_RAW_TEXT=false
EVIDENCE_HASH_SALT=change-me
EVIDENCE_ADMIN_TOKEN=change-me
ASSESSMENT_LOG_DETAIL=debug
```

3. Pull and start the service:

```sh
docker compose pull
docker compose up -d
```

4. Confirm the container is healthy:

```sh
curl http://172.20.20.251:5072/health
```

5. Open the local homepage before wiring DNS:

```text
http://172.20.20.251:5072/
```

## Reverse Proxy

Point `trustlens.z2hs.au` at the TrueNAS host or a reverse proxy that can reach it.

Recommended upstream:

```text
trustlens.z2hs.au -> http://172.20.20.251:5072
```

Use HTTPS at the reverse proxy layer and keep the container on plain HTTP internally.

Proxy requirements:

- Preserve `/` for the homepage.
- Preserve `/download` for the Android APK page.
- Preserve API paths exactly, for example `/v1/assess` must reach `/v1/assess`.
- Allow `GET`, `POST`, and `OPTIONS`.
- Forward `Authorization` for protected evidence endpoints.
- Forward normal proxy headers such as `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto`.

After the proxy is live, check:

```sh
curl https://trustlens.z2hs.au/health
curl https://trustlens.z2hs.au/download
```

## Test The API

Fast local check:

```sh
curl -X POST http://172.20.20.251:5072/v1/assess \
  -H "Content-Type: application/json" \
  -d '{"client":"android","url":"https://example.com","visibleText":"Act now to claim your prize","extractedLinks":[{"href":"https://bit.ly/example","source":"dom"}]}'
```

Expected shape:

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

The Android app and browser clients should call:

```text
https://trustlens.z2hs.au/v1/assess
```

Never place the OpenAI API key inside the Android app, browser extension, or frontend code.

## Environment Notes

### OpenAI

If `OPENAI_API_KEY` is present, TrustLens can use the configured model for richer assessment. If the key is missing or the provider fails, the backend returns a local heuristic result so demos still work.

Recommended baseline:

```text
OPENAI_MODEL=gpt-5.2
OPENAI_TIMEOUT_MS=2500
OPENAI_ENABLE_VISION=false
```

### OCR

Docker can run system Tesseract OCR for `imageCrop.dataUrl` when OCR is enabled:

```text
OCR_ENABLED=true
OCR_ENGINE=tesseract
OCR_LANG=eng
```

Leave OCR off for fastest testing unless screenshot text needs to be processed on the backend.

### Web Verification

Web source checking is optional and slower than the normal feed scan path:

```text
WEB_VERIFICATION_ENABLED=true
WEB_VERIFICATION_TIMEOUT_MS=6000
```

Requests can force a source check with `verificationMode: "web"` when the feature is enabled.

### Evidence Storage

Evidence storage is disabled by default. To store evidence, both the server and request must opt in:

```text
EVIDENCE_STORAGE_ENABLED=true
EVIDENCE_STORAGE_DIR=/data/evidence
EVIDENCE_STORE_RAW_TEXT=false
```

The named volume `trustlens-evidence` stores evidence at `/data/evidence`. To use a TrueNAS dataset directly, replace the named volume with a host path mount in `docker-compose.yml`.

## Updating TrustLens

Run these commands on TrueNAS from the directory containing `docker-compose.yml` and `.env`:

```sh
docker compose pull trustlens-api
docker compose up -d trustlens-api
docker compose logs --tail=80 trustlens-api
```

If you are managing the container without Compose:

```sh
docker pull ghcr.io/patrickthz/teamopenspot-openaihackathon:latest
docker stop trustlens-api
docker rm trustlens-api
docker run -d \
  --name trustlens-api \
  --restart unless-stopped \
  --env-file .env \
  -p 5072:5072 \
  -v trustlens-evidence:/data/evidence \
  ghcr.io/patrickthz/teamopenspot-openaihackathon:latest
docker logs --tail=80 trustlens-api
```

Do not stop `ix-culler-app-1` when updating TrustLens; that is a separate app.

## Watching Assessment Logs

Follow live logs:

```sh
docker logs -f trustlens-api
```

Or with Compose:

```sh
docker compose logs -f trustlens-api
```

Each successful assessment writes one JSON line with `event: "assessment_result"`:

```json
{
  "event": "assessment_result",
  "requestId": "example-id",
  "latencyMs": 42,
  "status": "ok",
  "client": "android",
  "contentType": "post",
  "sourceHost": "www.instagram.com",
  "evidence": {
    "hasUrl": true,
    "hasVisibleText": true,
    "hasScreenshotOcrText": true,
    "linkCount": 1,
    "hasImageData": false,
    "hasImageDescription": true
  },
  "result": {
    "score": 71,
    "band": "yellow",
    "riskLevel": "medium",
    "label": "Needs checking"
  },
  "riskSignals": [
    {
      "category": "claim-verification",
      "severity": "low",
      "message": "General wellness advice is plausible but unsourced."
    }
  ]
}
```

`ASSESSMENT_LOG_DETAIL` controls log size:

- `debug` logs the detailed safe result trace. This is useful during hackathon demos and early deployment.
- `summary` logs a shorter safe result trace.
- `off` disables assessment result logs.

## Troubleshooting

- Homepage works but API fails: check the proxy preserves `/v1/assess` and allows `POST`.
- API works locally but not publicly: check DNS, TLS termination, firewall rules, and proxy upstream.
- Results are heuristic only: confirm `OPENAI_API_KEY` is set and the container was restarted after editing `.env`.
- APK page fails: confirm `/download` is forwarded to the same TrustLens container.
- Evidence retrieval fails: check `EVIDENCE_STORAGE_ENABLED`, volume mount, and `Authorization` forwarding.
