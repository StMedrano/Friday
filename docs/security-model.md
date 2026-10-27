# Friday Security Model

Friday is an infrastructure control plane. Its default posture is visibility first, actions later.

## Trust boundaries

- Browser: untrusted client. Never receives infrastructure or AI provider secrets.
- Friday server on VM102: reads narrowly scoped credentials from server-side environment variables.
- Proxmox: accessed through a dedicated read-only API token.
- VM100 Docker: observed through the separate token-authenticated read-only observer; Docker's native TCP API is never exposed.
- AI providers: receive normalized Friday state and a shared advisory/read-only policy, never infrastructure mutation tools.
- CT108 Ollama: GPU-backed local provider at verified nic1 `10.1.10.12:11434`; `192.168.1.70:11434` is a legacy vmbr0 rollback reference. Its firewall should permit access only from VM102.
- Optional Compose Ollama: private development/recovery service with no host/LAN-published port.
- Network devices: remain authoritative for routing, VPN, VLAN, DHCP, DNS, and firewall policy.

## Current action policy

The MVP exposes read-only data, diagnostics, command previews, and advisory assistant output only.

Allowed preview/read families include:

- health check
- active alerts
- backup status when a read adapter provides it
- network overview when a read adapter provides it
- service status
- incident diagnostics and explicit bounded log inspection

Not implemented:

- VM start/stop/reboot
- container start/stop/restart/delete
- arbitrary shell/exec
- firewall or ACL changes
- VLAN changes
- DNS/DHCP changes
- Omada device adoption/reset
- package upgrades
- file deletion

## Assistant security invariants

AI providers receive no infrastructure mutation tools.

API keys remain server-side and never use `VITE_*` variables.

Preferred provider failover is sequential:

```text
Groq -> Gemini -> CT108 Ollama -> deterministic local analysis
```

Friday never fans normalized infrastructure state to multiple providers in parallel. A provider failure is normalized before orchestration or HTTP responses. A normal model refusal is returned as the provider's answer; it is not treated as permission to bypass the refusal through another provider.

Assistant output is advisory and cannot authorize or execute infrastructure changes.

The shared AI policy requires exact service IDs, VM/LXC numbers, host names, and service-name mappings from normalized state. Providers must not infer, renumber, merge, or substitute those identifiers.

The deterministic final fallback uses existing read-only command-preview/local-analysis behavior. It does not create an execution path.

## Secrets

- Keep `.env` out of Git and restrict its file permissions.
- Use a dedicated read-only Proxmox API token.
- Keep Groq, Gemini, OpenAI, Anthropic, observer, and other provider/integration credentials in server-side environment variables only.
- Rotate any token exposed in logs, screenshots, commits, or chat.
- Do not put tokens in `VITE_*` variables because Vite embeds those values into browser assets.
- Prefer Docker secrets or a dedicated secret manager when Friday moves beyond the MVP.

## Docker boundaries

The normal production controller runs with `FRIDAY_DOCKER_ENABLED=false` and does not need a VM102 Docker socket mount for Proxmox or VM100 visibility.

If local VM102 Docker observation is explicitly enabled, treat the Docker socket as privileged even when the bind mount is read-only. Do not expose Friday directly to the public Internet and do not use local-socket access as a shortcut around the VM100 observer design.

The VM100 observer may use the local Unix socket but is constrained to fixed authenticated GET routes. It must not gain restart, stop, kill, exec, remove, image creation, volume mutation, network mutation, archive write, or arbitrary Docker-path proxy behavior.

## Diagnostics boundary

Incident Diagnostics can automatically capture one metadata-only report for supported incidents when enabled. Raw container logs are never fetched automatically. Explicit log inspection is bounded, sanitized, ephemeral, and never persisted in monitoring state/history.

Diagnostics expose no remediation endpoint.

## Operator role policy — internal foundation (draft PR #49)

