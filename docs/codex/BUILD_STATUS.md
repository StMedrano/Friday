# Friday Build Status

## Trusted work actor mapping foundation

Added the pure internal validator/resolver in `server/work/actor-bindings.mjs` under the existing approved Phase2B ActorContext boundary. The server-owned versioned policy has bounded explicit email/principal/project/agent entries; unknown keys and normalized duplicate identities/grants reject the entire policy. A verified identity selects only its named project grant. Principal and assignment eligibility come solely from that policy, memory scopes are always empty, and extra caller authority fields/operator/group claims do not grant access. The existing WorkService agentAuthorizer still denies claims separately; a mapped agent cannot cause a claim mutation by itself. No HTTP/config/bootstrap wiring, actual grants, worker activation, database reads/writes or migrations were added. Exact owner/project mapping remains requested, not inferred from Git author email.

Five new Node tests failed first for the absent module;9/9 focused tests including existing work-service coverage then passed. Full local WSL Node22 verification passed **167 frontend /468Node tests, no skips**, plus production build. Scoped source reviewer found no concrete privilege/schema/identity defects. The prior CSS addition's CRLF whitespace warning was corrected without behavior changes. An isolated built-UI fixture check also exercised history unavailable -> explicit recovery -> shared Incidents evidence -> failed refresh clearing, with no remote data.

**CI evidence:** monitoring0c6a11d passed CI472; keyboard26ec6b6 passed CI473. Recovery640b4e9 CI474 passed tests/build and earlier safety gates, but its controller vulnerability scan could not download the Trivy database because the hosted runner reported `no space left on device`. This is an infrastructure failure, not a completed vulnerability scan; no security gate was disabled. The next exact-head CI must run all unchanged gates successfully. Local make/Docker remain unavailable, so no local container/database claim is made. PR33 remains draft and no merge/deployment/main change occurred.

## Monitoring read recovery continuation

Home (desktop/phone) and Incidents now expose one explicit Refresh monitoring history control backed by the shared GET state. A refresh clears prior events, marks loading, disables repeated submission and replaces the result only after validation; later failure removes old evidence. Navigating Home/Incidents does not duplicate the read. Caller cancellation is combined with a15-second deadline. Overview disconnect/demo transitions clear live history and remove the refresh control; demo Incidents does not masquerade as live empty history. Failing-first retry/deadline and stale-transition regressions passed, followed by167 frontend /463Node tests (no skips), local WSL production build and bounded source review with no actionable findings. Existing Dashboard act warnings remain. No new endpoint, auth grant, data store, remote read or automatic poll was introduced. Keyboard predecessor26ec6b6 passed CI473; exact latest-head CI is recorded on PR33. Local make/Docker gaps remain explicit.

## Keyboard navigation continuation

The existing command palette and phone More sheet now contain Tab/Shift+Tab focus, place initial focus inside the dialog and restore the captured opener after dismissal. Escape dismisses only the top dialog when Ctrl/Cmd+K opens search above More. Closing/navigation/unmount/layout changes remove document listeners and stack entries. Existing reduced-motion styling, view-only shortcuts and API boundaries are unchanged. Added failing desktop/phone focus regressions, then failing More/stacked-dialog regressions before implementing the shared focus hook. Focused16/16 tests pass; scoped reviewer found no actionable lifecycle defects. Fresh local WSL verification passed162 frontend /463 Node tests (no skips) and the production build. Built-UI browser checks verified desktop wrap/restoration and phone stacked dismissal/focus with mock data and no horizontal overflow. Exact-head CI is checked separately in PR33. Monitoring predecessor `0c6a11d` passed CI472, including isolated container/database/security verification; postbuild Access6/6 also passed locally. Local make/Docker availability remains unchanged.

## Local PC monitoring availability checkpoint

Resumed PR #33 from verified GitHub head `9f4ea4a9dc4bc14bb13d7a12d7729206cf9b732b` (its CI passed). No existing Friday checkout was found in the inspected Windows development folders or local WSL home directories. Cloned the authorized existing branch into `C:/Users/medra/Documents/Codex/Friday`; preserved source/untracked files, used no reset/clean, merge or deployment. GitHub CLI account and remote branch access verified. Host Windows Node24 remains unchanged; official checksum-verified portable Node22.22.1 was used. Locked dependencies installed with npm ci. Repo-local LF checkout handling supports Linux scripts without changing GitHub content outside this patch.

Reproduced the server's false-empty fallback: missing monitoring runtime returned200 `{events:[]}`. Added failing HTTP, client, component and desktop/mobile integration regressions, then implemented explicit disabled503, unavailable503 and malformed502 responses. Only validated empty/recorded reads succeed; runtime errors are sanitized and recovery is allowed on later reads. Allowlisted event projection drops unknown fields, rejects malformed/duplicate/oversized data, and preserves Access-before-read/GET-only behavior. Home and Incidents show distinct loading/disabled/unavailable/invalid/empty/event states; invalid history never becomes zero verified records. Missing monitoring metadata no longer claims disabled/operating health.

Local WSL Node22 verification: **158 frontend tests passed; 462 Node tests passed with one expected prebuild compiled-UI skip**; TypeScript/Vite production build passed. Postbuild Access fixture acceptance is checked separately. Windows full-suite execution exposed existing shell/symlink/file-mode incompatibilities; the Linux run above resolved those without weakening tests. `make verify` was attempted locally and is unavailable because make is absent; Docker Desktop WSL CLI target is also absent, so local Compose/container/database verification was not performed. Exact pushed-head CI must establish those gates. Scoped source reviewer found no actionable defects; this is not independent production security acceptance.

