# Friday staging post-login security acceptance — 2026-10-12

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

## Credential exposure and rotation — **not authorized yet**

Earlier user-run `docker run --token ...` commands retained the tunnel token in two **stopped** Docker container configurations. Transferring the correct token to a mode-0400 file on VM100 did **not** rotate/revoke it. Do not print the token, send it to chat/GitHub, or remove/restart production services.

Cloudflare recommends a controlled rotation through Zero Trust → Networking → Tunnels → **friday-staging-vm100** → Refresh/Rotate token. The old token cannot establish **new** connections after refresh, but existing tunnel connections remain until restarted. Because there is only **one active staging connector**, plan for brief staging downtime unless a second connector replica is staged. With separate user permission: refresh staging token, install it privately as UID 65532-readable file, recreate only the staging cloudflared sidecar, verify four connections, no-cookie 302 and allowed login, and only then remove obsolete stopped containers (separately approved). In case of trouble, do not touch NPM or VM102 production; restore staging from the approved private configuration.

Official references: [Tunnel token rotation](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/remote-tunnel-permissions/), [Access sessions](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/), [Access logs](https://developers.cloudflare.com/cloudflare-one/insights/logs/dashboard-logs/access-authentication-logs/).