`server/security/operator-policy.mjs` supplies a strictly validated,
**server-owned** role and target binding snapshot for the existing dormant
HomeLab controller. The policy uses the `sub` of a **cryptographically verified
Cloudflare Access JWT**, never role, permission, email or target assertions
from untrusted browser headers, agent prompts, or AI output. Missing, malformed,
duplicate, wildcard, unsupported or extra-field bindings deny all grants.

| Role | Fixture diagnostics | Request restart proposal | Approve another principal's proposal |
| --- | --- | --- | --- |
| Viewer | Yes | No | No |
| Operator | Yes | Yes | No |
| Administrator | Yes | Yes | Yes |
| Friday Agent | Yes (read-only) | No | No |

Roles apply only to exact configured target identifiers (currently the
unbound symbolic `staging-canary`). No role, including Administrator, grants
execution authority. The internal HomeLab controller now requires this
independent policy alongside Access authentication, the separate
`automationAllowed` kill gate, and durable audit. A proposer cannot approve
their own request, even when also an Administrator. Approval remains an
immutable *record*, not execution. Service tokens cannot become human roles.

This module is not configured, mounted, or served by production
`server/index.mjs`, and it does not modify the read-only cloud automation
listener. Before production use, trusted provisioning/rotation of subject
bindings, user lifecycle and revocation, audit completeness, role governance,
multi-instance kill-switch semantics, threat review, and live identity tests
still need separate approval. **Do not treat this as completed product RBAC or
a license to enable infrastructure writes.**

## Durable pending approval projection — stacked draft PR #50

The internal HomeLab audit store now has a **bounded read-only** `listPending`
method. It scans at most 512 events from its owner-private append-only event
directory, checks exact event filenames and record permissions, rejects
symlinks/corruption instead of returning partial results, and returns up to
50 unexpired proposals whose matching approval event is absent. Results are
ordered by expiration then request ID. The snapshot can become stale under
concurrent approval; **approval always re-reads the proposal and exclusively
appends an immutable single-use approval**. An excessively large audit backlog
fails closed and requires independently reviewed retention/archiving before
any production activation.

`createHomeLabControl.listPendingApprovals` is **internal only** and requires
signed Access identity, an exact Administrator permission for symbolic
`staging-canary`, the existing kill gate and a healthy audit store. Returned
entries contain only request ID, target, request/expiry time, pending status,
and whether the current Administrator can approve it. No actor hashes,
confirmation text or raw records are exposed. The controller has **no executor**
and returns `execution.performed:false`.

**Dependency:** PR #50 is based on draft PR #49's role policy. PR #48's
global automation gate is a separate unmerged draft. No HTTP/API route,
browser UI, real machine binding, operator provisioning, production deployment
or live HomeLab access was added. This is not a complete human approval
workflow or an authorization to run commands.

## Revocable, time-bounded operator role bindings — stacked draft PR #51

The internal `createFileOperatorRolePolicy` source module can reload
a trusted, owner-private role/target snapshot **on every authorization
check**, without an administrative HTTP endpoint or network call.
The exact canonical JSON object is:

```json
{"schemaVersion":1,"expiresAt":1793037600000,"bindings":[{"subject":"synthetic-operator","role":"Operator","targets":["staging-canary"]}]}
```

A terminating newline is required. The sample identities and timestamp
are illustrative only, not an enabled deployment configuration. The JSON
schema is exact; duplicate object keys, extra fields, noncanonical
serialization, malformed role entries, oversized files, invalid expiry,
or a window beyond 24 hours **deny every grant**. File and directory
must be owned by the current process user and inaccessible to
group/others, with no symlinked path components. It reopens the file
for every permission decision, so changing the file, removing it, role
downgrades or expiration revoke grants on the next check, subject
to ordinary in-flight request race constraints.

The existing dormant HomeLab controller receives this module only via
its explicit `rolePolicy` dependency injection, *after* signed
Cloudflare Access identity verification. Test fixtures demonstrate
that an Operator loses proposal capability and an Administrator loses
approval/queue capability as soon as grants are removed. The file
cannot assert an executable role or bypass independent approval,
single-use audit, or the kill-switch requirement. No real identity,
URL, VM, Docker container, command or key is committed.

