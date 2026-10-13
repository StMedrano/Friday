# Friday guarded server actions — Phase P8 foundation (DRAFT)

**Status: internal module only, never deployed, never exposed as HTTP, no real write-capable executor.** This feature is a staged prerequisite for controlled homelab operations, not permission for Friday's model/agent outputs to run server commands. Base review branch: Friday security PR #29.

## What exists in this draft

- A strict, typed `service.restart` action contract for *explicit exact* `vm100:name` or `vm102:name` targets. The action name and target must both be pre-allowlisted by a trusted operator; unknown names, ad-hoc shell commands, prompt text or paths fail closed. The initial allowlist is empty and no service is enabled by default.
- Operator-generated `requestId` and state transitions `pending → approved → executing → succeeded/failed`. A **verified** Operator or Administrator may request; a **different** verified Administrator must approve; a verified Administrator must explicitly invoke execution. A model response cannot satisfy these verified identity checks.
- `executionEnabled=false` and `killSwitch=true` are hard defaults. Execution additionally requires a separate, injected narrow `executor.dispatch({actionId,target,requestId})` adapter. **This branch does not implement a Docker/SSH/systemd/Proxmox write adapter, API route, scheduled runner, approval UI or deployment.**
- An append-only JSONL journal writer can fsync each event before mutation dispatch. The journal's parent must be a user-owned private directory, and the file cannot be a symlink or readable by group/others. Only fixed event metadata is written, not model prompts, tokens, raw command text or executor errors. Mutation is blocked if the audit write fails. A post-execution audit failure produces an unknown outcome, never an automatic retry.
- Pending approvals are **process-local** and deliberately discarded after a restart. Audit events persist but **are not yet a durable action-state repository**. Do not activate on multiple replicas or assume an operation can be resumed after crash.
- Concurrency guards ensure only one dispatch attempt per approved request in one process. A shared transactional database with idempotency keys and leases is required before deploying a distributed execution platform.

## Remaining required work before Friday can touch live infrastructure

1. Complete production Cloudflare Access and origin enforcement from PR #29 with independent security approval, fixed audience and roles. This module currently takes an internal trusted actor object; it is **not** an identity verifier.
2. Define and approve the *specific* low-risk server actions, exact host/service allowlists, rollback steps, timeouts and post-action health checks. Disallow arbitrary `ssh`, `bash`, `docker exec`, commands assembled by an LLM, and unrestricted Docker or Proxmox API exposure.
3. Add a separately deployed scoped action agent with the **smallest permitted API surface** (e.g. restart only an approved test container), not a controller with a raw Docker socket. Server-side mutual authentication and least-privilege credentials are required.
4. Implement a durable transactional action-request store and approval UI, with independent reviewer approvals, approval freshness/expiry, role mapping, anti-replay and protected CSRF/origin boundaries. The current journal is audit evidence, **not** a replacement for this store.
5. Add always-on runtime kill switch and explicit enabling by an authorized operator. Start in an isolated disposable test service and verify both the success and rollback paths, then require a new deployment approval before any live action.
6. Add permission denial and adversarial model-prompt tests, full independent security review, and host inventory drift detection before enabling a single production target.

**Separation of responsibilities:** NVIDIA/NIM model fabric PR #23 is inference only. Security PR #29 is the Access/origin boundary. This stacked draft is the action governance foundation. No merge of #23, #29 or this PR alone enables server action execution.
