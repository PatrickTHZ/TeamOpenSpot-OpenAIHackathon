# TrueNAS Self-Hosting Plan

This deployment runs the TrustLens backend API as a Docker container on TrueNAS.

## Target

- Hostname: `trustlens.z2hs.au`
- TrueNAS UI / server IP: `http://172.20.20.251/`
- TrueNAS port: `5072`
- Public API endpoint: `https://trustlens.z2hs.au/v1/assess`
- Local container endpoint: `http://172.20.20.251:5072/v1/assess`

## Files

- `docker-compose.yml` - TrueNAS/Docker Compose service definition.
- `.env.example` - copy to `.env` and add real API keys.

Do not commit `.env`.

## Setup

1. Copy the repo to TrueNAS or point your TrueNAS app/custom compose project at the repo.
2. Copy the env template:

```sh
cp deploy/truenas/.env.example deploy/truenas/.env
```

3. Edit `deploy/truenas/.env`:

```text
OPENAI_API_KEY=sk-your-real-key
OPENAI_MODEL=gpt-5
OPENAI_TIMEOUT_MS=2500
OPENAI_ENABLE_VISION=false
MAX_REQUEST_BYTES=3500000
OCR_ENABLED=false
OCR_ENGINE=tesseract
OCR_LANG=eng
OCR_TIMEOUT_MS=3000
CORS_ORIGIN=*
EVIDENCE_STORAGE_ENABLED=false
EVIDENCE_STORAGE_DIR=/data/evidence
EVIDENCE_STORE_RAW_TEXT=false
EVIDENCE_HASH_SALT=change-me
EVIDENCE_ADMIN_TOKEN=change-me
```

4. Start the service from the repo root:

```sh
docker compose -f deploy/truenas/docker-compose.yml up -d --build
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

- Preserve the request path, for example `/v1/assess` must reach `/v1/assess`.
- Allow `GET`, `POST`, and `OPTIONS`.
- Forward the `Authorization` header for protected evidence endpoints.
- Keep TLS termination at the proxy layer.

## API Keys

API keys are loaded from `.env` for speed and simple TrueNAS setup:

```text
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5
OPENAI_TIMEOUT_MS=2500
OPENAI_ENABLE_VISION=false
MAX_REQUEST_BYTES=3500000
OCR_ENABLED=false
OCR_ENGINE=tesseract
OCR_LANG=eng
OCR_TIMEOUT_MS=3000
EVIDENCE_STORAGE_ENABLED=false
EVIDENCE_STORAGE_DIR=/data/evidence
EVIDENCE_STORE_RAW_TEXT=false
EVIDENCE_HASH_SALT=change-me
EVIDENCE_ADMIN_TOKEN=change-me
```

The Android app and Chrome extension must never contain the OpenAI API key. They should call:

```text
https://trustlens.z2hs.au/v1/assess
```

## Notes

- The Docker service uses the same scoring logic as the Cloudflare Worker.
- If `OPENAI_API_KEY` is missing or OpenAI fails, the backend returns a local heuristic result.
- Docker can run system Tesseract OCR for `imageCrop.dataUrl` when `OCR_ENABLED=true`; leave it off for fastest testing unless backend OCR is needed.
- Evidence/image storage is disabled by default and requires both `EVIDENCE_STORAGE_ENABLED=true` and request-level `consentToStoreEvidence=true`.
- The named volume `trustlens-evidence` stores evidence at `/data/evidence`. To use a TrueNAS dataset directly, replace the named volume with a host path mount.
- Runtime logs avoid raw post text and only include request ID, client, latency, band, and error category.
