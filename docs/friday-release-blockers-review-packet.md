# Friday security release blockers — reviewer and operator packet

**Prepared:** 2026-10-12. **Scope:** GitHub [draft PR #29](https://github.com/StMedrano/Friday/pull/29), branch `feat/friday-operator-auth-20261011`. This is a **self-authored evidence packet**, not an independent review or approval. Follow the PR's latest HEAD and latest passing CI run at review time.

## Release decision: HOLD

The following are not interchangeable: passing CI, anonymous network denial, real Cloudflare login, an independent security approval, and a safe production data migration. **Every gate must have evidence before a deployment.** All production changes are withheld until separately approved.

| Gate | Current state / evidence | Required completion |
|---|---|---|
| Cloudflare Access self-hosted application | **OPEN.** No confirmed application AUD, team domain, identity allow policy, or ingress forwarding. Anonymous `https://friday.mytechtactics.com/`, `/api/overview` and `/api/agents` returned HTTP **200** on 2026-10-12. | Create and test the correct app/policy, verify JWT header forwarding through Nginx Proxy Manager and enforce origin validation in an isolated staging release |
| Independent security review | **OPEN.** PR #29 has 0 submitted independent reviews at packet creation. | Assign a genuinely separate qualified reviewer and obtain an explicit GitHub approval of the **final exact commit**, including findings/dispositions and any residual risks |
| Production data backup/migration | **OPEN.** Existing volume `friday_data`, `/data` 0:0 mode 755; monitoring state 0:0 mode 600, ~90,564 bytes. | After approved maintenance-window and verified backup, copy to a **different** volume owned by 10001:10001 without mutating old data, validate integrity, test rollback, then obtain deploy approval |
| Release authorization | **OPEN.** Draft PR, production controller/VM100 services unchanged, Phase 2C disabled. | Separate explicit operator approval for merge, staged release, production cutover, and any later Phase 2C activation |

## A. Cloudflare Access setup — requires Cloudflare account administrator

Friday's required login policy is Authentik Generic OIDC as the normal provider and Cloudflare One-time PIN as an outage-only break-glass provider. Follow [Friday authentication failover](friday-authentication-failover.md). Cloudflare Access does not automatically expose a fallback only during an Authentik outage. Keep the Friday application restricted to Authentik in normal operation; activate the exact-email OTP policy manually only after confirming an Authentik outage. The signed Authentik source claim is required for Friday Operator status, so fallback identities remain Viewer-only.

1. From the Cloudflare Zero Trust dashboard open **Access controls → Applications**. Inspect whether Friday already has an appropriate Access application. If none exists, create a **Self-hosted public** application protecting **only** `friday.mytechtactics.com`. **Creating a policy on that live hostname can immediately change who can log in; coordinate the change and test on a separate staging hostname first.** Avoid granting all emails or anonymous access.
2. Add an explicit Allow policy for the minimum authorized identities. Require strong identity-provider sign-in with MFA as configured in the organization's IdP. Configure separate operator emails for privileged Friday actions; verify that unlisted users are denied. Do not publish an operator-token secret to browsers.
3. From **Applications → [Friday app] → Configure → Additional settings**, copy its **Application Audience (AUD) Tag** and the team's HTTPS URL (`https://<team>.cloudflareaccess.com`). These values are identifiers, not secrets. Preserve them in server-only release configuration as `FRIDAY_CF_ACCESS_AUD` and `FRIDAY_CF_ACCESS_TEAM_DOMAIN`. Set `FRIDAY_PUBLIC_ORIGIN=https://friday.mytechtactics.com` and a precisely scoped `FRIDAY_CF_ACCESS_OPERATOR_EMAILS` allowlist. In `FRIDAY_MODE=live`, application-side Access verification is mandatory regardless of the `FRIDAY_CF_ACCESS_ENABLED` flag.
4. Nginx Proxy Manager (on VM100) must forward the **signed** `Cf-Access-Jwt-Assertion` header through the HTTPS route without accidentally deleting or replacing it. Friday's origin verifier checks RS256 signature, issuer, AUD, times and signed email using the team's HTTPS JWKS. An arbitrary client-supplied email header is never identity evidence.
5. Perform all acceptance checks against a **disposable staging controller and staging hostname**, with no production data and no live secret migration: unauthenticated HTML/assets/overview/agents/assistant denied, authorized viewer pages and API work, unknown viewer/operator mutations 403, approved operator + separate registry token write allowed only in the fixture, foreign Origin denied, expired/wrong-audience/forged JWT rejected, session expiry/revocation tested. Ensure direct access to backend TCP/3010 is blocked outside approved VM100 reverse-proxy routes; confirm ingress-level shared rate limiting.
6. Only after staging review, schedule a separate approved live-policy change. Test real sign-in from a private/incognito browser and a second authorized identity; use Cloudflare dashboard/audit evidence. Do **not** paste live JWTs, login cookies, secrets, API tokens, or unredacted reverse-proxy configuration into GitHub or this chat.

**Read-only negative preflight:** Run `node scripts/check-friday-edge-readiness.mjs` from a safe external vantage point. It sends anonymous GETs to the public hostname and prints only status codes. It exits nonzero on 2xx, network errors, 404, generic redirects or other ambiguous results. A legitimate Access login redirect or 401/403 is **necessary but not sufficient** to prove the live policy works; actual authorized/unauthorized login and origin forwarding require separate evidence.

Cloudflare reference: [Self-hosted applications](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/) and [JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).

## B. Independent security reviewer handoff

Assign an independent reviewer who is **not the author or sole implementer**, request a formal GitHub review for PR #29 and pin the review to its final exact HEAD. Do not count automated tests, self-review comments, an AI summary, or draft PR status as independent approval.

Review these specifically:
- `server/security/cloudflare-access.mjs`, `server/http.mjs`, `server/config.mjs`, `server/security/access-staging.test.mjs`: JWT verification, JWKS key rotation/fetch limits, key-ID matching, fail-closed config, public health exemption, role authorization, token in headers, origin check and request throttling, malicious/expired token acceptance, real identity-provider behavior.
- `observer/docker-proxy.mjs`, `observer/docker-proxy.test.mjs`, `observer/compose.yaml`, `scripts/test-observer-proxy-isolation.sh`: raw Docker socket remains confined to proxy with root-equivalent privileges; two allowlisted read-only endpoints, projected/sanitized JSON, raw logs denied, input bounding, DoS/error behavior, untrusted observer compromise and unauthorized lateral movement.
- `Dockerfile`, `compose.yaml`, `compose.live.yaml`, `scripts/scan-controller-image.sh`, `observer/Dockerfile*`: dependency lock, pinned runtime toolchain, Alpine package upgrade, Trivy scan boundaries, rootless capabilities/read-only rootfs, non-root writable volume.
- `scripts/test-friday-volume-migration.sh`, `docs/friday-dependency-container-hardening.md`: fixture-only migration, no source writes, actual production backup integrity, file owner/modes, downtime and rollback.
- Source supply chain, risk tradeoff that raw Docker log diagnostics are disabled, OpenAI/model/plugin and Phase 2C capability activation gates.

**Review output required:** GitHub **APPROVED** review of final PR revision, explicit disposition of every HIGH/CRITICAL finding, list of residual risks, Cloudflare staging acceptance evidence (without sensitive tokens), backup validation report, and author/operator signoff on deployment strategy. Any requested changes reset the relevant review/CI gate and require revalidation.

## C. Production volume readiness — read-only stage is complete, migration is NOT

The script `sh scripts/check-friday-volume-readiness.sh` inspects only the currently mounted named volume and metadata. It does not copy or back up files, inspect secrets, change file modes, stop containers or mutate data. Observed on 2026-10-12: root-owned `/data` and mode-0600 root-owned `monitoring-state.json`. Re-run before every maintenance window and compare with a verified backup inventory.

**After independent security review and separate user approval only:**

1. Record image digest and Compose/release config; capture a **consistent** offline volume backup after pausing writes and verify backup integrity before any copy. Record recovery procedure, disk capacity, and explicit cutover window.
2. Keep `friday_data` untouched for rollback. Create a **new** named volume `friday_data_hardened`; mount original **read-only** in a one-off helper and copy file contents/modes, changing UID/GID **only in new volume**. Verify full checksums, filenames/permissions and monitoring JSON compatibility. Do not `chown` or `rm` the original.
3. Run a staging clone in non-root/read-only mode with copied data and no public ingress; test health, persistent monitoring state, authentication and available providers. Capture evidence of clean startup and rollback.
4. Set `FRIDAY_DATA_VOLUME=friday_data_hardened` only for the approved new release and verify mapping explicitly. If failure, stop the candidate and restart **the recorded previous image with the original `friday_data`**. Never reconcile divergent new state blindly. Preserve both volumes until acceptance signoff.

CI already runs a deterministic isolated fixture migration, including byte-for-byte verification; that does **not** constitute a verified backup or live cutover.

## D. Operator checklist

- [ ] Independent reviewer assigned and review requested on GitHub
- [ ] Cloudflare team domain/AUD and least-privilege allow policy confirmed
- [ ] Signed JWT forwarded through Nginx reverse proxy; staging browser session acceptance passed
- [ ] Anonymous public API rejected and direct backend blocked; legitimate sign-in works
- [ ] Controlled ingress rate limits, origin allowlist and audit logging checked
- [ ] Backup/restore owner, volume checksums, image digest and maintenance window approved
- [ ] Exact PR HEAD CI including vulnerability scans, staging and fixture migration passed
- [ ] Independent APPROVED review and user production release approval
- [ ] Only then: merge, staged cutover, production migration and smoke checks as separately authorized

**Hard stop:** No merge, live Access policy change, production data migration, VM100 proxy replacement, Friday release or Phase 2C activation from this packet alone.
