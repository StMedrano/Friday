# Isolated Web Growth reader

Source-only companion for the Web Growth version-1 lead store. No deployment or live customer-data connection is established by these files.

Only `GET /v1/friday/web-growth` accepts an owner-configured Bearer token (at least 32 characters, no whitespace). The token comparison uses fixed-length SHA-256 digests and constant-time comparison. Authentication happens before any file read. Unknown routes and query strings return 404; other methods on the fixed route return 405. `GET /health` reports process status only, never source availability.

The reader reads only the fixed CLI path `/data/leads.json`, rejects symlinks and non-regular files, bounds reads at 8 MiB, and never writes. Missing, malformed, oversized or unsupported data returns sanitized 503. Each snapshot carries the SHA-256 checksum of the original bytes, configured lowercase source Git revision, and generation time. Strict schema validation rejects duplicate IDs and malformed records instead of silently dropping them.

Projection contains only business name, stage, timestamps, approval/send flags, numeric score, and proposal/demo availability. Contact details, addresses, raw outreach/proposal text, subjects, notes and credentials are never forwarded. Absent optional state becomes null/false; no approval, send, revenue or value is inferred.

Before any separately approved deployment, the owner must verify the actual absolute lead-file path and source revision, provide a new private reader token, ensure UID 10001 can read that explicit file, and decide the private transport/access boundary. Do not point Friday at the unauthenticated write-capable Web Growth application on port 4317. The default reader mapping is loopback port 4318; enabling remote access requires a separately reviewed private authenticated transport. If the producer replaces files atomically, a single-file bind mount may retain an older inode; revalidate file identity/freshness before live use.

Compose requires `WEB_GROWTH_READER_TOKEN`, `WEB_GROWTH_READER_REVISION`, and `WEB_GROWTH_READER_SOURCE_FILE`; no values are committed. It mounts one explicit file read-only, uses UID/GID 10001, a read-only root filesystem, drops all capabilities and has no Docker socket. Build context is the Friday repository root. Configuration validation does not start services.

Tests: `node --test server/adapters/web-growth-schema.test.mjs scripts/web-growth-reader.test.mjs`. Fixtures contain no real customer data. No deployment command is included or executed.

## Private TLS deployment option

`compose.private-tls.yaml` is a separate stack, not an override for the original Compose file. It requires an explicit private-interface bind address and serves HTTPS on host port 4319. TLS 1.2+ and the existing fixed-route bearer check are both required. It mounts a dedicated secrets directory containing `reader-key.pem`, `reader-cert.pem` and `reader-token`; the CLI reads only those fixed paths when `WEB_GROWTH_READER_TLS=true`. Keys/tokens must be readable by UID 10001 and inaccessible to other host users. Invalid configuration fails without logging credential values.

This stack mounts the verified lead-store **directory** read-only, because Web Growth writes a temporary file and renames it over `leads.json`. A single-file mount would continue reading the old inode. The server still opens only `/data/leads.json`, refuses symlinks, and has no file-list or arbitrary-path route. Verify the directory contains only the intended lead data/backups, never application credentials. Mount only that directory, never the repository or a parent containing `.env`.

The controller trusts only the dedicated reader public certificate through `compose.web-growth-tls.yaml`. Use a certificate whose IP SAN matches the configured reader URL; never disable TLS verification. Renew before certificate expiry and restart/recreate the reader and controller after replacing their certificate mounts. See `docs/web-growth-connection.md` for the concrete proposed deployment and acceptance gates. No live connection is established merely by merging these files.
