# Friday Repository-Aware Agent Platform v1 Design

## Goal

Turn Friday's local agent definitions into a usable local-first agent platform that can inspect and later work on any explicitly registered Git repository without granting arbitrary filesystem access.

## Approved architecture

Friday remains the control plane. The request path is:

`Friday UI -> Friday API -> Orchestrator -> Agent Repository -> Agent Runtime -> Tool Registry -> approved repository tools -> Ollama`

The existing local Agent Specification, Ollama runtime, and permission model remain authoritative. Supabase is not introduced.

## Repository registry

Friday maintains a local repository registry. Each repository has:

- `id`: stable Friday identifier.
- `name`: display name.
- `path`: canonical local Git working-tree path.
- `remote`: optional Git remote URL.
- `defaultBranch`: repository default branch.
- `mode`: `read-only`, `development`, or `pr-enabled`.
- `enabled`: whether agents may select it.
- `exclude`: paths never exposed to model context.

Only explicitly registered roots are accessible. Canonical path validation must reject traversal, symlink escape, and requests outside the registered root.

Default exclusions include `.env`, `.env.*`, private keys, credential files, `.git` internals except allowlisted metadata commands, dependency/build directories, and configured secret paths.

## Agent registry and API

The local JSON-backed AgentRepository from the local-agent-core milestone is the initial source of truth. Add read-only endpoints for agents and repositories. API responses expose safe metadata only: IDs, names, descriptions, provider/model, tools, permission modes, scope, repository mode, and availability. They never expose secret file contents or credentials.

## Explorer v1

Codebase Explorer receives concrete read-only tools scoped to one registered repository per task:

- repository metadata/status
- bounded directory listing
- bounded UTF-8 file read
- text/code search
- Git history/log metadata
- dependency/manifest inspection

Every tool request passes through ToolRegistry and repository-scope validation. Explorer cannot write, commit, push, deploy, or execute arbitrary shell commands.

## Orchestrator v1

Add a small deterministic routing layer rather than an autonomous planner. It accepts a task plus repository ID, validates that the repository and requested agent are enabled, selects Explorer for repository-analysis requests, records task state, invokes the agent runtime, and brokers tool requests through the permission gateway. Later milestones can extend the same contract to Developer, Tester, Reviewer, and GitHub Engineer.

Initial task states: `QUEUED`, `ANALYZING`, `WAITING_APPROVAL`, `COMPLETED`, `FAILED`.

## UI

Replace the generic Agents detail view with an Agents workspace backed by `/api/agents`. Show agent name, purpose, model, status, tools, and permission summary.

Add a Repositories workspace backed by `/api/repositories`. Show registered repositories, local/remote identity, branch, access mode, and availability. This milestone is read-only in the UI; repository registration remains server-side configuration until mutation controls have their own approval design.

The existing Overview Agent Mesh should use the same safe agent data instead of hard-coded agent names when available.

## Security boundaries

- No unrestricted shell tool.
- No arbitrary filesystem browsing.
- No model access to secrets or excluded files.
- Undeclared tools and permissions default to forbidden.
- Repository access requires an enabled registry entry.
- Write-capable Developer operations remain isolated and approval-gated in later milestones.
- Tester and Reviewer do not receive push/deploy authority.
- Production deployment remains forbidden until a separate production-control design is approved.
- Tool attempts and outcomes are auditable.

## Persistence

v1 uses local JSON configuration/cache for agents and repositories so Friday remains operational offline. PostgreSQL + pgvector remains the planned durable store for task history and semantic memory, but is not required to make repository discovery or Explorer v1 work. Redis is not required for this milestone.

## Testing and acceptance

Tests must prove repository traversal and excluded-secret reads are blocked; undeclared/forbidden tools cannot execute; only registered repositories are selectable; agent/repository APIs return safe metadata; Explorer can inspect a registered fixture repository; and existing Friday safety/read-only tests remain green.

The milestone is complete when Friday can display its real local agents and registered repositories, accept a repository-scoped analysis task, route it to Codebase Explorer, safely inspect that repository through registered read-only tools, and return grounded analysis without arbitrary filesystem or mutation authority.
