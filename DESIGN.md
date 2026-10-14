# Friday interface design

Friday is an operator workspace for TechTactics/Web Growth, App Builder and HomeLab. Its primary job is to make real availability and advisory scope easy to inspect. Calm density, readable status and safe decisions take precedence over decoration.

## Ownership and existing identity

Runtime CSS is canonical (Model B). This document records intent and ownership; it does not generate another token system. Preserve the existing graphite/cyan identity, system font stack and Lucide icons. Do not invent a TechTactics logo, brand palette, business metrics or running workers.

- Global shell: `src/styles.css`, the existing `--surface`, `--line`, `--muted`, `--cyan`, `--green`, `--amber` tokens.
- Group workspace: `src/agents.css`, scoped under `.v3-agents-workspace`.
- Component behavior and fetching: `AgentsWorkspace.tsx`; header, real totals and group navigation: `AgentsWorkspaceHeader.tsx`.
- API and authorization: `docs/codex/API_CONTRACT.md`, strict `src/lib/api.ts` client and server Access boundary. Display membership never establishes a private-data grant.

## Workspace token mapping

| Role | Runtime owner | Accepted value / behavior |
| --- | --- | --- |
| Main text | agents.css / --agent-text | #edf4f8 |
| Secondary text | agents.css / --agent-muted | #a6b3c3 |
| Supporting text | agents.css / --agent-faint | #8d9bad |
| Panel / raised panel | agents.css / --agent-panel, --agent-raised | #0c1016 / #111820 |
| Control / selected surface | agents.css / --agent-control, --agent-accent-surface | #151e28 / #122a35 |
| Control boundary | agents.css / --agent-control-border | #53677d for search and primary action controls |
| Visible boundary | agents.css / --agent-border | #2a3644 |
| Selection / focus | existing --cyan | #67d9ff, 2px focus outline with 3px offset |
| Configured / unavailable | existing --green, --amber | Static semantic marker plus text; never a running/pulsing-worker claim |
| Pointer feedback | --agent-motion-fast | 120ms; explicit properties only |
| Panel/answer entry | --agent-motion-enter, --agent-ease-out | 180ms opacity; cubic-bezier(.23,1,.32,1) |

The shared font family stays unchanged. Workspace body/fields use 14px, metadata 12–13px, role names 14px, group labels 15px and title 26–34px. Mobile fields use 16px. Monospaced styling is unnecessary for prose; count values use tabular numerals.

## Layout and interaction

- Three group controls communicate the actual role catalog; the registered-agent view remains separate.
- Totals use API metadata. A configured binding is not a running worker. Pending/unavailable data never becomes an invented zero.
- Native buttons with aria-pressed preserve Tab/Enter/Space behavior. Search has a visible associated label. Keep focus where the operator placed it.
- Role search is transient local UI state, scoped to the current group or registered list; do not persist its query or send it to an API.
- A filter that hides the selection clears its detail, prompt and reply, and cancels any pending ask. Switching groups clears the search. No-results recovery clears search.
- Keep the read-only ask form, unavailable/disabled denial, request cancellation and stale-response protection.
- Work/customer/memory integration is disconnected. No execution controls, permission changes or provider activation belong in a visual refinement.
- Native document scrolling owns the screen. Lists/details have natural height; no viewport lock or hidden-scrollbar treatment.

## Responsive and motion rules

At desktop widths the roster and detail use two columns. Group controls stack below 900px; roster/detail stack below 700px. Controls have at least 44px targets; narrow screens wrap long metadata and explanations instead of clipping them.

Pointer feedback is gated to hover-capable fine pointers. Pressed scale is .985 and excludes focus-visible keyboard controls. Everyday group/role selection has no sliding layout animation or interaction delay. New panels/answers use opacity only through progressive-enhancement @starting-style. The loading indicator rotates only while pending. Reduced motion disables animation/transitions and transforms. Do not animate width, height, layout or status markers.

## Refinement scope and remaining drift

This continuation migrates the group workspace's tiny 7–10px labels to readable type. The older dashboard shell retains its established sizing and unrelated visuals; a full shell typography/navigation audit is a later bounded slice. The group workspace uses meaningful surface hierarchy and quiet dividers without decorative gradients or glass blur.

Verification evidence belongs in `docs/codex/BUILD_STATUS.md` and the PR description. Browser fixture previews do not prove authenticated live acceptance or a complete WCAG audit.
