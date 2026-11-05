# Friday operator authorization and Docker isolation

Ported from PR #109 (`integration/friday-development-main-20261029`) and
corrected to match `main` as of 2026-11-05. The #109 version described a
second operator bearer token and a per-identity rate limit; **neither exists
on `main`**. Those are listed under "Not on `main`" below rather than
described as current behavior.

This is a description of current code, not permission to deploy, enable
agents, or expose new endpoints.

## Origin verification

Live mode always requires Cloudflare Access origin verification
(`server/security/access.mjs`, switched on by `FRIDAY_MODE=live` in
`server/config.mjs`). An administrator creates the Cloudflare self-hosted
Access application for the Friday hostname and puts its team domain and
audience tag into the server-only settings `FRIDAY_ACCESS_TEAM_DOMAIN` and
`FRIDAY_ACCESS_AUD`. `FRIDAY_ACCESS_OPERATOR_EMAILS` is a comma-separated list
of individually approved operator emails; an empty list grants **no**
operator rights. These go in the deployment environment (`compose.live.yaml`
passes them through), never in a `VITE_*` variable, browser code, CI or Git.

Friday verifies the RS256 signature against the team's HTTPS JWKS (cached for
an hour), the exact issuer and audience, `exp`/`nbf`, and a non-empty `sub`.
Service-token JWTs are rejected on the human API. Unsigned identity headers
are ignored. Any verification failure denies the request.

| Situation | Response |
| --- | --- |
| Live mode, team domain or audience missing/malformed | 503 `access-verification-unavailable` |
| JWT missing, malformed, forged, expired, wrong issuer/audience, or JWKS unreachable | 403 `access-denied` |
| Valid JWT, operator-only route, email not allowlisted | 403 `access-denied` |

Only `GET /healthz` and `GET /api/health` bypass this check. The static UI is
protected by the Cloudflare Access **edge** policy; origin verification does
not create a login page and does not replace correct edge enrollment, session
expiry testing or header forwarding by the reverse proxy.

## Operator-only routes

Defined in `server/http.mjs`:

- `POST /api/agents/registry/sync`
- `PUT /api/settings/sites`
- `POST`, `PUT`, `DELETE` under `/api/settings/endpoints` and
  `/api/settings/repositories`
- `GET /api/audit/events`

Registry sync, site-settings writes and settings-collection creates/updates
must send `Content-Type: application/json` (otherwise 415 `json-required`).
Every `POST`, `PUT` or `DELETE` carrying `Sec-Fetch-Site: cross-site` is
rejected with 403 before any handler runs. All rejections happen before a
service method is called.

Any verified identity may read inventory, ask `POST /api/assistant`, and
request `POST /api/incidents/<id>/diagnostics/rerun` (read-only re-checks;
audited through `runAudited` when the action audit is enabled).

## Docker isolation

`compose.yaml` does not mount `/var/run/docker.sock` and defaults
`FRIDAY_DOCKER_ENABLED` to `false`; `compose.live.yaml` forces it to `false`.
VM100 Docker visibility comes only from the separate read-only observer
(`observer/`, behind its Docker socket proxy). `make verify` validates both
Compose configurations.

## Automated coverage on `main`

`server/security/access-staging.test.mjs` uses synthetic RSA-signed JWTs and
a mocked JWKS, with no real Cloudflare credentials, identities or network.
It covers missing and spoofed headers, forged/expired/wrong-audience/
wrong-issuer/service tokens, Viewer reads, assistant and reruns,
operator-only registry sync with JSON and same-site checks, a non-operator
fallback email staying Viewer-only, and the 503 fail-closed response when
live mode has no Access configuration. `server/http.security.test.mjs` and
`server/security/access.test.mjs` cover the same boundary at unit level.

These tests prove application behavior only, **not** the real Access policy,
user login, reverse-proxy header passthrough, session expiry or firewall
rules.

## Not on `main` (from #109, not ported)

- **`FRIDAY_REGISTRY_SYNC_OPERATOR_TOKEN`**, a second server-only bearer token
  for registry sync with `operator-auth-unconfigured` /
  `operator-auth-required` errors. `main` gates sync on the operator email
  allowlist only. Adding it would be a separate, reviewed change.
- **Rate limiting** of expensive POSTs (#109 described 20 per identity per
  minute per process). `main` has no request rate limiter; shared quotas and
  abuse controls at the ingress remain open work.
- **Operator-only diagnostic reruns.** On `main` any verified identity may
  rerun diagnostics.
- An isolated container check that boots the production entrypoint in live
  mode with no Access configuration. `main` covers this case in-process in
  `access-staging.test.mjs` only.

## Release gates

Before any deployment that changes this boundary: confirm the team domain and
audience from the Cloudflare dashboard, confirm the Access policies for the
chosen identities, verify the reverse proxy forwards `Cf-Access-Jwt-Assertion`
unchanged, and test anonymous, Viewer, operator and expired-token paths on the
staging stack (`deploy/staging/`). Keep direct backend TCP/3010 restricted to
the approved reverse proxy. Run `make verify` and get exact-head CI green.

Reference: <https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/>
