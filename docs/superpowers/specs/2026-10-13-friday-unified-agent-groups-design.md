# Friday unified agent groups — draft design
Date: 2026-10-13
Status: Draft for operator review; no implementation or runtime activation.
Repository: StMedrano/Friday
Prerequisite: security PR #29 release acceptance.

## User outcome
Friday is the operator's single workspace for all agent teams. TechTactics Web Growth agents and App Builder agents appear in Friday, with their work, handoffs, context and artifacts. Existing business records and approval history survive integration. A group name is an organizational boundary, not permission to execute tools.

## Verified starting point
Friday's Phase 1 registry supports advisory agents. Phase 2B provides work, decisions, handoffs and scoped memory. Phase 2C provides Git-authoritative group policy, skills and capability descriptions, but remains dormant and does not include a group UI, executor or background scheduler. Each agent has one primary policy group.

StMedrano/TechTactics/web-growth-agent contains seven role instructions: Manager, Scout, Auditor, Designer, Sales, Accounting/Tax and Legal. Its team documentation establishes approved outreach followed by a separate send action. Leads and communication/approval history live in a JSON version-1 lead store. Its current Express server exposes lead/report reads and approval/send/stage writes; Friday must not blindly proxy that server or expose those writes.

Reviewed source references:
- Friday docs/fabric-phase2c.md and the 2026-10-11 Phase 2C design.
- TechTactics web-growth-agent/company-os/TEAM.md and CONTEXT.md.
- TechTactics web-growth-agent/src/server.ts, store.ts and types.ts.
Source discovery is not proof that any role has a running autonomous worker.

## Approaches
1. Recommended: Friday owns the workspace, agent identities and authorized work context; existing Web Growth logic remains a private integration behind a narrow adapter. Preserve the original store and send boundary.
2. Move all Web Growth code and data into Friday immediately. Fewer long-term repositories, but mixes migration, UI, provider, permission and delivery changes. Defer.
3. Embed the old dashboard as a link or iframe. Quick navigation, but does not unify work or authorization. Does not meet the requested outcome.

## Group layout
| Friday group | Initial members | Status |
| --- | --- | --- |
| TechTactics | Manager, Scout, Auditor, Designer, Sales, Accounting/Tax, Legal | Existing role sources to integrate |
| App Builder | Coordinator, Planner, Developer, Reviewer, QA | Proposed initial roles, not existing workers |
| Infrastructure | Existing Proxmox Observer | Preserve current advisory behavior |

TechTactics's Web Growth department is a display/work category inside the TechTactics group. Do not introduce nested policy inheritance or multiple primary groups. Keep the existing engineering example intact. Stable policy IDs are techtactics, app-builder and infrastructure; migration of the existing Proxmox agent assignment is separately reviewed, not automatic.

Each agent has its own stable ID, primary group, role/source revision and runtime state. States distinguish catalogued, configured, ready, busy, blocked and unavailable. Do not infer a running worker from a role Markdown file.

## First implementation slice: group workspace
Add an authenticated read-only Groups workspace: group list, member list, agent detail and related authorized work/artifact summaries. Each agent can remain unavailable until its integration is configured. An unavailable integration is visible, with a reason; no fabricated progress or preview data in live mode.

Reuse the current registry and Phase 2B work services. Add display metadata in a versioned sidecar rather than modifying Agent Spec v1.1 or treating skills as executable code. Validate sidecars against registered IDs and approved group membership. Membership and capabilities are server-derived; browser input cannot grant a group or memory scope.

Register new group/role definitions only through a reviewed catalog release. Preserve the dormant catalog guard until a separately reviewed activation plan replaces it. Listing organizational metadata must not quietly activate Phase 2C policy, inference or execution.

## Second slice: Web Growth integration
Keep the existing lead store authoritative initially. Add a private server-to-server read adapter with fixed configured origin, authenticated backend access, bounded timeouts/body sizes and a projected schema. Never accept arbitrary URLs from a browser request. Because current Web Growth reads lack an explicit application authentication boundary, harden the backend read interface before connecting Friday; network placement alone is not an application credential.

Project lead summaries, pipeline stage, audit evidence and artifact references into the TechTactics workspace. Preserve source IDs, timestamps and source revision. Do not copy bank/tax identifiers, secrets, raw email contents or unrelated customer records into ordinary group context. Missing backend returns unavailable, never empty-success data.

Do not import or relocate leads.json in this slice. Do not copy customer records into Git. Later migration requires backup, record counts/checksums, approval/send-history preservation, rollback and an explicit cutover.

## Third slice: authorized work and App Builder
Use Phase 2B work IDs, accepted decisions, checkpoints and handoffs for group tasks. Bind every read to trusted actor, project and exact group/owner scope. Cross-group handoff transfers an explicitly authorized bounded packet, not unrestricted access to another team's memory.

Initial App Builder roles support planning, code review, implementation proposals and QA evidence. Friday does not gain arbitrary shell, Git push, deployment or autonomous tool execution merely because these role names are present. A later bounded worker/executor design must define isolated jobs, exact grants, durable audit, approvals and cancellation before real build/deploy work is exposed.

Retain free-first model intent. Preserve current Phase 1 local-only behavior. Web Growth currently uses Gemini; do not silently switch providers, promise free capacity or change billing while integrating the workspace. Provider/model selection and unavailable/quota state remain explicit server-side settings.

## Authorization and compatibility
- Viewer reads only authorized group/project records.
- Operator/admin changes require explicitly designed routes, trusted identity, role checks and durable audit; read slices add none.
- Lead approval never implies send approval. Integration does not resend outreach or reset pending/needs_review state.
- Existing Friday infrastructure/advisory paths remain unchanged.
- Existing TechTactics business site, portal and Web Growth store remain operational during incremental integration.
- Credentials stay in private server configuration; no VITE variables, role files or group manifests contain keys.
- External customer communication, production deployment and financial/legal actions retain their explicit human gates.

## Acceptance
1. Group pages show the stated group/member mappings and distinguish unconfigured roles from ready workers.
2. Anonymous and unauthorized users cannot read group data; another group's/project's work and memory are excluded.
3. A crafted assignment, group ID, role instruction or handoff cannot grant tools or additional scopes.
4. Mock mode is clearly labelled and uses only synthetic fixtures.
5. Private Web Growth reads preserve source IDs, stages, approval/send states and artifact provenance; timeout/schema/auth errors are visible.
6. Integration makes no lead-store writes, sends no email and invokes no financial/legal or infrastructure mutation.
7. Existing Phase 1, Phase 2B and dormant Phase 2C invariants remain green until separately approved activation.
8. Test-first regressions, production frontend build, CI and separate code review cover each slice.

## Release order
Complete PR #29's security acceptance first. Review this written design, then write/review the first slice implementation plan. Build the group workspace on a separate feature PR, followed by the private Web Growth adapter and authorized task integration. Roll out each verified slice independently with rollback; do not merge group changes into the security PR to bypass its holds.

Production PR #29 still needs live unlisted-identity and allowed-viewer/operator-denial evidence, policy/log and logout/session acceptance, external security review, production identity-forwarding/origin/ingress checks and verified backup/copy-only migration/cutover authorization. Passing CI does not establish these facts.