No remote server commands, HomeLab reads, customer-data reads, API-key activation, infrastructure actions, Windows system reconfiguration, migrations, staging/production deployment or main writes occurred. Access logout/relogin, live integration acceptance, trusted project/work/conversation/memory persistence and audited approvals remain unfinished. Continue the approved feature roadmap, keep PR33 draft and PR29/31 distinct.

## Evidence-backed activity timeline — 2026-10-14

Continued the existing PR #33 branch to improve the previously preview-only Friday desktop/mobile dashboard. Added a shared ActivityTimeline component and tests. Live data comes only from the existing signed Access-protected /api/monitoring/history read; most recent events first, bounded to five. The client uses a shared read across Overview and Incidents rather than duplicate calls on navigation. Errors, empty data and preview-not-connected are distinct. Explicit mock mode displays only labeled demo examples. This timeline does not claim AI agent task execution or fabricate GitHub/project/approval events. It links to the existing Incidents viewer and does not implement privileged actions.

The new UI follows existing graphite/cyan visual language, uses read-only text status and timestamps, and has narrow-phone and reduced-motion styles. Added unit tests for ordering, provenance, permission-safe display states and navigation; existing dashboard history test initially surfaced a duplicate read and the behavior was fixed. The full CI Test step on the implementation head `faf0fb4` passed; downstream build/container/security CI validation remained in progress when recorded. No server API changes, credentials, live customer reads, runtime activation, staging change or production deployment occurred.


## Friday command-center shell refinement — 2026-10-14

The established Friday UI preview inspired a focused existing-shell enhancement on draft PR #33, not a wholesale dashboard replacement. Desktop navigation is now expandable with visible workspace labels; the top-bar Search or command button and Ctrl/Cmd+K open a searchable list of existing Friday views; Escape/backdrop/Close dismiss it. Mobile has its own search entry point. The old fixed Approvals 2 badge was removed because no backed approval queue/count exists. Top-bar connection wording now distinguishes live API, mock/demo and unavailable data; command UI states clearly that infrastructure actions are not enabled. Transitions are subtle and reduced-motion-aware.

Added Testing Library coverage for desktop search/navigation, keyboard toggle/dismissal, collapsed nav and phone search. The code was committed as test-first 739277b, implementation 117fc45 and styles c5c6a3f. The required CI Test step on c5c6a3f passed; the broader exact-head CI run #38673202511 had not finished at documentation time. No live AIDesigner inspection was possible; this is based on the user-approved concept preview, not a verified capture of the external site. No staging/production deployment, infrastructure mutation, new worker or approval API was introduced. The legacy optional views still use existing read-only placeholders; future project/task/approval tiles must only display evidence from trusted APIs.


## Private Web Growth reader source — 2026-10-14

Continued the same PR #33 branch from `67895ead892de292938650b8080f13343914ac7d`. The operator identified VM100 Docker `web-growth-agent`, port 4317, `https://techtactics.mytechtactics.com`, internal `http://infrastructure.mytechtactics.com:4317`, workspace `/srv/docker/techtactics-web-growth/repo/web-growth-agent`. Operator reports deployed GET `/api/leads` and `/api/report` accept anonymous requests; writes are also exposed. **That deployment remains unsecured for this connection and is not used by Friday.** Public repository version-1 store/types informed this implementation; the deployed checkout/revision/file path has not been verified. VM100 connector was offline; SSH hostname verification failed. No trust bypass, live customer read or deployment occurred.

Source now provides an isolated token-authenticated file reader and a fixed Friday private GET `/api/web-growth`. Friday requires signed Access in live mode plus an explicit named `FRIDAY_WEB_GROWTH_READER_EMAILS` project grant; group membership and operator status do not grant this read. Configuration is disabled and grants empty by default. HTTPS reader origin only, fixed GET path, no redirects, bounded response, timeout, strict schema and no-store responses. The companion has a read-only root/file mount, non-root UID, dropped capabilities, bounded no-symlink file reads and no Docker/socket or write routes. Projection excludes contact/address/message/proposal text, notes and credentials; it reports stage, score, timestamps, recorded approval/send state and artifact availability without inferring approval validity. It computes a byte checksum and reports owner-configured source revision, not attested deployed revision.

TechTactics UI now has pipeline stage counts, selectable lead evidence, explicit refresh, denied/unavailable states and source provenance. Missing/malformed data never becomes fabricated empty success; failed refresh removes stale data. No approval/send/stage controls or private-record model forwarding. Group proposals remain separate. Responsive lead names/headings wrap, selected borders use established tokens.

Verification: 132 frontend / 457 Node tests, TypeScript/Vite production build, base/live/observer Compose configurations and separate reader Compose validation passed. Signed fixture Access requires the private grant; reader/schema/adapter/UI regressions include denied zero-read, read-only methods, invalid/oversized projection, missing file, checksum and stale refresh. Browser fixture pipeline selection/refresh and 320px long-name layout passed (no horizontal overflow); no real data or deployed login used. Focused review found two minor presentation defects; both corrected. Two pre-existing Dashboard act warnings remain; no failing tests. Dormant model fabric remained verified. Exact published-head CI is recorded separately in PR #33.

