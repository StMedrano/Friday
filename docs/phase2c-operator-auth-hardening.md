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

The candidate live Compose override **requires** FRIDAY_CF_ACCESS_ENABLED=true. Before running it, an administrator must create a Cloudflare Zero Trust Access self-hosted application protecting https://friday.mytechtactics.com and copy the application audience (AUD) tag and HTTPS team domain into the server-side FRIDAY_CF_ACCESS_AUD and FRIDAY_CF_ACCESS_TEAM_DOMAIN values. Configure FRIDAY_CF_ACCESS_OPERATOR_EMAILS as a comma-separated set of individually approved operator identities; absent entries grant **no** operator privileges. FRIDAY_PUBLIC_ORIGIN must match the actual HTTPS browser origin. No Access credentials or JWT values belong in the browser source, CI, Git history or documentation.

Cloudflare forwards its signed Cf-Access-Jwt-Assertion application token to the origin. Friday verifies the RS256 signature with the configured team's HTTPS JWKS, matches the configured application audience and issuer, validates timestamps, requires an identity-bearing email/sub and rejects service tokens. It ignores unverified identity headers, caches signing keys briefly and fails closed if verification fails. A valid identity may view the normal Friday inventory and ask advisory agents. Only an explicitly allowlisted operator identity can request diagnostic reruns and, additionally with the server-only bearer credential, registry synchronization. Requests with a foreign Origin header are rejected before processing writes. Expensive POST requests are bounded to 20 per identity per minute **per process**; production ingress must also enforce shared quotas, abuse controls and appropriate logging without leaking tokens.

Only /healthz and /api/health remain unprotected by this middleware for health monitoring. The static UI must also be protected by the Cloudflare Access **edge application policy**. Origin signature verification does not create a login page or substitute for correct edge enrollment, session expiry testing, operator email maintenance or proper upstream header forwarding.

**Release gates:** obtain team domain and AUD tag from the Cloudflare dashboard, confirm the chosen identities have appropriate Zero Trust Access policies, verify Nginx Proxy Manager forwards the JWT header unchanged, verify Cloudflare Access enforces UI access, and test anonymous/authorized/operator/expired-token paths on a disposable staging deployment. Ensure direct backend TCP/3010 stays restricted to the approved VM100 reverse proxy. Without the Cloudflare team config, the candidate's API fails closed with HTTP 503. This is intentional; do NOT deploy before stage testing and explicit approval.

Reference: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
