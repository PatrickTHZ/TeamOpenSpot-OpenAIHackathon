# TrueNAS Self-Hosting Plan

This deployment runs the TrustLens backend API as a Docker container on TrueNAS.

## Target

- Hostname: `trustlens.z2hs.au`
- TrueNAS UI / server IP: `http://172.20.20.251/`
- TrueNAS port: `5072`
- Public homepage: `https://trustlens.z2hs.au/`
- Public API endpoint: `https://trustlens.z2hs.au/v1/assess`
- Local container endpoint: `http://172.20.20.251:5072/v1/assess`

## Files

- `docker-compose.yml` - TrueNAS/Docker Compose service definition using the published GHCR image.
- `.env.example` - copy to `.env` and add real API keys.

Do not commit `.env`.

## Setup

1. Copy `deploy/truenas/docker-compose.yml` and `deploy/truenas/.env.example` to a directory on TrueNAS.
2. Copy the env template:

```sh
cp deploy/truenas/.env.example deploy/truenas/.env
```

3. Edit `deploy/truenas/.env`:

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

4. Start the service from the TrueNAS deploy directory:

```sh
docker compose pull
docker compose up -d
```

5. Test locally:

```sh
curl -X POST http://172.20.20.251:5072/v1/assess \
  -H "Content-Type: application/json" \
  -d '{"client":"chrome","url":"https://example.com","visibleText":"Example post text"}'
```

## DNS / Reverse Proxy

Point `trustlens.z2hs.au` to the TrueNAS server or reverse proxy.

Recommended reverse proxy rule:

```text
trustlens.z2hs.au -> http://172.20.20.251:5072
```

Use HTTPS at the reverse proxy layer. Keep the container on plain HTTP internally.

Reverse proxy requirements:

- Preserve `/` for the TrustLens landing page.
- Preserve the request path, for example `/v1/assess` must reach `/v1/assess`.
- Allow `GET`, `POST`, and `OPTIONS`.
- Forward the `Authorization` header for protected evidence endpoints.
- Keep TLS termination at the proxy layer.

## API Keys

API keys are loaded from `.env` for speed and simple TrueNAS setup:

```text
OPENAI_API_KEY=...
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
EVIDENCE_STORAGE_ENABLED=false
EVIDENCE_STORAGE_DIR=/data/evidence
EVIDENCE_STORE_RAW_TEXT=false
EVIDENCE_HASH_SALT=change-me
EVIDENCE_ADMIN_TOKEN=change-me
ASSESSMENT_LOG_DETAIL=debug
```

The Android app and Chrome extension must never contain the OpenAI API key. They should call:

```text
https://trustlens.z2hs.au/v1/assess
```

## Notes

- The Docker service uses the same scoring logic as the Cloudflare Worker.
- If `OPENAI_API_KEY` is missing or OpenAI fails, the backend returns a local heuristic result.
- Docker can run system Tesseract OCR for `imageCrop.dataUrl` when `OCR_ENABLED=true`; leave it off for fastest testing unless backend OCR is needed.
- Web source checking requires `WEB_VERIFICATION_ENABLED=true` and request-level `verificationMode: "web"`; leave it off for fastest feed scanning.
- Evidence/image storage is disabled by default and requires both `EVIDENCE_STORAGE_ENABLED=true` and request-level `consentToStoreEvidence=true`.
- The named volume `trustlens-evidence` stores evidence at `/data/evidence`. To use a TrueNAS dataset directly, replace the named volume with a host path mount.
- Runtime logs avoid raw post text. They include request ID, client, safe source host, captured evidence types, score, band, label, risk level, risk signals, latency, OCR status, and storage status.

## Updating the Container

Run these commands on TrueNAS from the directory containing `docker-compose.yml` and `.env`:

```sh
sudo docker compose pull trustlens-api
sudo docker compose up -d trustlens-api
sudo docker compose logs --tail=80 trustlens-api
```

If you are managing the container without Compose, replace only the TrustLens container:

```sh
sudo docker pull ghcr.io/patrickthz/teamopenspot-openaihackathon:latest
sudo docker stop trustlens-api
sudo docker rm trustlens-api
sudo docker run -d \
  --name trustlens-api \
  --restart unless-stopped \
  --env-file .env \
  -p 5072:5072 \
  -v trustlens-evidence:/data/evidence \
  ghcr.io/patrickthz/teamopenspot-openaihackathon:latest
sudo docker logs --tail=80 trustlens-api
```

Do not stop `ix-culler-app-1` when updating TrustLens; that is a separate app.

## Watching Assessment Logs

Follow the backend logs while requests flow through:

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
  "client": "chrome",
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

- `debug` logs the detailed safe result trace. This is the TrueNAS default.
- `summary` logs a shorter safe result trace.
- `off` disables assessment result logs.
