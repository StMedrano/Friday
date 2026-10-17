# Friday staging post-login security acceptance — 2026-10-13

**Login policy:** Use [Authentik as primary and Cloudflare One-time PIN only as outage break-glass](friday-authentication-failover.md). Cloudflare does not automatically make secondary IdPs outage-only. Keep One-time PIN off Friday's allowed login methods until an operator confirms Authentik is down and activates the exact-email fallback policy. Fallback sessions remain Viewer-only because they lack the signed Authentik source claim.

**Scope:** `https://friday-staging.mytechtactics.com`, Cloudflare team `mytechtactics.cloudflareaccess.com`, draft PR #29. The user reported the staging dashboard loads after a successful Access sign-in. The private staging controller runs separately from production Friday; **no production release is approved**.

## Automated checks completed

Run from the existing PR source checkout:

```sh
FRIDAY_EDGE_ORIGIN=https://friday-staging.mytechtactics.com \
FRIDAY_EDGE_TEAM_HOST=mytechtactics.cloudflareaccess.com \
node scripts/check-friday-edge-readiness.mjs
```

This performs anonymous **GET-only** tests on `/`, `/index.html`, `/api/overview`, `/api/agents`, `/api/assistant` and `/healthz`. It neither follows redirects nor reads/prints login cookies, redirect URLs, JWTs or response bodies. It accepts 401/403 or an HTTPS sign-in redirect to **exactly** the configured team host under `/cdn-cgi/access/`, rejects wrong-team redirects, generic redirects, 404, 429, 503, network errors and exposed 2xx. A passing anonymous denial check is **necessary but not sufficient** to prove the policy, authentication or token revocation.

VM100 inspected 2026-10-12: staging healthy, rootless UID 10001, read-only rootfs, zero host port bindings and zero mounted production volumes; staging tunnel running without restarts; external anonymous requests returned 302 and direct staging origin calls returned 401 (local health 200). The candidate branch is draft; production Friday and VM100 NPM/observer remain untouched.

## Isolated session and signing-key acceptance — 2026-10-13

Added three synthetic origin-verifier checks on PR #29: cached keys do not extend identity validity past the exact JWT expiry; an unknown signing key refreshes only after the 30-second cooldown and a removed key is rejected after rotation; an expired JWKS cache fails closed during an outage and recovers after key retrieval resumes. All eight verifier tests pass. Temporary mutations of each relevant guard were rejected by the corresponding new tests; the candidate implementation was unchanged.

`FRIDAY_DOCKER_SOCKET_GID=999 make verify` passed (the group value is a Compose-validation fixture, not a live socket configuration). Post-build signed Access integration checks passed 6/6. These synthetic tests do not establish live Cloudflare logout, revocation, Allow policy, or unlisted-identity behavior. Browser inspection remains blocked by the Windows runtime initialization error `HRESULT 0x80070003`. No session was logged out, no policy changed, and no production or staging deployment occurred.

## Expiry during signing-key retrieval — regression fixed 2026-10-13

A synthetic delayed-key regression reproduced authorization of an identity that expired while JWKS retrieval was in progress: expiry was checked before the asynchronous fetch but not at the final authorization decision. The verifier now rechecks expiry after signature verification, immediately before returning the identity and operator role. The regression failed on the previous candidate and passes with the two-line fix; all nine verifier tests pass.

Full `FRIDAY_DOCKER_SOCKET_GID=999 make verify` passed (388 Node passes, one expected pre-build compiled-UI skip), followed by all six post-build signed Access integration tests. The fixture group value only validates Compose. No production/staging deployment, session logout, credential rotation or Access policy change occurred. Live identity/session acceptance and the external security release gate remain open.

## Separate automated review and malformed-request recovery — 2026-10-13

A separate reviewer examined the authentication source (`server/security/cloudflare-access.mjs`, `server/http.mjs`, and `server/config.mjs`) at `82c7746` and assessed the expiry fix at `f98bb4c`. The reviewer found an uncaught URL parse failure before authentication: a malformed HTTP Host or absolute request target could reject the asynchronous request callback and terminate Node. An isolated child-process test using the actual Friday server and raw TCP requests reproduced `ERR_INVALID_URL` and process exit before the patch.

The handler now catches URL parse failures and returns a sanitized HTTP 400. The regression checks both malformed inputs and a subsequent health 200, proving the server survives. All six API-boundary tests, full verification (390 Node passes), frontend build, Compose validation, and post-build Access 6/6 passed. The reviewer confirmed the catch addresses the reproduced crash. CI #441 passed on the preceding expiry-fix commit.