Operational limit: source and synthetic tests only. Before live activation verify exact source file/revision and atomic-replacement behavior, least-privilege file permissions, owner-provided reader token, reviewed private TLS endpoint, explicit owner-approved reader emails and real signed Access acceptance. Single-file bind freshness must be verified or mount strategy reviewed if producer replaces the inode. Existing anonymous application write/read routes are not secured by this reader and need their own deployment fix. See `integrations/web-growth-reader/README.md`. Production/staging/main are unchanged; Access logout/relogin, NVIDIA inference, shared work/memory and audited Umbrel approval remain unresolved.


## Connected group tools — 2026-10-14

Continued PR #33 from `1ec70281ab44c2daf939306537e18fb5a9cf07ae`. The groups now have an operational **source** path for requesting Friday proposals and viewing HomeLab evidence, rather than only role metadata.

- App Builder: operator brief -> protected group-advisory API -> existing sequential AI providers -> proposed requirements/architecture/implementation/QA advice with actual model provenance.
- TechTactics/Web Growth: website audit/service/outreach draft advice through the same fixed-policy API. Existing leads, customer/approval/send state remain disconnected; no customer outreach or record writes.
- HomeLab: current service/incident panel from the existing overview API, timestamp and explicit refresh, honest mock/unavailable states; group advice uses fresh normalized infrastructure state. No infrastructure actions.
- Planned specialists remain planned. This is Friday assistance, not role execution, a worker scheduler, shared work/memory persistence, private-data authorization or a deployed agent activation.
- POST /api/group-advisory accepts only fixed group ID and bounded prompt; rejects browser-supplied authority/context fields; preserves signed Access, same-origin and shared inference quota. Live unconfigured Access fails closed. No deterministic fallback is mislabeled as a business plan. New result metadata is projected/validated, with execution=false.
- HomeLab client validates and projects only displayed evidence, clears stale snapshots before refresh, supports explicit retry and exposes a keyboard-focusable services scroller. Group navigation aborts client waits/discards late replies. Provider work already in progress may finish within existing server timeouts; browser cancellation is not an executor cancellation claim.
- Six new HTTP tests failed before implementation and passed afterward. Seven component tests and a group-wiring test cover generation/provenance, no automatic inference, retry, invalid response, isolation, cancellation, refresh failure and mock/malformed evidence. Two minor review findings (fallback metadata validation and scroller focus) received failing regressions before fixes; follow-up review had no remaining actionable findings.
- Full local verification: **129 frontend / 441 Node tests**, production build and three Compose validations passed. Postbuild signed Access 6/6 and dormant checks passed. The new route also passed a real synthetic signed-JWT HTTP acceptance test. Two pre-existing Dashboard act warnings (also present on baseline) remain test-harness warnings, not failures. These include fixtures, not live Access acceptance.
- **Live provider smoke:** one public toy to-do app brief, no customer or infrastructure data, through the existing privately configured Groq adapter with App Builder server policy. Returned cloud-ai, `openai/gpt-oss-20b`, 2347 characters, no fallback; no key/raw model output logged. Confirms generation, not the correctness of a real customer project or authenticated browser acceptance. NVIDIA inference remains unverified.
- Browser end-to-end fixture preview used the actual Friday HTTP route/library and built UI with synthetic providers/records. Proposal submission/provenance, group isolation, HomeLab read/refresh and mock labels worked. It did not alter or connect deployed services.

Production, staging, main, lead stores, database grants and workers were unchanged. Access logout/relogin remains unresolved; Umbrel restart still requires the authenticated allowlisted durable approval/audit workflow. Broad independent security review remains deferred but mandatory before release. This candidate is not deployed; publish/CI evidence belongs in PR #33.


## UI and role discovery continuation — 2026-10-14

Continued the existing PR #33 implementation branch from `7eb9ccd95f147356b54c30e4cf7cd5b615fd772f` using the TechTactics UI Design workflow. This is source implementation and fixture-preview evidence, not a deployed application update.

- Agents now uses readable 12–16px supporting/field text, a clearer title hierarchy, graphite panels, contextual group icons, state badges and visible selected/focus treatments. Configured markers are static and never imply running workers.
- Header/summary/navigation presentation is separated into `AgentsWorkspaceHeader.tsx`; counts come from the received catalog and deduplicated configured bindings. Loading/unavailable metadata does not invent totals. Advisory/configuration notices remain visible even when group metadata fails.
- Local role search filters the current group or registered list by name/ID, without network queries or persisted search. Group changes reset it; no-results offers Clear search. Hiding a selection clears prompt/detail/reply and aborts its pending ask. Delayed registry responses cannot render filtered-out agent detail or an ask form; an explicit visible selection still targets its own endpoint.
- Motion uses fine-pointer 120ms feedback, optional 180ms opacity entry and a pending-only loading indicator. Reduced motion disables transitions, transforms and spinner animation. Keyboard controls have no sliding movement/delay. No animation library or new dependency.
- `DESIGN.md` records the existing runtime token owners, workspace styling, responsive behavior and preserved semantic boundaries. Full-shell typography/navigation refinement remains separate.
- Browser fixture checks at 320, 768, 1024 and 1440px showed no horizontal overflow. Desktop/phone previews, group selection, search, detail selection and keyboard focus were inspected. Sample supporting-text contrast was 6.74:1 / 7.00:1 and search/action control-border contrast 3.27:1. This is bounded verification, not a full WCAG or assistive-technology audit; reduced-motion handling was source-reviewed.
- Four initial role-discovery tests failed before implementation and passed afterward. Additional cancellation coverage passed. The focused reviewer found a delayed-registry/filter race and loss of advisory copy during group failure; both received failing regressions before fixes and passed the follow-up independent UI review with no remaining actionable findings.
- Final fresh `FRIDAY_DOCKER_SOCKET_GID=999 make verify` passed **121 frontend / 434 Node tests**, TypeScript/Vite build and three Compose configs. Postbuild signed Access fixture checks **6/6** and fabric dormant verification passed. Source scope is UI + design/handoff docs; no API/auth/runtime configuration changed. Exact published-head CI must be checked separately.

