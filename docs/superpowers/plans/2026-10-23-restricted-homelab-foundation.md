# Restricted HomeLab continuation — safety foundation

Owner direction on 2026-10-23 authorizes a new draft continuation from freshly
verified main d4b06ec7bc233defa908549af295bd936c5578d5. PR33 is merged, PR31
is merged and PR29 is closed as superseded. Do not reopen or reuse those PRs.

## Scope decision

AGENTS/CODEX prohibit infrastructure writes before tested authentication, role
policy, durable action audit, approval and global automation controls exist.
NEXT_STEPS P8 precedes P9. Main has signed Access verification but no action
lifecycle or executor, and no NVIDIA adapter/model-router implementation.
The owner explicitly permits implementing only a coherent safety prerequisite
when the exact executor slice is unsafe. This slice therefore establishes the
internal fixture-backed safety contract. It does not declare P8 complete.

Reuse the existing signed Access operator gate and answerAssistant sequential
provider seam. Keep AI advisory; do not give models execution tools or accept
model text as approval. Do not copy the old branch wholesale, add a provider,
load secrets, configure a host or weaken existing dormant release boundaries.

## Implemented contract

- `createHomeLabControl` is disabled by default. It is never constructed by
  production bootstrap and has no public HTTP endpoint, UI or environment flags.
- Its explicit internal diagnostics operation authenticates a signed operator,
  checks the trusted automationAllowed callback before and after asynchronous
  boundaries, persists diagnostic intent before a read, then completion/failure.
  Missing/false/throwing controls fail closed. A five-second maximum deadline
  denies even an adapter that ignores cancellation; it cannot stop arbitrary
  injected code. Provision only trusted read-only adapters in any later slice.
- Diagnostics accept only symbolic `staging-canary` and a validated prompt.
  Only the enumerated health status is projected to a synthetic normalized
  overview. It enters existing advisory orchestration; raw diagnostics, headers,
  credentials and tool interfaces do not reach a model. Tests inject a fake
  Groq provider through the real assistant seam; no provider request occurs.
- Restart requests accept only the same symbolic target, expire after five
  minutes and require a separately authenticated operator plus exact
  request-ID/target/action confirmation. Durable approval uses exclusive create
  to prevent concurrent duplicate approval across service instances. Approval
  reports `approved-execution-unavailable`; it never authorizes an adapter call.
- There is no execute/restart method or Docker/SSH/HTTP action transport, no real
  container binding, and no automatic prompt-to-action inference. Every result
  reports execution.performed=false.
- Audit events are fixed-schema, private, exclusively created files, fsynced
  along with their containing directory before success. Subject hashes replace
  raw identity; prompts/tokens/provider errors/raw diagnostic data are excluded.
  Missing, malformed, overbroad-permission or symlink records fail closed.

## Trust and durability limits

Linux local filesystem contract: provision the audit directory and its ancestry
privately on trusted storage, owned by the controller UID, with mode 0700.
Records use mode 0600. The service exposes no overwrite/delete/repair interface;
this is not WORM storage or protection from an administrator/the service UID.
Do not use network filesystems without separately verifying exclusive-create and
fsync semantics. Disk failure may leave an incomplete file; it is never repaired
into authority automatically. Audit failure denies the current operation;
retention, capacity limits, backup, administrative recovery and alerting remain
operational prerequisites. The automation callback is an internal server-owned
gate, not a deployed global kill-switch control or browser-supplied boolean.

## Test-first evidence and remaining work

1. Added contract tests before implementation; empty module exports produced
   the intended missing-contract failure. After implementation the behavioral
   suite passed with real temporary filesystem state and synthetic signed JWTs.
2. New regressions demonstrated a signing-key fetch while disabled and a stalled
   diagnostic that ignored AbortSignal. Both failed before their fixes and pass
   after early gating and a bounded race/cancellation implementation.
3. Focused suites include durable reload, duplicate/concurrent approval,
   expiry/corruption, denied identities/targets/extra fields, audit failure,
   symlink/private-mode rejection, kill transition and normalized advisory data.
4. Full verification limits and exact counts are in BUILD_STATUS. Node22 CI,
   frontend/build and Compose are separate from local focused evidence.

Next: review this foundation, add persistent deployed automation policy and
request lifecycle/recovery, identify exactly one noncritical staging container
through a separately authorized provisioning process, then design a dedicated
least-privilege action transport. Before any restart, require durable one-use
execution claims, bounded at-most-once behavior, crash/timeout ambiguity handling,
pre-action checks, mandatory post-action health verification and failure audit.
None of the restart/post-action steps is implemented here. NVIDIA restoration
must be separately reviewed against current main and use server-only configured
secrets; no secret presence check or inference was performed in this work.

No HomeLab, VPN, remote Docker host, production, deployment or merge access is
part of implementation or tests. Test data is wholly synthetic.