**Release boundary:** PR #51 is stacked on draft PR #50 (which itself
depends on #49). This module is not wired to the live controller,
the independent PR #48 kill-switch, or any web endpoint. Its
purpose is a fail-closed role provisioning *foundation*, not a complete
identity lifecycle, secure operator distribution procedure or
production-ready RBAC system. Approval review and runtime multi-node
testing are still necessary.

## Async revocation boundary — stacked draft PR #52

The internal HomeLab fixture controller keeps the signed, server-verified
Cloudflare Access subject as a request-local value and re-evaluates the
server-owned role/target grant and independent kill gate after every
asynchronous trust boundary. It checks again before and after proposal
and approval audit appends, denying stale responses from revoked roles.
Tests revoke Administrator privileges during pending-queue and approval
storage reads, and Viewer privileges during diagnostics and inference.
Untrusted headers or model text cannot grant or renew a permission.

**Immutable-audit race:** Once an append is fsynced, a change of policy
during that append cannot undo the historical event. Rechecking after it
prevents returning success but is not a transaction or an authority for
actual infrastructure actions. A future executor must independently
validate fresh identity, grants, approval state and kill switch at the
action boundary. No executor, route, runtime binding or deployment exists.

## Dormant P8 safety gate composition — stacked draft PR #53

`server/homelab-safety-runtime.mjs` connects the **internal-only** HomeLab
fixture control to the existing signed Cloudflare Access identity,
`createFileOperatorRolePolicy`, owner-private durable audit store and
`createFileAutomationGate`. The last module and its original regression
suite are copied unchanged from draft PR #48 solely because that PR is not
merged. Reconcile/resolve the duplicate PR #48 files during owner review.

The factory is **disabled by default**. Without an explicit server-side
`enabled:true`, it does not create storage or initialize infrastructure
capabilities. An opted-in isolated test fixture must provide separate
absolute paths for the audit directory, role-policy file and kill-switch
file. The role file uses short-lived exact subject/target grants; the
kill file permits only a short time window, re-read at each check. An absent,
expired, malformed, symlinked, or insecure file denies operations. All
actor identity is verified against signed Access JWT, never spoofable
headers or model instructions.

Even when explicitly enabled in tests, Friday can only inspect the
synthetic, unbound `staging-canary`, persist a symbolic restart *request*
and append a **non-executing**, separate human approval. The control has
**no execute method**, no HomeLab resource binding, no public HTTP/API
route and no bootstrap in `server/index.mjs`. The user-facing Friday
dashboard and read-only cloud automation API remain unchanged.

Do not activate this source as a production control plane. Reviewer
acceptance, secure owner provisioning, global cross-instance
revocation semantics, audit repair/retention policies, request lifecycle
state transitions, and independent P9 action authorization remain
prerequisites to any real command.

## Single terminal decision lifecycle — draft PR #54

The dormant internal HomeLab proposal workflow may end in one of three
exclusive states: **approved**, **rejected** or **withdrawn**.
The original proposer can withdraw their own valid unexpired proposal,
whereas a distinct Administrator may approve or reject with an explicit
action-specific confirmation. Viewer and Friday Agent roles cannot
finalize requests. Every operation verifies the signed Cloudflare Access
principal and repeats the live server-owned role and kill-gate checks
across asynchronous audit boundaries.

All final states occupy one create-only, owner-private, fsynced
`restart-decided` audit event filename per request. The exact audit
schema includes a bounded outcome, actor hash, target and time fields.
Concurrent competing decisions cannot both succeed, even when coming
from different service instances using the same audit directory.
The pending queue treats any correctly validated terminal outcome
as completed and fails closed if it encounters forged actors,
corrupt state, orphaned events, or missing files. The history is
non-executable: an approval is **not** an infrastructure authorization.