Production, staging and main were not changed. Private Web Growth/customer/work/memory connections, live worker acceptance, NVIDIA inference verification, Access logout/relogin and authenticated allowlisted audited Umbrel approval remain unresolved as recorded below.


## Feature continuation and operational evidence — 2026-10-14

Continued the existing PR #33 workspace on `feat/friday-group-workspace-20261013`, associated with the approved design in PR #31. Reconciled local `e45cf81` to published `92c2418b55b8ed2fa5f4b63744e69c01b539081a` after confirming both trees equal `df91f55fe5ca1a4f31468c8eeddc3ad3005e7238`; preserved the original local commit in `backup/group-local-e45cf81`. No duplicate implementation branch or PR was created.

### What is operational

| Capability | Evidence and limit |
| --- | --- |
| TechTactics/Web Growth, App Builder and HomeLab group screens/API | Implemented and locally tested in draft PR #33. Three groups / 19 roles; only existing Proxmox Observer is bound. New roles are planned definitions. This task did not deploy or establish authenticated live group acceptance. |
| Private Web Growth leads, send state and customer records | Not connected to groups. No reads, data moves or outreach introduced. |
| Group work, artifacts and memory | Not connected to the workspace; trusted actor/project/group authorization still required. Phase 2C remains dormant. |
| HomeLab advisory operation | Existing read-only registry/Proxmox advisory code preserved; this task did not activate or verify live workers/adapters. |
| NVIDIA readiness tool | New explicit read-only catalog mode, fixed NVIDIA HTTPS GET, private key-file checks, 15-second timeout, redirects refused, no retries or prompt body, sanitized result. Does not change runtime configuration or enable inference. |
| NVIDIA live check | Private user-configured key file present. One catalog check from the development controller returned `model-unavailable` for `meta/llama-3.1-8b-instruct`. This proves no inference readiness and does not establish that the catalog endpoint authenticated the credential. No model output, key or raw response was logged. |
| Cloudflare Access logout/relogin | **Unresolved functional regression:** operator reported inability to log back in after logout. No successful reproduction/fix or session acceptance is claimed. Access policies and identity controls were not weakened. |
| Umbrel restart | **Not operational.** No target discovery or restart occurred. Must await authenticated RBAC, exact verified endpoint/container allowlists, durable audited approval, timeout/idempotency and post-action health verification. PR #32's foundation is separate; membership/model output cannot authorize execution. |
| Production/staging/main | No deployment, service restart, runtime configuration change, merge or main-branch write in this continuation. Previous production health/rollback evidence below is historical; live health was not revalidated here. |

Broad independent security review is deferred per the operator's feature-completion direction, but release prerequisites remain binding. PR #29 stays separate and draft. Existing checks and dormant boundaries continue to apply; deferral does not authorize an unsafe merge or bypass.

### Verification for this slice

Six catalog-readiness tests failed first for the absent function, then passed with implementation. Existing four inference-consent/redaction tests remained green. Fresh `FRIDAY_DOCKER_SOCKET_GID=999 make verify` passed: 114 frontend tests, 434 Node tests, production TypeScript/Vite build, and base/live/observer Compose configuration checks. No services were started by Compose validation. Exact-head GitHub CI must be checked after publication; prior CI #450 passed on baseline `92c2418`.


## Group workspace candidate — 2026-10-13

Feature branch `feat/friday-group-workspace-20261013` is stacked on PR #29 candidate `138e42f`. This is source implementation evidence, not live deployment or activation. The reviewed Task 3 baseline was `91df14cc6bc125ed55dfb5d55d2670b0d68f2e53`.

- Display-only TechTactics (7), App Builder (5), HomeLab (7) catalog; only Proxmox Observer binds the existing registry. Planned roles stay catalogued even if a similarly named registry definition exists.
- Authenticated GET-only `/api/agent-groups` returns validated display metadata and unavailable linked members during a registry outage. No task/customer/memory data, instruction bodies, credentials, policy grants or new running workers.
- Agents preserves existing advisory registry browsing and adds keyboard-accessible groups/member states, request cancellation and stale-reply isolation.
- Overview replaces hardcoded active/ready worker rows with deduplicated configured bound-member counts and an Agents navigation control. Configured does not mean running; registry/API failure displays unavailable. Desktop and phone show “Actions not enabled” without a simulated automation checkbox. Phone incident/assistant ordering is retained.
- Task 4 TDD: five new tests failed before implementation; five passed afterward; two existing assistant regressions also passed after adding the new client mock.
- Full `FRIDAY_DOCKER_SOCKET_GID=999 make verify`: 21 frontend files / 114 tests, 403 server/observer/script tests, production TypeScript/Vite build and base/live/observer Compose validation passed with synthetic fixture values.
- Fabric catalog and dormant checks, both schema validators, disposable PostgreSQL migration/grant/lease/handoff/decision checks and five concurrent dual-claim trials passed. `npm audit`: zero vulnerabilities. Post-build Access staging suite: 6/6 passed, using synthetic signed identities and built assets; this does not establish live Access acceptance.
- Built-browser visual QA was unavailable; no screenshot or authenticated live UI acceptance is claimed. Independent task/whole-branch review and exact-head CI remain release gates.

