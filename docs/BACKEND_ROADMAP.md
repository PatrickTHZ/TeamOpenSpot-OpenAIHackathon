# Backend Roadmap

This roadmap keeps the backend aligned with the product pipeline:

```text
OCR + Link Extraction + Image Crop
-> Risk Agent
-> Simple Elderly-Friendly Advice
```

## Next Best Features

1. Evidence ledger
   - Return structured evidence objects per category.
   - Include source, reason, severity, and optional quote/snippet.
   - Keep snippets short and avoid storing raw text unless consent allows it.

2. Category score breakdown
   - Add category-level scores for scam language, source credibility, link mismatch, claim verification, and AI-image suspicion.
   - This lets the UI say what the biggest concern is.

3. Requested action detection
   - Detect asks to click links, call numbers, send money, share codes, share personal details, download files, or reply.
   - Initial lightweight version is now returned as `requestedActions`.

4. Trusted entity impersonation
   - Detect claims to be from myGov, ATO, Medicare, banks, police, telcos, delivery companies, charities, and family members.
   - Compare claimed sender with visible links/domains.

5. Link reputation enrichment
   - Expand short links in a slower/deep mode.
   - Detect lookalike domains such as `myg0v-login.example`.
   - Add versioned allowlist/denylist data for Australian services.

6. Contact extraction
   - Extract phone numbers, emails, WhatsApp/Telegram handles, payment handles, and QR-code decoded URLs.
   - Route URLs into the same link-risk pipeline.

7. Safe next-step generator
   - Return concrete actions such as:
     - Do not click.
     - Open the official app yourself.
     - Call the number on the back of your card.
     - Ask someone you trust.

## Performance And Reliability

1. Cache repeated assessments
   - Use a privacy-safe fingerprint of normalized domains, link hashes, text hashes, OCR hash, image hash, model version, and rules version.
   - Self-host can use an in-memory LRU or SQLite.
   - Worker can use Cache/KV later.

2. Split fast/balanced/deep modes
   - `fast`: deterministic rules only.
   - `balanced`: deterministic plus bounded OpenAI refinement.
   - `deep`: async enrichment such as shortener expansion, QR decoding, or web/source lookup.

3. OpenAI circuit breaker
   - Temporarily skip model calls after repeated timeouts/errors.
   - Add `openaiStatus` to internal trace/logs.

4. Async evidence storage
   - Generate an `evidenceId` synchronously, return quickly, then persist image/metadata in the background.

5. Domain intelligence data file
   - Replace hardcoded trusted/risky domains with versioned data.
   - Add public suffix handling for `gov.au`, `com.au`, `co.uk`, etc.

## Current Exposed Trace Fields

- `riskSignals`: category-level rule hits.
- `requestedActions`: likely user action requested by the content.
- `analysisVersion`: deterministic risk rules version.

These fields are frontend-safe and should help explain the backend's decision without exposing private model prompts or raw stored evidence.