The queue is read-only; these methods are internal to the
default-disabled symbolic staging fixture, not HTTP routes or a
published user-facing approval service. No real restart target, Docker
socket, network mutation, arbitrary shell tool, deployment or merge
is introduced. Live identity provisioning, security acceptance and
an independently reauthorizing P9 executor remain separate prerequisites.

## Authenticated, private lifecycle status lookup — draft PR #56

`createHomeLabAudit.readLifecycle` reads the exact proposal and at most one
exclusive terminal decision from the owner-private audit store. It
validates the five-minute staging TTL, terminal timestamps, actor
separation/withdrawal ownership, event pairing and file safety before
classifying the request as pending, expired, approved, rejected or
withdrawn. Missing, corrupted and inconsistent audit events deny. The
read is a **snapshot**, not an execution authorization or a global
transaction: an independent decision can arrive immediately afterward.

The internal dormant `createHomeLabControl.getRequestStatus` requires a
signed Cloudflare Access JWT, a valid server-side policy and the
independent automation gate. The verified original proposer must retain
action proposal permission, or an Administrator must retain approval
permission for the exact unbound staging target. Viewers, agents,
unrelated Operators and spoofed role headers are denied. These checks
are repeated after each asynchronous storage wait so mid-read
revocations fail closed. The output is a minimal projection with
request ID, state, target, event times and `execution.performed:false`,
**not** identity hashes, confirmations, tokens or raw audit records.

There is no user-facing API, approval dashboard, infrastructure target
mapping, execution endpoint, container restart, merge or deployment
in this change. A future executor must independently enforce its own
current identity, role, kill-switch, approval, resource and audit checks.

## Authentik OIDC identity boundary — stacked draft PR #58

A new internal `server/security/authentik.mjs` verifies a configured
Authentik OAuth2/OIDC provider's short-lived RS256-signed human *access*
JWT, never a raw trusted header. The expected HTTPS issuer is
provider-specific (`/application/o/<slug>/`), OIDC discovery and JWKS
URLs are pinned, and signed `iss`, audience, `sub`, scope, issuance and
expiration are checked. The required `friday_control` scope limits token
purpose but does **not grant roles**. Role policy continues to rely on
Friday's independent owner-private exact subject/target bindings.
Issuer-hashed Authentik subject namespace prevents same-email/same-sub
reuse across Cloudflare and Authentik. HS256, service tokens, wrong
discovery/signing keys, missing credentials and spoofed alternate
identity headers fail closed.

The dormant HomeLab safety factory's `identityProvider:'authentik'`
option is **mutually exclusive** with Cloudflare Access, opted in through
trusted server-only test configuration, and never selected from requests.
An expiring Authentik identity is rechecked after async waits, alongside
the separate role policy and global kill switch. All control APIs remain
internal, unbound to real infrastructure and non-executing; Authentik
identity cannot trigger HomeLab actions itself.

No browser SSO, callback/cookie/session, OIDC authorization-code/PKCE
exchange, logout, enrollment, production Authentik integration or
deployment is included. Those require independent implementation and
security acceptance. See `docs/authentik.md`.

## Public Authentik multi-application website SSO — draft PR #60

Normal **public website login** is distinct from Friday's privileged
HomeLab authorization. A central internet-reachable Authentik service
can serve separate provider-specific OIDC issuers for Friday and
independent future sites. Each site must have its own pinned OIDC
client ID, backend-only secret, exact HTTPS callback and app-specific
roles/cookie session. The server-only `createPublicOidcFlow` performs
authorization-code/PKCE and verifies issuer/client/nonce/time-bound
signed ID tokens using pinned discovery and RS256 keys. It rejects
cross-client callback state, replay, missing/expired state, untrusted
redirects and foreign authentication responses. A successful public
login **does not** grant `friday_control`, HomeLab or agent privileges.

No public routes, session cookies, real identity service, provider
registration, tunnel or production login changes are included.
Actual public deployment requires an atomic expiring shared state
store, CSRF-safe HttpOnly sessions, logout/revocation, safe redirects,
MFA and owner approval. Do not put public Authentik login behind a
Cloudflare Access requirement that only internal account holders can
satisfy; use targeted protections and preserve stricter barriers for
privileged Friday/HomeLab functionality.
See `docs/authentik-public-sso.md`.