No registry writes, provider calls, infrastructure activation or deployment occurred. Phase 2C stays dormant; HomeLab telemetry activation, Web Growth integration, trusted work/customer/memory bindings and controlled actions require separate plans. Verified production rollback reference remains `friday-release:0fba466`; immutable recorded source/archive target is `0fba466e7e142105b3048af0c38d3fb3960ebd07`. Revalidate that target and the offline backup at an authorized future cutover; this development task did not inspect runtime state.

This is the source-of-truth handoff ledger for coding agents. Update it when a major capability changes.

## Current security release checkpoint — 2026-10-13

This checkpoint takes precedence over the older rollout entries below. Those dated entries remain historical evidence, not instructions to repeat PR #19 deployment.

- Continue existing **draft PR #29**, branch `feat/friday-operator-auth-20261011`. Verified implementation baseline: `511b9f70e237900fce24cbd0f0099c42c7bb3c97`; [Friday CI #437](https://github.com/StMedrano/Friday/actions/runs/38409074041) succeeded. Subsequent documentation-only revisions do not imply a new runtime deployment.
- Candidate code now includes signed Cloudflare Access identity checks, operator-only mutations, same-origin/rate controls, pinned npm dependencies, non-root controller hardening and a restricted Docker observer broker. These are PR changes, not proof of production adoption or independent security acceptance.
- Isolated VM100 staging is deployed. Token rotation and obsolete stopped-connector cleanup completed with specific approval; user reported successful login after rotation. Anonymous staging edge checks were repeated during continuation: all six routes returned trusted-team 302. Unlisted-identity denial and logout/expiry acceptance remain open.
- **Staging restart policy applied and verified on VM100 after reconnection:** both existing services report `unless-stopped`. Only the app's Compose line and runtime restart policy changed; container IDs/start times are unchanged. No app/connector restart, recreation or VM/Docker reboot occurred. Stage health 200, protected origin 401 and six public trusted-team 302 checks passed. The connector reports four connections, zero restarts and zero error lines; NPM is running and observer healthy. This verifies policy configuration, not an actual host reboot rehearsal.
- VM102 production container was rechecked read-only: `friday-release:0fba466`, running and healthy. No production checkout, state volume, integration or network change was made.
- **Unresolved production Access regression reported 2026-10-14:** after explicitly logging out, the operator could not complete a new production login. Reports around the failure included reaching the Access login screen followed by a 502, 404, or another error; root cause is not established. Staging availability does not close the production defect. No policy, tunnel, token, connector, origin or Friday runtime change was made while recording it. Keep this as a PR #29 release blocker and investigate only through an approved non-destructive session with sanitized status/log evidence; never weaken or bypass Access to recover login.
- PR #29 remains draft/unmerged with zero submitted independent reviews. Remaining release gates: independent review, Access policy/negative-identity/session evidence, production Cloudflare/NPM acceptance, verified offline backup and separately approved copy-only UID10001 migration/cutover. Phase 2C remains disabled.

- Continuation on 2026-10-13: CI #440 passed all 37 steps on `82c7746`. A subsequent test-first fix closes identity expiry during asynchronous signing-key retrieval; the final authorization decision now rechecks expiry. Full local verification and post-build Access 6/6 passed. This is candidate source work only; live Access/session and independent release review gates remain open.

