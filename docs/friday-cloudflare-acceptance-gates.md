# Friday staging post-login security acceptance — 2026-10-13

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

## Outstanding manual/access-policy acceptance

- **Unlisted identity:** In InPrivate, sign in with a separate email address **not on Friday Staging's Allow policy**. Confirm Cloudflare denies access. Do not broaden Include (OR), use Everyone/Bypass, or add the unauthorized test email to the policy. Capture status and time only; never capture login tokens.
- **Allowed viewer:** Confirm the dashboard, assets, Inventory and `/api/overview` load after login. Test that operator-only mutations remain denied; staging intentionally configures no operator email allowlist.
- **Logs:** Zero Trust → Insights → Logs → Access authentication logs. Filter by `Friday Staging` and verify that intended allowed/denied identity decisions are recorded; omit personal identifiers in PR evidence.
- **Logout/expiry:** Only with user approval, navigate to `https://friday-staging.mytechtactics.com/cdn-cgi/access/logout` and confirm login is required again. Cloudflare logout may affect other Access applications. Cloudflare Access is authoritative for session revocation; offline origin JWT signature verification alone cannot determine whether an unexpired token has been revoked. The origin must stay inaccessible except through the protected tunnel.
- **Independent reviewer:** PR #29 still needs an explicit review by someone independent of implementation and a separate production release approval.

## Credential rotation — completed with staging-only approval

On 2026-10-12, the two obsolete stopped token-bearing connectors were guardedly verified and removed. On 2026-10-13, the user rotated the staging token in Cloudflare and privately staged its replacement. The approved staging-only cutover replaced the protected token file and recreated only the dedicated cloudflared sidecar. Four tunnel connections, no connection/token errors, internal health 200, origin anonymous 401 and public anonymous trusted-team 302 were verified. The temporary old-token backup and pending replacement were removed. The user then confirmed “I can login”; this is user-reported browser acceptance, not independent authenticated API capture.

These steps are complete; **do not rotate again or recreate the connector merely to repeat this handoff**. This does not establish that all historical external token copies were erased. Production, NPM, Access policy and Phase 2C were unchanged.

## Staging restart fix — verified in code, live application pending

Commit `511b9f70e237900fce24cbd0f0099c42c7bb3c97` makes both staging services use `restart: unless-stopped`. CI #437 passed. The existing live staging app still needs its policy checked and, if unchanged, updated without recreation after VM100 reconnects. VM100 Desktop Commander was offline during the continuation check; no live policy change is claimed. Do not reboot VM100 or Docker for testing. See [staging reboot recovery](cloudflare-friday-staging-vm100.md#staging-reboot-recovery-2026-10-13).

## Historical rotation procedure — for a separately authorized future rotation

Before the completed cleanup, earlier user-run `docker run --token ...` commands retained the tunnel token in two **stopped** Docker container configurations. Merely transferring a token to a mode-0400 file does **not** rotate/revoke it. Do not print the token, send it to chat/GitHub, or remove/restart production services.

Cloudflare recommends a controlled rotation through Zero Trust → Networking → Tunnels → **friday-staging-vm100** → Refresh/Rotate token. The old token cannot establish **new** connections after refresh, but existing tunnel connections remain until restarted. Because there is only **one active staging connector**, plan for brief staging downtime unless a second connector replica is staged. With separate user permission: refresh staging token, install it privately as UID 65532-readable file, recreate only the staging cloudflared sidecar, verify four connections, no-cookie 302 and allowed login, and only then remove obsolete stopped containers (separately approved). In case of trouble, do not touch NPM or VM102 production; restore staging from the approved private configuration.

Official references: [Tunnel token rotation](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/remote-tunnel-permissions/), [Access sessions](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/), [Access logs](https://developers.cloudflare.com/cloudflare-one/insights/logs/dashboard-logs/access-authentication-logs/).