## Public OIDC encrypted single-host login-state prototype — PR #62

The optional private file-backed login-state store is source-only and
**disabled by default**. It encrypts each reserved PKCE verifier/nonce/
client binding using AES-256-GCM and a server-provided key, and names
files with keyed HMAC rather than exposing the state. Its local POSIX
O_EXCL reservation and atomic hard-link terminal claim prevent two
cooperating processes from accepting the same authorization state.
Owner-only modes, symlink safety, strict TTL and authenticated encryption
are required. A bad key, corrupted state, expired token, unsafe path or
duplicate/replayed callback denies without revealing secrets.

This design is intentionally **not a cross-machine transactional
database**, distributed cluster store, web cookie, HTTP callback or
privilege token. It has no automatic retention sweep; a production
distributed identity service requires owner-reviewed atomic database
consume+expiry/cleanup, browser-bound login state, secure cookie/session
rotation, CSRF protection, MFA, rate limiting and revocation. Normal
public login remains entirely separate from HomeLab tool authorization.

## Public browser cookie/session isolation — stacked draft PR #64

The disabled-by-default `createPublicOidcBrowser` source boundary
binds one-use OAuth state to a specific initiating browser using an
HMAC-authenticated host-only `__Host-` Secure, HttpOnly,
SameSite=Lax state cookie. Before any code exchange, callback
must prove the matching browser state cookie, exact application ID
and registered HTTPS origin. Successfully verified Authentik users
receive fresh random opaque per-site session cookies, while only
HMAC token digests and issuer-qualified human identities may be
persisted in a separately injected session backend. Any unrecognized,
expired, forged, cross-site or duplicated session cookie denies.
Session reads must be backed by current, separately expiring records,
and logout requires the site's exact Origin and a CSRF synchronizer
token before durable backend revocation.

This is not a session database, browser UI, OIDC callback route,
external ingress change, role mapping or permission to execute
infrastructure operations. Multi-host transactionality, cleanup,
site callback/CSRF middleware, logout session revocation,
session/user offboarding, MFA and security review remain mandatory.
There is no connection to existing live Friday authentication.

## Family HomeLab vs TechTactics login-domain isolation — draft PR #66

`server/security/login-sites.mjs` defines exactly two explicitly
enabled login entry-site identities with independent HTTPS origins,
independent Authentik-branded IdP origins, independent login state
cookies and browser sessions. The host-specific route adapter
renders separate Family HomeLab and TechTactics login/account
screens, delegates login/callback/logout to the existing browser
and signed OIDC layers, denies mismatched hosts, client redirects
and cross-site cookies, and never transmits raw token/secret
fields in page bodies.

**Authentik Brands are only presentation/default-flow boundaries;
they are not tenant isolation or role authorization.** Both Family
and TechTactics must have distinct OAuth/OIDC clients, exact
callback URIs, permission scopes, user groups and MFA/enrollment
rules. A family login does not grant TechTactics Admin, and a
business customer login cannot reach Friday privileged HomeLab
controls. Even within the family realm, public login by itself
never authorizes an infrastructure action.

No actual HTTP endpoint is mounted, no passwords or sessions are
provisioned, and production Friday/Cloudflare, Authentik VM120,
DNS/TLS, networks, database and HomeLab remain unchanged.
See `docs/authentik-two-login-sites.md`.

## Future write-action rule

A future action engine must require all of the following before any infrastructure mutation:

1. exact allowlisted action identifier
2. target validation
3. authenticated user or documented trusted identity boundary
4. role authorization
5. dry-run/preview result
6. explicit approval where policy requires it
7. durable append-only action audit event before and after execution
8. action request lifecycle state
9. timeout and bounded retry policy
10. global automation kill switch

No natural-language model output may directly become a shell command or infrastructure API request.
