# Local PC trusted work actor adapter

This bounded source slice implements the approved Phase2B requirement that ActorContext comes from trusted Friday server code, never model/browser declarations. The owner development handoff authorizes local development and fixtures; it does not authorize production bindings, remote storage or task execution.

## Contract and acceptance

An internal policy has exact keys `schemaVersion: '1'` and `bindings`. Each binding has `email`, `principalId`, `projects`; each project has `projectId`, `agentIds`. Bound all arrays/text, canonicalize email/IDs and reject unknown keys or duplicate email/project/agent entries. Empty bindings are valid but authorize nobody. Invalid policy rejects the entire policy, not a partial subset.

`resolveTrustedWorkActor({identity,projectId,policy})` accepts a server-verified identity (`ok === true`, valid email) and selects only its explicit project entry. Return the existing normalized ActorContext with configured principalId, the one selected project, explicit agent IDs and **empty memory scopes**. Operator flags, group membership, model roles and extra caller authority fields cannot grant access. Missing/invalid identity, policy or binding fails with sanitized not-authorized. Do not log supplied policy/data.

Agent IDs are assignment eligibility only. The existing work-service agentAuthorizer still denies claims by default; no tool permissions, worker activation, inference or infrastructure authority is added. Personal/project/group memory needs a separate reviewed retention/access policy. This module is not wired into HTTP/bootstrap/config, so it cannot expose records or alter runtime grants.

## TDD implementation steps

1. Add failing pure tests for empty/missing/unsigned/unlisted identities, operator/group spoofing, cross-project access, malformed/ambiguous policy, exact least-privilege ActorContext and defensive projection.
2. Add a failing integration regression against the existing WorkService proving mapped eligibility does not bypass its separate agent authorizer or cause a claim mutation.
3. Implement only the pure validator/resolver, reusing normalizeActor and safeWorkError.
4. Run focused Node22 tests, full local WSL tests/build and existing CI safety/database gates; review the source. No migration or live data is needed.
5. Document source capability versus unconfigured runtime, commit/push on PR33 and retain draft state.

Ruling: build an internal mapping adapter now; defer browser APIs/provisioned project grants until the exact identity/project mapping and storage/access review exist. This advances the approved architecture without treating a catalog group or model identity as authorization.
