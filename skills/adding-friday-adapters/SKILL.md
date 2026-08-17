---
name: adding-friday-adapters
description: Use when connecting Friday to Proxmox, Docker, Omada, AdGuard, monitoring, or another infrastructure data source.
---

# Adding Friday Integration Adapters

## Boundary
Adapters are server-side and read-only by default. Browser code consumes normalized Friday data and never receives provider credentials.

## Pattern
1. Add configuration under `server/config.mjs` with an explicit `*_ENABLED=false` default.
2. Add a focused module under `server/adapters/`.
3. Normalize provider output in `server/overview.mjs`; do not leak raw provider responses into React components.
4. Add a failing Node test before adapter behavior.
5. Treat timeouts/auth failures as degraded integration state rather than crashing the whole overview.
6. Add environment names to `.env.example`; secrets must remain empty.
7. Document minimum provider permissions in `docs/integrations.md`.
8. Run `make verify` and ensure mock mode still works with zero credentials.

## Prohibited shortcuts
- No credentials in `src/`, `VITE_*`, browser local storage, committed JSON, or query strings.
- No write-capable token when a read-only role/token exists.
- No direct provider calls from React.
- No infrastructure mutation added to a health/inventory adapter.

## Mutating actions
If an integration later needs actions, create a separate action interface with authentication, policy, approval, and audit requirements. Do not extend a read adapter with hidden writes.