See [current finish queue](NEXT_STEPS.md#current-pr-29-release-queue-2026-10-13), [Access acceptance](../friday-cloudflare-acceptance-gates.md), and [VM100 staging runbook](../cloudflare-friday-staging-vm100.md).

## Historical capability and rollout ledger

## Authoritative branch, hosts, and UI

- `main` is the authoritative FRIDAY build after reviewed feature work is merged.
- Live Proxmox inventory on 2026-09-21 identifies running VM102 (`friday-controller`) as the authoritative controller. VM131 is absent.
- VM100 (`ubuntu-docker`) is managed infrastructure and hosts the separate read-only Docker observer.
- CT108 (`friday-ollama`) is the local Ollama host.
- The deployed frontend is FRIDAY UI v3 under `src/`.
- PR #5 merged Incident Diagnostics + Mobile Dashboard.
- PR #11/#12 merged the multi-provider advisory assistant and local-timeout/identifier-grounding work.
- PR #14 merged the shared session-only Friday Assistant UX.

## 2026-09-21/22 read-only nic1/vmbr1 discovery

Live state differs from the proposed address map. Deployment configuration must use the verified rows below, not the proposed host-number convention, and networking must not be changed to make live state match documentation.

| VM/LXC | Hostname | vmbr1 guest interface | VLAN | nic1 address | Prefix | Gateway | Legacy vmbr0 address | Default route |
|---|---|---|---:|---|---:|---|---|---|
| Proxmox node `home` | Proxmox VE | `vmbr1` over `nic1` | VLAN-aware trunk: 2,10,20,30,40,50,60,70,99 | none | — | none | `192.168.1.211/32` on `vmbr0` | legacy `vmbr0` via `192.168.1.254` |
| VM100 | `ubuntu-docker` | `net1` / `ens19` | 10 | `10.1.10.10` | `/24` | `10.1.10.1` | `192.168.1.124/24` on `ens18` | `ens19` via `10.1.10.1` |
| VM102 | `friday-controller` | `net1` / `eth1` | 10 | `10.1.10.11` | `/24` | `10.1.10.1` | `192.168.1.64/24` on `eth0` | `eth1` via `10.1.10.1` (one default) |
| CT108 | `friday-ollama` | `net1` / `eth1` | 10 | `10.1.10.12` (running-container interface + Proxmox config) | `/24` | `10.1.10.1` (Proxmox config) | `192.168.1.76/24` on `eth0` | configured on `eth1`; route table not directly read |
| VM110 | Umbrel / media | `net1` | 50 | not discovered | unknown | unknown | legacy address not revalidated | unknown |
| VM120 | Identity / Authentik | `net1` / `eth1` | 60 | `10.1.60.10` | `/24` | not verified | `192.168.1.73/24` | not verified from guest |
| VM131 | — | — | — | absent from live inventory | — | — | — | — |
| VM132 | Supabase production | `net1` / `eth1` | 20 | `10.1.20.10` | `/24` | not verified | `192.168.1.71/24` | not verified from guest |

Discovery sources were the local VM100 guest state plus read-only Proxmox cluster/config and QEMU guest-agent reads. `vmbr1` has no IP address and no gateway, as required. No VLAN, bridge, guest network, DHCP, DNS, firewall, Omada, or routing configuration was changed.

The proposed values `10.1.2.211`, `10.1.10.100`, `10.1.20.131`, `10.1.20.132`, and `10.1.70.120` were not verified live. In particular, Proxmox has no `10.1.2.211` interface, VM100 is `10.1.10.10`, VM131 is absent, VM132 is `10.1.20.10`, and VM120 is currently VLAN 60 at `10.1.60.10`.

### Address-reference classification

- **Current runtime/example configuration:** the VM100 observer examples now use verified nic1 `10.1.10.10:3199`.
- **Legacy/rollback configuration:** Proxmox `192.168.1.211` remains the only verified reachable management API path. It is labeled legacy until a nic1 management address is verified.
- **Current CT108 runtime/default/example configuration:** the running-container interface API verifies CT108 `eth1` at `10.1.10.12/24`; VM102 routes to it over `eth1` with source `10.1.10.11` and passes TCP/11434, `/api/tags`, and `/api/chat`. The three agent profile defaults now use `http://10.1.10.12:11434`.
- **Legacy CT108 references:** `192.168.1.70:11434` remains only in intentionally historical design/plan documents and isolated test fixtures. CT108's currently observed legacy vmbr0 address is `192.168.1.76/24`, not `.70`.
- **Test fixtures:** remaining `192.168.1.x` values in `*.test.*` are isolated adapter/provider fixtures and do not configure deployment.
- **Historical documentation:** files under `docs/superpowers/specs/` and `docs/superpowers/plans/` preserve the addresses used by their original approved designs and plans.

## Current deployed controller baseline

On 2026-09-24, read-only SSH confirmed VM102 (`friday-controller`, `10.1.10.11`) has a clean checkout at `127af8a` on the PR branch. This is behind the GitHub PR head `1f7bc0a` and does not include the current uncommitted timeout patch. VM102 `make preflight` completed without blocking errors and `make health` reported the Friday container running with health/overview endpoints OK.

Live API checks from VM102 on 2026-09-24 returned one enabled `proxmox-observer` definition with the checked-in checksum, registry status `ok` with one synced and zero rejected agents, and deterministic `/api/agents/route` selection of `proxmox-observer` at confidence `0.98` for “Summarize the current Proxmox health.” Direct Ask returned local provenance (`ollama`, `qwen3:4b-instruct`) and `execution.performed:false`, but failed grounding: it invented Site A/B networks, gateways, device counts, resource metrics, and incident history absent from the normalized live overview. It also conflated legacy and current VM100 observer addresses. This is the production failure addressed by PR head `1f7bc0a`; it is not deployed yet. Shared-composer live acceptance remains pending on a grounded build.

Do not infer that GitHub's green check on `1f7bc0a` validates either the uncommitted timeout changes or the currently deployed `127af8a` image. The production agent endpoint remains the verified CT108 nic1 address `10.1.10.12:11434`; the timeout patch has not been deployed.

## Monitoring, diagnostics, mobile, and assistant — merged

The following capabilities are already part of `main`:

- durable monitoring/incidents with read-only incident APIs;
- fixed, sanitized VM100 observer diagnostics and explicit bounded log inspection;
- purpose-built mobile operations shell at `(max-width: 700px)`;
- multi-provider advisory Friday Assistant;
- one shared browser-memory assistant session across Overview, FRIDAY, and mobile surfaces;
- provider/model/fallback provenance;
- fresh normalized Friday state authoritative over conversation history;
- no server-side assistant conversation persistence;
- no infrastructure execution authority.

PR #14 is merged; the old “finish the Friday Assistant experience” milestone is retired.

## Local Agent Platform Phase 1 — implemented in draft PR #19

Source branch: `feature/friday-local-agent-platform-phase1-20260830`.

Implemented behavior:

- Agent Spec v1.1 with deployment-independent `model.profile` references;
- Git `agents/` definitions are authoritative;
- self-hosted Supabase stores only runtime registry state in exactly two tables: `friday_agents` and `friday_agent_registry_state`;
- server-only model profiles `local-router`, `local-general`, and `local-coder` resolve to Ollama;
- explicit/manual agent override;
- deterministic routing for strong registered agent matches;
- bounded CT108 local-router classification for ambiguous requests;
- matched agents execute inference on CT108/local Ollama only and never fall back to cloud assistant providers;
- agent requests receive a fresh normalized Friday overview;
- server-side `POST /api/assistant` automatically routes matched prompts to local agents before the existing assistant provider chain while reusing the same fresh overview;
- manual Agents workspace displays registry state, definition metadata, local provenance, sync control, and direct ask flow;
- agent API surface contains exactly the Phase 1 registry/route/ask operations documented in `API_CONTRACT.md`;
- successful agent replies expose `mode:"local-agent"`, `provider:"ollama"`, model/profile provenance, and `execution.performed=false`;
- there is no agent executor, shell/SSH path, restart endpoint, delete/edit/create API, durable agent memory, task system, approval system, or infrastructure mutation authority.

Task 8 regression gates are part of CI: exact two-table schema validation, local-only matched-agent behavior, no-execution regression, secret-boundary scan, and agent-route/shell safety scans.

Shared-composer implementation tests cover deterministic Proxmox routing, same-overview identity, response provenance, grounded output, no cloud/general fallback after a matched local failure, safe no-match fallback, routing-service failure fallback, and `execution.performed=false`. Live shared-composer acceptance remains pending deployment.

### Verification result — 2026-09-22

- `make verify`: **passed** after the CT108 nic1 default migration, in a temporary Node 22 + Make + Docker Compose tool container because the discovery host lacks host-installed Node/Make.
- Frontend: **85/85 tests passed** across 19 files.
- Server/observer/scripts: **225/225 tests passed**.
- Production TypeScript/Vite build: **passed**.
- Base, live-overlay, and observer Compose validation: **passed**.
- Network configuration regression: **passed** — all three active agent defaults resolve to `10.1.10.12:11434`, no active default uses `192.168.1.70`, and VLAN 80 remains absent.
- VM100 observer nic1 health: `http://10.1.10.10:3199/health` returned 200.
- VM102 Friday nic1 health: `http://10.1.10.11:3010/healthz` returned 200 in live mode; `/api/overview` returned 200.
- Agent list, registry status, and `proxmox-observer` detail on the deployed controller: **200** on the later 2026-09-22 inspection. The status reports one synced agent, no rejections, and `sourceCommit:null`; the agent checksum matches the checked-in definition.
- VM102 `make preflight`: **passed** on 2026-09-22 with a process-local Git safe-directory override; the deployed checkout is clean on the PR branch at older commit `a12b540`.
- `make update`: **not run** because the script intentionally switches to `main`, which would not deploy this unmerged PR. The repo-local deployment skill permits an explicitly reviewed `docker compose up -d --build friday` for a PR checkpoint.
- `make health`: **not run after a new deployment**, because the PR head has not been deployed.
- Live old-build route/ask/composer comparison: `/api/agents/route` selected `proxmox-observer` with confidence `0.98`; direct `/api/agents/proxmox-observer/ask` returned `mode:local-agent`, `provider:ollama`, model `qwen3:4b-instruct`, and `execution.performed:false`. The shared `/api/assistant` returned Groq/cloud provenance and no agent ID, confirming the running build predates the PR head's agent-first composer change.

### Deadline hardening — 2026-09-24 PR verification

- GitHub PR #19 remains open/draft at `0e241b4`, merge state `CLEAN`; its `verify` check passed. The timeout changes are published in the PR but not deployed to VM102 yet.
- Added a 10-second Supabase registry request deadline and configurable local-router inference (15 seconds by default) plus local general/coder agent inference (90 seconds by default). Only the model-profile deadlines are environment-overridable through their corresponding `FRIDAY_AGENT_LOCAL_*_TIMEOUT_MS` variables. Existing general Friday assistant provider timeouts are unchanged.
- A stalled registry request maps to the existing sanitized registry-unavailable error. A stalled local router safely permits normal assistant fallback; stalled matched-agent inference returns `local-agent-unavailable` and never invokes cloud providers.
- TDD regressions cover profile defaults/overrides, stalled registry requests, stalled matched inference with no cloud fallback, and stalled routing with safe general fallback. The legacy config assertion now includes the profile timeout.
- `make verify`: **passed** from the current working tree in a temporary Node 22 Alpine tool container: 85/85 frontend tests, 232/232 server/observer/script tests, TypeScript/Vite production build, and all three Compose validations.
- The deployed health and direct-Ask evidence above are from VM102 `127af8a`, before commit `0e241b4`; they do not validate the timeout patch or the grounded-overview correction at `1f7bc0a`.

### Agents UI acceptance — 2026-09-21

Automated component and responsive CSS suites passed. Coverage confirms registry status/list/detail rendering, model/profile, scope, tools, checksum, registry sync, manual Ask, shared composer integration, and absence of Restart, Execute, Delete, Approve, Shell, Edit agent, and Create agent controls. Live desktop/mobile visual acceptance and manual Ask remain pending because the deployed registry is unavailable.

### CT108/Ollama migration status — verified 2026-09-22

- Proxmox configuration discovery: **passed** — CT108 `net1` is `eth1`, attached to `vmbr1`, VLAN 10, configured as `10.1.10.12/24` with gateway `10.1.10.1`; legacy `eth0` has no gateway.
- Running-container interface verification: **passed** through the read-only Proxmox LXC interfaces API — CT108 reports `eth1=10.1.10.12/24` and `eth0=192.168.1.76/24`.
- Authoritative controller path: **passed** — VM102 reports `10.1.10.12 dev eth1 src 10.1.10.11` and exactly one default route, via `10.1.10.1 dev eth1`.
- TCP/11434 from VM102: **passed**.
- `GET /api/tags` from VM102: **passed** — includes `qwen3:4b-instruct` and `qwen3:4b`.
- `POST /api/chat` from VM102: **passed** with `qwen3:4b-instruct`, `done:true`, and non-empty assistant content.
- Source configuration migration: **performed** — all three active agent profile defaults use `http://10.1.10.12:11434`; deployed VM102 `.env` migration remains part of the deployment checkpoint.

### Supabase rollout blocker — observed 2026-09-22

- VM132 `supabase-prod` is reachable from VM102 at verified nic1 `10.1.20.10`; the route uses VM102 `eth1` via `10.1.10.1`.
- The Supabase gateway is listening on TCP/8000, PostgreSQL/Supavisor ports are listening, and the service-role credential is present without being printed.
- Earlier on 2026-09-22, `supabase-rest` was unhealthy, authenticated service-role REST returned 503, and authenticated PostgreSQL queries failed because the server could not read `global/pg_filenode.map` (`Permission denied`). The database then restarted automatically once at 12:36:47 UTC.
- Later checks returned `supabase-rest:healthy`, service-role REST 200, successful authenticated SQL queries, and no additional restart. The data directory owner was observed as UID/GID `1000:1000` before restart; after restart the top-level directory and `pg_filenode.map` were UID 100, matching the PostgreSQL process UID. The mechanism that changed ownership has not been established, so this recovery is not yet evidence of stability.
- Both Friday registry tables exist in the `postgres` database with one agent row and one state row. Read-only inspection on 2026-09-22 confirmed exactly the two `friday_` tables, all expected columns/types/nullability/defaults, and each primary key against `supabase/migrations/202608300001_friday_agent_registry.sql`; no schema migration write is currently needed.
- The existing Supabase deployment `.env` is mode `0664`; this pre-existing credential-file permission issue was observed but not changed because infrastructure permission repair is outside this Friday application task.
- No VM102 `.env` migration, PR-head controller deployment, shared-composer live acceptance, or visual UI acceptance was performed. Investigate the ownership incident and validate sustained Supabase query readiness before deploying.

### Remaining Phase 1 rollout acceptance

Before PR #19 is ready to merge:

1. establish sustained Supabase SQL/PostgREST readiness and investigate the UID/GID ownership incident; the existing two-table schema has been validated and needs no migration write;
2. arrange VM102 access to the owner-only `.env` and clean checkout, preserve `.env`, then update the three agent URLs to `http://10.1.10.12:11434` without changing unrelated integration credentials;
3. fast-forward VM102's PR branch to the reviewed GitHub head and rebuild only the Friday controller with base Compose; do not use `make update`, which switches to `main`;
4. run `make health` and verify normal health/read-only integrations remain unchanged;
5. sync the registry and verify list, detail, and status against the deployed definition checksum;
6. verify Proxmox routing, direct Proxmox agent ask, and shared-composer automatic routing all return local Ollama provenance and `execution.performed=false`;
7. complete desktop and phone Agents workspace acceptance, then obtain explicit approval before merging PR #19.

Do not represent those live rollout checks as complete until they are actually performed.

## VM100 observer security boundary

Docker's native TCP API must never be exposed. Inventory/diagnostic IDs come from sanitized current inventory. The observer must never gain restart, stop, kill, exec, remove, image creation, volume mutation, network mutation, archive write, or arbitrary Docker-path proxy behavior.

## Not implemented yet

- Omada authenticated read-only site/device/health adapter.
- AdGuard authenticated read-only API/statistics adapter.
- Uptime Kuma/Prometheus/Grafana native adapters.
- Application authentication and RBAC.
- Durable action audit/action request store.
- Human approval queue and global automation kill switch.
- Agent tool executor or infrastructure mutation endpoints.
- Durable agent memory/task orchestration.
- Notification delivery.
- Voice input pipeline.

## Next product milestone

Finish **Local Agent Platform Phase 1 live rollout and acceptance** without adding execution authority. After that, continue read-only adapter coverage and design authentication/RBAC + durable audit + approval + kill-switch prerequisites before any controlled action work.

## Safety gate

Do not implement infrastructure-changing agent or assistant actions until authentication, role policy, explicit approval, durable action audit logging, and the global automation kill switch exist and are tested.
