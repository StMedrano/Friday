# Friday operator access and origin hardening

> **Status on `main` (2026-11-05):** ported from PR #109's branch and
> corrected to what `main` does. Two things the earlier draft described are
> **not** on `main` and are left out on purpose: a second bearer token for
> registry sync (`FRIDAY_REGISTRY_SYNC_OPERATOR_TOKEN`), and a per-identity
> limit of 20 POST requests a minute. If either is wanted, it is new work.

## How the origin checks identity

Code: `server/security/access.mjs` (verifier) and the gate near the top of the
request handler in `server/http.mjs`. Config: `server/config.mjs`.

- **Live mode turns it on.** `FRIDAY_MODE=live` sets `access.enabled`; there
  is no separate switch. Mock mode runs without it.
- **Settings.** `FRIDAY_ACCESS_TEAM_DOMAIN` (an
  `https://<team>.cloudflareaccess.com` URL), `FRIDAY_ACCESS_AUD` (the Access
  application's audience tag) and `FRIDAY_ACCESS_OPERATOR_EMAILS`
  (comma-separated). They are listed in `compose.yaml` and `.env.example`. An
  empty operator list grants nobody operator access.
- **Fails closed.** In live mode, if the team domain or audience is missing or
  malformed, every `/api/` route except health answers 503
  `access-verification-unavailable`. With valid config, a missing, spoofed,
  expired, wrong-audience or wrong-issuer token gets 403 `access-denied`.
- **What is verified.** The RS256 signature of `Cf-Access-Jwt-Assertion`
  against the team's JWKS (`/cdn-cgi/access/certs`, cached for an hour),
  audience, issuer, timestamps, and a non-empty human subject. Unsigned
  identity headers are ignored. Service tokens are rejected on the human API.
- **Public routes.** Only `GET /healthz` and `GET /api/health`. The static UI
  is not checked at the origin; the Cloudflare Access edge policy must protect
  it, so direct TCP/3010 access must stay limited to the approved reverse
  proxy.

## Operators and writes

An identity is an operator only when its signed email is in
`FRIDAY_ACCESS_OPERATOR_EMAILS`. Operator-only routes:

- `POST /api/agents/registry/sync`
- `PUT /api/settings/sites`
- non-GET requests under `/api/settings/endpoints` and
  `/api/settings/repositories`
- `POST /api/approvals/:incidentId/decision`
- `/api/audit/events`

For any POST, PUT or DELETE after a successful check:

- a browser request with `Sec-Fetch-Site: cross-site` gets 403;
- registry sync, site settings, settings collection writes, Web Push
  subscribe/unsubscribe, group advisory and approval decisions must be
  `Content-Type: application/json`, otherwise 415 `json-required`;
- registry sync, diagnostic reruns, settings writes and approval decisions
  are written to the action audit (`server/audit/action-audit.mjs`) when it
  is enabled.

All of this runs before the route's service code is reached. Diagnostic reruns
(`POST /api/incidents/:id/diagnostics/rerun`) are open to any valid identity;
they re-collect read-only diagnostics.

The separate automation listener (`FRIDAY_AUTOMATION_ENABLED`, port 3011,
`compose.automation.yaml`) accepts only Cloudflare service tokens listed in
`FRIDAY_AUTOMATION_SERVICE_TOKEN_IDS` and never grants operator access. See
`docs/cloud-connection.md`.

## Docker socket

The controller does not mount `/var/run/docker.sock` in live use:
`compose.live.yaml` and the staging stack pin `FRIDAY_DOCKER_ENABLED=false`,
and `scripts/verify-controller-security.test.mjs` and
`scripts/controller-container-hardening.test.mjs` fail CI if the socket comes
back. A read-only bind mount of the socket would not stop Docker API writes.
Container inventory comes from the separate read-only VM100 observer.

## Tests

`server/security/access-staging.test.mjs` uses synthetic RSA keys and a mocked
JWKS (no real Cloudflare credentials) and covers:

- no token: operational APIs denied, health and UI still served;
- valid viewer token: read, assistant and diagnostic rerun allowed, registry
  sync denied;
- registry sync needs an operator email, JSON and a same-site request;
- a fallback (non-operator) identity stays a viewer;
- wrong issuer, audience or signature, and expired tokens, all denied;
- live mode with missing team or audience fails closed.

Run with `npm test` or `make verify`. These prove Friday's side only. They do
not prove the Cloudflare Access policy, real logins, that the reverse proxy
forwards the JWT header unchanged, session expiry, or firewall rules; check
those on staging before relying on them.

## Still open

- Authentik as the primary login method (owner decision; runbook in
  `docs/friday-authentication-failover.md`).
- A shared rate limit at the ingress. Friday has no per-identity request limit
  of its own.
- Running the main container as non-root (`controller-nonroot-cutover`,
  needs a VM102 maintenance window).

Reference: [Validating Cloudflare Access JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).
