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