The source review found no additional confirmed authentication bypass in its limited scope. It noted repeated JWKS retrieval during concurrency/outages without establishing deployment-level exploitability. This review is automated, not external human approval, and does not cover the whole PR, live Cloudflare configuration, or authenticated deployment acceptance. Release holds remain unchanged. No live deployment or session/policy change occurred.

## Outstanding manual/access-policy acceptance

- **Unlisted identity:** In InPrivate, sign in with a separate email address **not on Friday Staging's Allow policy**. Confirm Cloudflare denies access. Do not broaden Include (OR), use Everyone/Bypass, or add the unauthorized test email to the policy. Capture status and time only; never capture login tokens.
- **Allowed viewer:** Confirm the dashboard, assets, Inventory and `/api/overview` load after login. Test that operator-only mutations remain denied; staging intentionally configures no operator email allowlist.
- **Logs:** Zero Trust → Insights → Logs → Access authentication logs. Filter by `Friday Staging` and verify that intended allowed/denied identity decisions are recorded; omit personal identifiers in PR evidence.
- **Logout/expiry:** Only with user approval, navigate to `https://friday-staging.mytechtactics.com/cdn-cgi/access/logout` and confirm login is required again. Cloudflare logout may affect other Access applications. Cloudflare Access is authoritative for session revocation; offline origin JWT signature verification alone cannot determine whether an unexpired token has been revoked. The origin must stay inaccessible except through the protected tunnel.
- **Independent reviewer:** PR #29 still needs an explicit review by someone independent of implementation and a separate production release approval.

## Credential rotation — completed with staging-only approval

On 2026-10-12, the two obsolete stopped token-bearing connectors were guardedly verified and removed. On 2026-10-13, the user rotated the staging token in Cloudflare and privately staged its replacement. The approved staging-only cutover replaced the protected token file and recreated only the dedicated cloudflared sidecar. Four tunnel connections, no connection/token errors, internal health 200, origin anonymous 401 and public anonymous trusted-team 302 were verified. The temporary old-token backup and pending replacement were removed. The user then confirmed “I can login”; this is user-reported browser acceptance, not independent authenticated API capture.

These steps are complete; **do not rotate again or recreate the connector merely to repeat this handoff**. This does not establish that all historical external token copies were erased. Production, NPM, Access policy and Phase 2C were unchanged.

## Staging restart fix — applied and verified on VM100

Commit `511b9f70e237900fce24cbd0f0099c42c7bb3c97` makes both staging services use `restart: unless-stopped`. CI #437 passed. After VM100 reconnected on 2026-10-13, the existing staging app was inspected: healthy, UID10001, read-only root, no host ports or volumes, but still `restart: no`. Applied only the reviewed one-line staging Compose policy and `docker update --restart unless-stopped` to that existing app. Both staging services now report `unless-stopped`; IDs and start times are unchanged, so neither service was restarted or recreated. Internal health returned 200, protected origin routes returned 401, and all six public anonymous checks returned trusted-team 302. The connector has four registered connections, zero restarts and zero error lines. NPM is running, observer healthy, and VM102 production remains healthy/unchanged. Do not reboot VM100 or Docker for testing. See [staging reboot recovery](cloudflare-friday-staging-vm100.md#staging-reboot-recovery-2026-10-13).

## Historical rotation procedure — for a separately authorized future rotation

Before the completed cleanup, earlier user-run `docker run --token ...` commands retained the tunnel token in two **stopped** Docker container configurations. Merely transferring a token to a mode-0400 file does **not** rotate/revoke it. Do not print the token, send it to chat/GitHub, or remove/restart production services.

Cloudflare recommends a controlled rotation through Zero Trust → Networking → Tunnels → **friday-staging-vm100** → Refresh/Rotate token. The old token cannot establish **new** connections after refresh, but existing tunnel connections remain until restarted. Because there is only **one active staging connector**, plan for brief staging downtime unless a second connector replica is staged. With separate user permission: refresh staging token, install it privately as UID 65532-readable file, recreate only the staging cloudflared sidecar, verify four connections, no-cookie 302 and allowed login, and only then remove obsolete stopped containers (separately approved). In case of trouble, do not touch NPM or VM102 production; restore staging from the approved private configuration.

Official references: [Tunnel token rotation](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/remote-tunnel-permissions/), [Access sessions](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/), [Access logs](https://developers.cloudflare.com/cloudflare-one/insights/logs/dashboard-logs/access-authentication-logs/).
