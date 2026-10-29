# Friday post-merge security remediation — operator registry sync and Docker isolation

**Scope:** Server-side, deny-by-default hardening before any deployment of merged Friday Phase 2C. This is NOT permission to release, enable agents, or expose new endpoints.

## Operator registry synchronization

The previous browser-accessible POST /api/agents/registry/sync accepted unauthenticated requests and could update Friday-owned agent state. Its replacement rejects requests unless the application has a 32-byte random hex token configured under the server-only FRIDAY_REGISTRY_SYNC_OPERATOR_TOKEN setting and the caller supplies the exact value in Authorization: Bearer TOKEN.

- Missing or invalid server configuration returns 503 operator-auth-unconfigured; absent/wrong/malformed bearer returns 401 operator-auth-required. All rejection paths run before invoking registry service methods.
- The comparison uses constant-time digest equality. Invalid request payloads continue to produce 400 after successful authentication.
- No token is placed in the browser, frontend bundle, responses, logs, Git catalog, or Git configuration. No production token has been generated or configured by this PR.
- The public UI no longer offers unauthenticated manual synchronization; normal server startup still uses its pre-existing validated Git-registry sync.
- Operators may later generate a value using openssl rand -hex 32 and store it via the approved server secret management workflow. Never place the token in a public URL, chat log, browser, or tracked file. Operator action should be performed only over an approved private/trusted channel.
- The FRIDAY_REGISTRY_SYNC_OPERATOR_TOKEN Docker environment entry is unset by default. Configuring it in a deployed container is a separate operator decision; environment variables may be visible to privileged Docker administrators.

## Raw Docker socket removal

The live Compose override no longer mounts /var/run/docker.sock or enables FRIDAY_DOCKER_ENABLED. A read-only bind mount of the raw Docker socket does not constrain Docker API writes. VM100 observer is the separately scoped read-only inventory path. Both Compose configurations are validated in CI, and regression tests reject reintroducing the raw socket into the browser-facing controller.

## Still unresolved — no deployment approval

This PR does not implement identity-based authentication for /api/overview, /api/agents GET, diagnostic rerun, agent inference or assistant requests. Publicly accessible read and compute endpoints must be placed behind a validated identity gateway and/or authenticated application sessions with role-aware authorization, including negative anonymous tests and rate limits, before a safe production rollout.

The documented npm lockfile/advisory findings and root/mutable-filesystem hardening are also separate required tasks. The current production image remains unchanged and healthy, and Phase 2C remains disabled with no agent assignments or enabled plugins.

## Verification and rollout gates

Use npm test, npm run build, npm run validate:fabric-catalog, npm run verify:fabric-dormant, isolated PostgreSQL/Compose checks, then GitHub CI on the exact feature commit. Obtain independent review of the patched authentication boundary and reverse-proxy behavior, then separate operator approval for the chosen image update and any future model/plugin/agent activations.


## Candidate Cloudflare Access application JWT verification

Live mode always requires Cloudflare Access origin verification. Before running it, an administrator must create a Cloudflare Zero Trust Access self-hosted application protecting https://friday.mytechtactics.com and copy the application audience (AUD) tag and HTTPS team domain into the server-side `FRIDAY_ACCESS_AUD` and `FRIDAY_ACCESS_TEAM_DOMAIN` values. Configure `FRIDAY_ACCESS_OPERATOR_EMAILS` as a comma-separated set of individually approved operator identities; an empty list grants **no** operator privileges. No Access credentials or JWT values belong in the browser source, CI, Git history or documentation.

Cloudflare forwards its signed Cf-Access-Jwt-Assertion application token to the origin. Friday verifies the RS256 signature with the configured team's HTTPS JWKS, matches the configured application audience and issuer, validates timestamps, requires an identity-bearing subject, and rejects service tokens on the human API. It ignores unverified identity headers, caches signing keys briefly, and fails closed if verification fails. Authentik is the required primary login method at the Access edge. Friday grants Operator status only when the signed email is in `FRIDAY_ACCESS_OPERATOR_EMAILS`; emergency identities therefore must not appear in that allowlist. A valid identity may view the normal Friday inventory and ask advisory agents. Only an explicitly allowlisted identity can request diagnostic reruns and, additionally with the server-only bearer credential, registry synchronization. Browser cross-site mutation requests are rejected before processing writes. Expensive POST requests are bounded to 20 per identity per minute **per process**; production ingress must also enforce shared quotas, abuse controls and appropriate logging without leaking tokens.

Only /healthz and /api/health remain unprotected by this middleware for health monitoring. The static UI must also be protected by the Cloudflare Access **edge application policy**. Origin signature verification does not create a login page or substitute for correct edge enrollment, session expiry testing, operator email maintenance or proper upstream header forwarding.

**Release gates:** obtain team domain and AUD tag from the Cloudflare dashboard, confirm the chosen identities have appropriate Zero Trust Access policies, verify Nginx Proxy Manager forwards the JWT header unchanged, verify Cloudflare Access enforces UI access, and test anonymous/authorized/operator/expired-token paths on a disposable staging deployment. Ensure direct backend TCP/3010 stays restricted to the approved VM100 reverse proxy. Without the Cloudflare team config, the candidate's API fails closed with HTTP 503. This is intentional; do NOT deploy before stage testing and explicit approval.

Reference: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/


## Additional fail-closed staging contract (October 12, 2026)

Release code derives Access enforcement from **FRIDAY_MODE=live**; there is no separate enable flag. A live-mode instance without a valid team domain and audience responds **503** for protected APIs. If the identity configuration is valid but a request has no or invalid signed JWT, protected APIs respond **403**. This avoids accidentally opening live APIs by omitting Access configuration.

The origin authorization boundary verifies Cloudflare's signed JWT for operational APIs. `GET /healthz` and `GET /api/health` remain available for limited health monitoring. The static UI is protected by the Cloudflare Access edge policy, so direct backend TCP/3010 access must remain restricted to the approved reverse proxy. Administrators **must verify edge enrollment and JWT forwarding on a disposable staging deployment** before production.

Automated security acceptance includes synthetic RSA-signed JWTs and locally mocked JWKS in `server/security/access-staging.test.mjs`; no real Cloudflare credentials, identities, egress, or live user data are required. Cases cover missing and spoofed headers, expired or wrong-audience tokens, valid signed viewer access to read/assistant endpoints, operator-only rerun and registry sync with a second server-side secret, and cross-site write denial. A separate isolated container check runs the **actual production entrypoint in live mode without configuration** to confirm an unconfigured release denies operational APIs and model requests while remaining healthy.

These deterministic tests prove application-side behavior, **not** real Cloudflare Access policy configuration, user login, Nginx header passthrough, session expiry, IP firewall policy, or safe rollout. All such external acceptance and independent review gates remain open.
