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
