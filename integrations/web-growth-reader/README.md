# Isolated Web Growth reader

Source-only companion for the Web Growth version-1 lead store. No deployment or live customer-data connection is established by these files.

Only `GET /v1/friday/web-growth` accepts an owner-configured Bearer token (at least 32 characters, no whitespace). The token comparison uses fixed-length SHA-256 digests and constant-time comparison. Authentication happens before any file read. Unknown routes and query strings return 404; other methods on the fixed route return 405. `GET /health` reports process status only, never source availability.

The reader reads only the fixed CLI path `/data/leads.json`, rejects symlinks and non-regular files, bounds reads at 8 MiB, and never writes. Missing, malformed, oversized or unsupported data returns sanitized 503. Each snapshot carries the SHA-256 checksum of the original bytes, configured lowercase source Git revision, and generation time. Strict schema validation rejects duplicate IDs and malformed records instead of silently dropping them.

Projection contains only business name, stage, timestamps, approval/send flags, numeric score, and proposal/demo availability. Contact details, addresses, raw outreach/proposal text, subjects, notes and credentials are never forwarded. Absent optional state becomes null/false; no approval, send, revenue or value is inferred.

Before any separately approved deployment, the owner must verify the actual absolute lead-file path and source revision, provide a new private reader token, ensure UID 10001 can read that explicit file, and decide the private transport/access boundary. Do not point Friday at the unauthenticated write-capable Web Growth application on port 4317. The default reader mapping is loopback port 4318; enabling remote access requires a separately reviewed private authenticated transport. If the producer replaces files atomically, a single-file bind mount may retain an older inode; revalidate file identity/freshness before live use.

Compose requires `WEB_GROWTH_READER_TOKEN`, `WEB_GROWTH_READER_REVISION`, and `WEB_GROWTH_READER_SOURCE_FILE`; no values are committed. It mounts one explicit file read-only, uses UID/GID 10001, a read-only root filesystem, drops all capabilities and has no Docker socket. Build context is the Friday repository root. Configuration validation does not start services.

Tests: `node --test server/adapters/web-growth-schema.test.mjs scripts/web-growth-reader.test.mjs`. Fixtures contain no real customer data. No deployment command is included or executed.
