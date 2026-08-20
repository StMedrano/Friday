# FRIDAY Mobile Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give FRIDAY a purpose-built phone dashboard that prioritizes incidents and system health, uses a persistent bottom command bar, exposes incident diagnostics/log inspection cleanly, and preserves the existing desktop V3 command-center experience.

**Architecture:** Keep one React/Vite application and one API surface. At the existing phone boundary, switch presentation using an explicit `matchMedia('(max-width: 700px)')` hook: phones render a mobile header, incident-first Home, compact FRIDAY command surface, mobile incident detail, More menu, and bottom navigation; desktop continues to render the current V3 rail/topbar/overview. Diagnostic data comes from the incident-scoped GET APIs defined by the companion diagnostics plan.

**Tech Stack:** React 18, TypeScript 5.7, Vite 5, Lucide React, Testing Library/Vitest/JSDOM, existing FRIDAY V3 CSS tokens.

**Spec:** `docs/superpowers/specs/2026-08-19-incident-diagnostics-mobile-design.md`

**Dependency:** Implement and verify the API contracts from `docs/superpowers/plans/2026-08-19-incident-diagnostics.md` before production rollout. Frontend work may proceed against mocks once the exact contracts in this plan are locked.

## Global Constraints

- Phone breakpoint is exactly `700px`, matching the existing V3 responsive boundary; do not introduce overlapping phone breakpoints.
- At phone widths the fixed left rail is not rendered; primary navigation is `Home | FRIDAY | Infrastructure | Incidents | More`.
- Mobile Home order is: active incident attention, system health, compact FRIDAY command surface, infrastructure snapshot, prioritized service health.
- If incidents exist, the highest-priority active incident is the first major operational card after the mobile header.
- `More` exposes Applications, Agents, Tasks, Approvals, Memory, Audit, Settings.
- Desktop V3 left rail, topbar, command-center layout, and current Incidents concepts remain intact.
- Diagnostic UI clearly separates Facts, FRIDAY Findings, Likely Causes, and Recommendations.
- `Inspect Logs` is explicitly labeled read-only, performs only `GET /api/incidents/:id/logs`, and never renders restart/repair/execute controls.
- Log text is ephemeral UI state, monospaced, width-contained, and not written to browser storage.
- Minimum practical touch targets are approximately `44px`.
- Bottom navigation respects `env(safe-area-inset-bottom)` and the page has enough bottom padding to prevent content from being covered.
- Severity uses text/icon/state as well as color.
- Reduced-motion preference reduces/disables decorative FRIDAY core animation.
- No horizontal page scrolling at tested phone widths `360`, `390`, and `430` px.
- Do not add a second frontend application, routing library, UI framework, or new dependency unless a failing test proves the existing stack cannot satisfy the requirement.
- Use TDD for every component/behavior change.

---

## File Structure

### Responsive infrastructure

- Create `src/hooks/usePhoneLayout.ts` — reactive `matchMedia('(max-width: 700px)')` hook.
- Create `src/hooks/usePhoneLayout.test.tsx` — matchMedia initial/change behavior.
- Create `src/components/MobileNavigation.tsx` — bottom command bar plus accessible More sheet.
- Create `src/components/MobileNavigation.test.tsx` — navigation, badge, More behavior.

### Mobile dashboard

- Create `src/components/MobileHome.tsx` — incident-first phone Home and compact command surface.
- Create `src/components/MobileHome.test.tsx` — ordering, nominal state, service prioritization.
- Create `src/components/IncidentDetail.tsx` — shared diagnostic detail and explicit read-only logs interaction.
- Create `src/components/IncidentDetail.test.tsx` — diagnostics/logs/error/no-remediation tests.
- Modify `src/components/ActiveIncidents.tsx` and its tests — optional `onSelectIncident` / `View Diagnosis` support without breaking read-only desktop cards.
- Modify `src/components/IncidentsWorkspace.tsx` and its tests — selected incident diagnostic detail on desktop and phone.
- Modify `src/lib/api.ts` — diagnostic/report/log types and GET clients.
- Modify `src/pages/Dashboard.tsx` — phone-vs-desktop shell orchestration and selected incident state.
- Modify `tests/dashboard.test.tsx` — phone shell, desktop regression, incident navigation integration.

### Styling

- Create `src/mobile.css` — phone-only shell/navigation/home/detail rules.
- Modify `src/monitoring.css` only for shared incident/diagnostic primitives that belong on both desktop and phone.
- Modify `src/styles.css` only where the existing `@media(max-width:700px)` desktop-shrink rules conflict with the new conditional phone shell.

### Docs

- Modify `README.md`, `docs/codex/BUILD_STATUS.md`, and `docs/codex/NEXT_STEPS.md` after verification to record the mobile information architecture and test boundary.

---

### Task 1: Diagnostic Frontend Types and API Clients

**Files:**
- Modify: `src/lib/api.ts`
- Create or modify: `src/lib/api.test.ts` if a frontend API helper test file exists; otherwise create `src/lib/api.test.ts`

**Interfaces:**
- Produces `DiagnosticFact`, `DiagnosticReport`, `DiagnosticLogsResponse` TypeScript types.
- Produces `fetchIncidentDiagnostics(incidentId, signal?)`.
- Produces `fetchIncidentLogs(incidentId, signal?)`.
- Both clients use GET only and same-origin `/api/...` paths.

- [ ] **Step 1: Write failing API-helper tests**

Create `src/lib/api.test.ts` using Vitest:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchIncidentDiagnostics, fetchIncidentLogs } from './api'

afterEach(() => vi.unstubAllGlobals())

describe('incident diagnostics API', () => {
  it('fetches incident diagnostics with GET', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      incidentId: 'i1', status: 'available', facts: [], findings: [], likelyCauses: [], recommendations: [], logsAvailable: true,
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await fetchIncidentDiagnostics('i1')
    expect(result.status).toBe('available')
    expect(fetchMock).toHaveBeenCalledWith('/api/incidents/i1/diagnostics', expect.objectContaining({ method: 'GET' }))
  })

  it('fetches explicit read-only logs with GET', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ incidentId: 'i1', logs: 'safe log', tail: 100, truncated: false }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await fetchIncidentLogs('i1')
    expect(result.logs).toBe('safe log')
    expect(fetchMock).toHaveBeenCalledWith('/api/incidents/i1/logs', expect.objectContaining({ method: 'GET' }))
  })
})
```

- [ ] **Step 2: Run API-helper tests and verify RED**

Run:

```bash
npx vitest run src/lib/api.test.ts
```

Expected: FAIL because the exports do not exist.

- [ ] **Step 3: Add exact diagnostic types**

Add to `src/lib/api.ts`:

```ts
export type DiagnosticFact = {
  id: string
  label: string
  value: string
}

export type DiagnosticReport = {
  id?: string
  incidentId: string
  source?: string
  host?: string
  serviceId?: string
  serviceName?: string
  collectedAt?: string
  status: 'pending' | 'available' | 'degraded' | 'unavailable' | 'not-supported'
  metadata?: Record<string, unknown>
  facts?: DiagnosticFact[]
  findings?: string[]
  likelyCauses?: string[]
  recommendations?: string[]
  logsAvailable?: boolean
  lastLogInspectionAt?: string | null
  error?: string | null
  reason?: string
}

export type DiagnosticLogsResponse = {
  incidentId: string
  serviceName?: string
  host?: string
  tail: number
  logs: string
  truncated: boolean
  observedAt?: string
}
```

- [ ] **Step 4: Add safe path encoding and GET clients**

Implement:

```ts
function incidentPath(id: string, suffix: 'diagnostics' | 'logs') {
  return `/api/incidents/${encodeURIComponent(id)}/${suffix}`
}

export async function fetchIncidentDiagnostics(incidentId: string, signal?: AbortSignal) {
  const response = await fetch(incidentPath(incidentId, 'diagnostics'), { method: 'GET', signal })
  const body = await response.json() as DiagnosticReport | { error?: string }
  if (!response.ok) throw new Error('error' in body && body.error ? body.error : `Friday diagnostics ${response.status}`)
  return body as DiagnosticReport
}

export async function fetchIncidentLogs(incidentId: string, signal?: AbortSignal) {
  const response = await fetch(incidentPath(incidentId, 'logs'), { method: 'GET', signal })
  const body = await response.json() as DiagnosticLogsResponse | { error?: string }
  if (!response.ok) throw new Error('error' in body && body.error ? body.error : `Friday diagnostic logs ${response.status}`)
  return body as DiagnosticLogsResponse
}
```

Do not use localStorage/sessionStorage for diagnostic or log payloads.

- [ ] **Step 5: Run API tests and frontend suite**

Run:

```bash
npx vitest run src/lib/api.test.ts
npm test
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/lib/api.ts src/lib/api.test.ts
git commit -m "feat: add diagnostics frontend API client"
```

---

### Task 2: Shared Incident Diagnostic Detail and Explicit Logs UI

**Files:**
- Create: `src/components/IncidentDetail.tsx`
- Create: `src/components/IncidentDetail.test.tsx`
- Modify: `src/monitoring.css`

**Interfaces:**
- `IncidentDetail` props: `{ incident: FridayIncident; onBack?: () => void }`.
- Component automatically fetches diagnostics for the selected incident.
- Component fetches logs only after the user activates `Inspect Logs`.
- Component renders no remediation/execution controls.

- [ ] **Step 1: Write failing detail tests**

Create a fixture with `serviceName: 'nginx-proxy-manager'`, then mock the API module:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import IncidentDetail from './IncidentDetail'
import * as api from '../lib/api'

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return { ...actual, fetchIncidentDiagnostics: vi.fn(), fetchIncidentLogs: vi.fn() }
})

it('renders facts, deterministic findings, recommendations, and read-only authority', async () => {
  vi.mocked(api.fetchIncidentDiagnostics).mockResolvedValue({
    incidentId: 'i1',
    status: 'available',
    facts: [
      { id: 'exit-code', label: 'Exit code', value: '255' },
      { id: 'oom-killed', label: 'OOM killed', value: 'No' },
    ],
    findings: ['The container exited with an application/startup failure rather than an OOM termination.'],
    likelyCauses: ['Application or startup configuration failure is likely.'],
    recommendations: ['Inspect recent sanitized application logs and recent configuration/deployment changes.'],
    logsAvailable: true,
  })
  render(<IncidentDetail incident={incident} />)
  expect(await screen.findByText('255')).toBeInTheDocument()
  expect(screen.getByText(/application\/startup failure/i)).toBeInTheDocument()
  expect(screen.getByText(/READ ONLY/i)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /restart|repair|execute/i })).not.toBeInTheDocument()
})
```

Add a second test proving no logs request occurs before clicking:

```tsx
expect(api.fetchIncidentLogs).not.toHaveBeenCalled()
await userEvent.click(await screen.findByRole('button', { name: /inspect logs/i }))
expect(api.fetchIncidentLogs).toHaveBeenCalledWith('i1', expect.any(AbortSignal))
expect(await screen.findByText(/safe application log/i)).toBeInTheDocument()
```

Add tests for `pending`, `not-supported`, diagnostics failure, logs failure, and `truncated: true` notice.

- [ ] **Step 2: Run detail tests and verify RED**

Run:

```bash
npx vitest run src/components/IncidentDetail.test.tsx
```

Expected: FAIL because `IncidentDetail` does not exist.

- [ ] **Step 3: Implement diagnostic loading state**

Use component state only:

```tsx
const [diagnostic, setDiagnostic] = useState<DiagnosticReport | null>(null)
const [diagnosticError, setDiagnosticError] = useState<string | null>(null)
const [logs, setLogs] = useState<DiagnosticLogsResponse | null>(null)
const [logsError, setLogsError] = useState<string | null>(null)
const [logsLoading, setLogsLoading] = useState(false)
```

On `incident.id` change, abort the prior diagnostic request, clear log state, and fetch `fetchIncidentDiagnostics(incident.id, controller.signal)`.

- [ ] **Step 4: Implement explicit `Inspect Logs` behavior**

The button text must be `Inspect Logs · Read Only`. On click:

```tsx
async function inspectLogs() {
  setLogsLoading(true)
  setLogsError(null)
  const controller = new AbortController()
  try {
    setLogs(await fetchIncidentLogs(incident.id, controller.signal))
  } catch {
    setLogsError('Diagnostic logs are unavailable. No infrastructure action was attempted.')
  } finally {
    setLogsLoading(false)
  }
}
```

Do not fetch logs from an effect. Do not persist them anywhere.

- [ ] **Step 5: Render categories in the approved order**

Render:
1. incident title/severity/status;
2. host/service and first-seen context;
3. Facts;
4. FRIDAY Findings;
5. Likely Causes if non-empty;
6. Recommendations;
7. `Inspect Logs · Read Only`;
8. `READ ONLY · NO REMEDIATION EXECUTED` authority strip.

Use `<pre className="v3-diagnostic-logs">` for log text and a separate visible truncation notice when `logs.truncated` is true.

- [ ] **Step 6: Add shared diagnostics CSS**

In `src/monitoring.css`, add shared desktop/mobile-safe primitives such as:

```css
.v3-diagnostic-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.v3-diagnostic-fact{min-width:0;border:1px solid var(--line);border-radius:12px;padding:12px}
.v3-diagnostic-fact span,.v3-diagnostic-fact strong{display:block}
.v3-diagnostic-fact span{font-size:8px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}
.v3-diagnostic-fact strong{font-size:14px;margin-top:5px;overflow-wrap:anywhere}
.v3-diagnostic-logs{max-width:100%;max-height:340px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid var(--line);border-radius:12px;padding:12px;background:#070a0e;font:11px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace}
.v3-readonly-action{min-height:44px}
```

- [ ] **Step 7: Run component and full frontend tests**

Run:

```bash
npx vitest run src/components/IncidentDetail.test.tsx
npm test
npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

```bash
git add src/components/IncidentDetail.tsx src/components/IncidentDetail.test.tsx src/monitoring.css
git commit -m "feat: add read-only incident diagnosis view"
```

---

### Task 3: Selectable Incidents on Desktop and Mobile

**Files:**
- Modify: `src/components/ActiveIncidents.tsx`
- Modify: `src/components/ActiveIncidents.test.tsx`
- Modify: `src/components/IncidentsWorkspace.tsx`
- Modify: `src/components/IncidentsWorkspace.test.tsx`

**Interfaces:**
- `ActiveIncidents` gains optional `onSelectIncident?: (incident: FridayIncident) => void`.
- When supplied, each active card renders a `View Diagnosis` button.
- `IncidentsWorkspace` gains `selectedIncident?: FridayIncident | null` and `onSelectIncident` / `onClearSelection` props.
- Existing callers without selection props retain the current read-only incident list behavior.

- [ ] **Step 1: Write failing selection tests**

Add to `ActiveIncidents.test.tsx`:

```tsx
it('offers View Diagnosis only when a selection handler is provided', async () => {
  const onSelectIncident = vi.fn()
  const user = userEvent.setup()
  render(<ActiveIncidents incidents={[incident]} onSelectIncident={onSelectIncident} />)
  await user.click(screen.getByRole('button', { name: /view diagnosis/i }))
  expect(onSelectIncident).toHaveBeenCalledWith(incident)
})
```

Add to `IncidentsWorkspace.test.tsx`:

```tsx
it('shows selected incident detail before history sections', () => {
  render(<IncidentsWorkspace incidents={[incident]} monitoring={monitoring} history={[]} selectedIncident={incident} onSelectIncident={() => {}} onClearSelection={() => {}} />)
  expect(screen.getByText(/Diagnosis/i)).toBeInTheDocument()
})
```

Mock `IncidentDetail` in the workspace test so this task tests composition rather than repeating Task 2 API behavior.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npx vitest run src/components/ActiveIncidents.test.tsx src/components/IncidentsWorkspace.test.tsx
```

Expected: FAIL because selection props/buttons do not exist.

- [ ] **Step 3: Implement optional `View Diagnosis` action**

In `ActiveIncidents`, preserve the current policy strip and add only:

```tsx
{onSelectIncident && (
  <button className="v3-readonly-action" onClick={() => onSelectIncident(incident)}>
    View Diagnosis
  </button>
)}
```

The button must not contain restart/repair language.

- [ ] **Step 4: Implement selected detail in IncidentsWorkspace**

If `selectedIncident` exists, render `IncidentDetail` immediately after the monitoring strip and provide an accessible `Back to incidents` button wired to `onClearSelection`. Keep resolved/history sections available below the detail on desktop; on phone CSS may visually prioritize the detail.

- [ ] **Step 5: Run focused/full tests and build**

Run:

```bash
npx vitest run src/components/ActiveIncidents.test.tsx src/components/IncidentsWorkspace.test.tsx
npm test
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/components/ActiveIncidents.tsx src/components/ActiveIncidents.test.tsx src/components/IncidentsWorkspace.tsx src/components/IncidentsWorkspace.test.tsx
git commit -m "feat: connect incidents to diagnostic detail"
```

---

### Task 4: Reactive Phone Layout Hook

**Files:**
- Create: `src/hooks/usePhoneLayout.ts`
- Create: `src/hooks/usePhoneLayout.test.tsx`

**Interfaces:**
- Produces `usePhoneLayout(): boolean`.
- Media query is exactly `(max-width: 700px)`.
- Handles modern `addEventListener('change', ...)`; no extra responsive dependency.

- [ ] **Step 1: Write failing hook test**

Use a small probe component:

```tsx
function Probe() {
  return <span>{usePhoneLayout() ? 'phone' : 'desktop'}</span>
}
```

Mock `window.matchMedia` with a listener set and prove both initial value and a simulated change event:

```tsx
expect(screen.getByText('phone')).toBeInTheDocument()
matches = false
listeners.forEach((listener) => listener({ matches: false } as MediaQueryListEvent))
expect(screen.getByText('desktop')).toBeInTheDocument()
```

- [ ] **Step 2: Run hook test and verify RED**

Run:

```bash
npx vitest run src/hooks/usePhoneLayout.test.tsx
```

Expected: FAIL because the hook does not exist.

- [ ] **Step 3: Implement the hook**

Use:

```ts
import { useEffect, useState } from 'react'

const PHONE_QUERY = '(max-width: 700px)'

export function usePhoneLayout() {
  const getMatch = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(PHONE_QUERY).matches
    : false
  const [phone, setPhone] = useState(getMatch)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(PHONE_QUERY)
    const onChange = (event: MediaQueryListEvent) => setPhone(event.matches)
    setPhone(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  return phone
}
```

- [ ] **Step 4: Run hook and full frontend tests**

Run:

```bash
npx vitest run src/hooks/usePhoneLayout.test.tsx
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add src/hooks/usePhoneLayout.ts src/hooks/usePhoneLayout.test.tsx
git commit -m "feat: add explicit phone layout boundary"
```

---

### Task 5: Mobile Bottom Navigation and More Sheet

**Files:**
- Create: `src/components/MobileNavigation.tsx`
- Create: `src/components/MobileNavigation.test.tsx`

**Interfaces:**
- Props:

```ts
type MobileNavigationProps = {
  active: string
  activeIncidents: number
  onNavigate: (destination: string) => void
}
```

- Primary destinations: `Overview` displayed as Home, `FRIDAY`, `Infrastructure`, `Incidents`, and `More`.
- More sheet destinations: Applications, Agents, Tasks, Approvals, Memory, Audit, Settings.
- More sheet closes when a destination is selected or Escape is pressed.

- [ ] **Step 1: Write failing navigation tests**

Create tests proving:
- five primary bottom buttons exist;
- Home calls `onNavigate('Overview')`;
- incident badge appears only when count > 0;
- More opens a dialog with all seven secondary destinations;
- clicking Applications calls `onNavigate('Applications')` and closes the dialog;
- Escape closes the dialog.

Example:

```tsx
render(<MobileNavigation active="Overview" activeIncidents={2} onNavigate={onNavigate} />)
expect(screen.getByRole('navigation', { name: /mobile command bar/i })).toBeInTheDocument()
expect(screen.getByRole('button', { name: /incidents.*2/i })).toBeInTheDocument()
await user.click(screen.getByRole('button', { name: /more/i }))
expect(screen.getByRole('dialog', { name: /more friday views/i })).toBeInTheDocument()
await user.click(screen.getByRole('button', { name: 'Applications' }))
expect(onNavigate).toHaveBeenCalledWith('Applications')
```

- [ ] **Step 2: Run navigation tests and verify RED**

Run:

```bash
npx vitest run src/components/MobileNavigation.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement bottom navigation**

Use Lucide `Home`, `Sparkles`, `Server`, `AlertTriangle`, and `Menu` icons. Each button contains both icon and visible text. Active destination gets `aria-current="page"`.

Incident accessible name must include the count when non-zero, for example `Incidents, 2 active`.

- [ ] **Step 4: Implement accessible More sheet**

Render only when open:

```tsx
<div className="v3-mobile-more-backdrop" onClick={() => setMoreOpen(false)}>
  <section role="dialog" aria-modal="true" aria-label="More FRIDAY views" onClick={(event) => event.stopPropagation()}>
```

Use a keydown effect for Escape while open. Every secondary destination is a semantic button.

- [ ] **Step 5: Run navigation/full tests**

Run:

```bash
npx vitest run src/components/MobileNavigation.test.tsx
npm test
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add src/components/MobileNavigation.tsx src/components/MobileNavigation.test.tsx
git commit -m "feat: add friday mobile command bar"
```

---

### Task 6: Incident-First Mobile Home

**Files:**
- Create: `src/components/MobileHome.tsx`
- Create: `src/components/MobileHome.test.tsx`

**Interfaces:**
- Props include `overview`, `connected`, command query/reply state/handlers, and `onNavigate` / `onSelectIncident`.
- The DOM order itself is incident card -> health -> FRIDAY command -> infrastructure -> service health.
- Service preview sorts `offline`, then `degraded`, then `online`, and shows at most five services before `View all`.

- [ ] **Step 1: Write failing information-hierarchy tests**

Render a live overview with one high NPM incident and several services. Use `data-testid` only for section-order assertions where accessible roles are insufficient:

```tsx
const sections = screen.getByTestId('mobile-home').children
expect(sections[0]).toHaveAttribute('data-mobile-section', 'attention')
expect(sections[1]).toHaveAttribute('data-mobile-section', 'health')
expect(sections[2]).toHaveAttribute('data-mobile-section', 'friday')
```

Also assert:

```tsx
expect(screen.getByText('nginx-proxy-manager')).toBeInTheDocument()
expect(screen.getByText(/1 HIGH INCIDENT/i)).toBeInTheDocument()
expect(screen.getByRole('button', { name: /view diagnosis/i })).toBeInTheDocument()
```

Add a no-incidents test requiring `System nominal` and no empty alert shell.

Add a service-order test requiring offline/degraded services to appear before healthy services.

- [ ] **Step 2: Run MobileHome tests and verify RED**

Run:

```bash
npx vitest run src/components/MobileHome.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement highest-priority incident selection**

Use the same severity ordering as ActiveIncidents:

```ts
const severityRank = { high: 0, warning: 1, info: 2 } as const
const active = (overview.incidents ?? [])
  .filter((incident) => incident.status === 'open')
  .slice()
  .sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || b.openedAt.localeCompare(a.openedAt))
const primaryIncident = active[0]
```

The attention card displays count, severity, service name, host, status/type, first seen, and `View Diagnosis`.

- [ ] **Step 4: Implement compact health summary**

Calculate:

```ts
const online = overview.services.filter((service) => service.status === 'online').length
const health = Math.round((online / Math.max(overview.services.length, 1)) * 100)
```

Render four compact metrics: Health, Services, Incidents, Sites.

- [ ] **Step 5: Implement compact FRIDAY command surface**

Reuse the Dashboard's existing controlled `query`, `reply`, and submit handler through props. The phone component must render one compact core indicator, the command input, and current API mode text. Do not render the large desktop rotating 180px core.

- [ ] **Step 6: Implement infrastructure and service previews**

Infrastructure preview uses existing normalized services only. Prefer services/categories containing Proxmox/VM100/VM102 when present; otherwise take the first three unique hosts/services. Do not invent host telemetry.

Service preview:

```ts
const statusRank = { offline: 0, degraded: 1, online: 2 } as const
const prioritized = overview.services.slice().sort((a, b) => statusRank[a.status] - statusRank[b.status]).slice(0, 5)
```

`View all` calls `onNavigate('Applications')`.

- [ ] **Step 7: Run focused/full tests and build**

Run:

```bash
npx vitest run src/components/MobileHome.test.tsx
npm test
npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit Task 6**

```bash
git add src/components/MobileHome.tsx src/components/MobileHome.test.tsx
git commit -m "feat: add incident-first mobile home"
```

---

### Task 7: Dashboard Shell Integration Without Desktop Regression

**Files:**
- Modify: `src/pages/Dashboard.tsx`
- Modify: `tests/dashboard.test.tsx`

**Interfaces:**
- Phone layout does not render `.v3-rail`.
- Desktop layout still renders `.v3-rail` and current topbar/overview.
- Phone always renders `MobileNavigation`.
- Selected incident state is shared by Home and Incidents.
- `View Diagnosis` navigates to Incidents and selects the incident.

- [ ] **Step 1: Add deterministic `matchMedia` test helper**

In `tests/dashboard.test.tsx`, add:

```ts
function installMatchMedia(matches: boolean) {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })))
}
```

Because production code calls `window.matchMedia`, assign the mock to `window.matchMedia` as well if JSDOM requires it.

- [ ] **Step 2: Write failing phone-shell tests**

Add:

```tsx
it('uses mobile shell with bottom navigation and no desktop rail at phone width', async () => {
  installMatchMedia(true)
  render(<Dashboard />)
  expect(screen.getByRole('navigation', { name: /mobile command bar/i })).toBeInTheDocument()
  expect(document.querySelector('.v3-rail')).toBeNull()
})
```

Use the live incident fixture and assert the attention card appears before the mobile FRIDAY command section.

Add an integration test clicking `View Diagnosis` and requiring the Incidents destination/detail to appear.

- [ ] **Step 3: Write desktop regression test**

```tsx
it('preserves desktop V3 rail and command center above phone width', () => {
  installMatchMedia(false)
  render(<Dashboard />)
  expect(document.querySelector('.v3-rail')).not.toBeNull()
  expect(screen.getByRole('heading', { name: /what would you like me to handle/i })).toBeInTheDocument()
  expect(screen.queryByRole('navigation', { name: /mobile command bar/i })).not.toBeInTheDocument()
})
```

- [ ] **Step 4: Run dashboard tests and verify RED**

Run:

```bash
npx vitest run tests/dashboard.test.tsx
```

Expected: FAIL because Dashboard does not conditionally render the phone shell.

- [ ] **Step 5: Integrate phone/desktop shells**

At Dashboard top level:

```tsx
const isPhone = usePhoneLayout()
const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null)
const selectedIncident = incidents.find((incident) => incident.id === selectedIncidentId) ?? null
```

Use one navigation function:

```ts
function navigate(destination: string) {
  setActive(destination)
  if (destination !== 'Incidents') setSelectedIncidentId(null)
}

function viewDiagnosis(incident: FridayIncident) {
  setSelectedIncidentId(incident.id)
  setActive('Incidents')
}
```

When `isPhone`:
- do not render `<aside className="v3-rail">`;
- render compact `.v3-mobile-header`;
- `active === 'Overview'` renders `MobileHome`;
- `active === 'Incidents'` renders `IncidentsWorkspace` with selected incident props;
- other destinations may reuse `DetailView` in the phone single-column shell;
- render `MobileNavigation` outside `<main>` so it remains fixed.

When desktop, preserve the existing rail/topbar/overview structure and extend only incident selection wiring.

- [ ] **Step 6: Preserve history fetch semantics**

Keep the existing `active === 'Incidents'` history effect. Entering Incidents via mobile nav or `View Diagnosis` must trigger the same one-time history fetch and must not hide active incident/diagnostic content if history fails.

- [ ] **Step 7: Run dashboard/full tests and build**

Run:

```bash
npx vitest run tests/dashboard.test.tsx
npm test
npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit Task 7**

```bash
git add src/pages/Dashboard.tsx tests/dashboard.test.tsx
git commit -m "feat: switch friday to purpose-built phone shell"
```

---

### Task 8: Mobile V3 Styling, Safe Areas, and Reduced Motion

**Files:**
- Create: `src/mobile.css`
- Modify: `src/pages/Dashboard.tsx` to import `../mobile.css`
- Modify: `src/styles.css`
- Modify: `src/monitoring.css`
- Create: `src/mobile-css.test.ts` if no stylesheet source test exists

**Interfaces:**
- Phone shell works from 320px minimum body width through 700px breakpoint, with acceptance specifically at 360/390/430px.
- Bottom bar is fixed and safe-area aware.
- No fixed left rail occupies phone width because it is not rendered by React.

- [ ] **Step 1: Write failing stylesheet contract test**

Create `src/mobile-css.test.ts` using Vite's raw import support:

```ts
import { describe, expect, it } from 'vitest'
import mobileCss from './mobile.css?raw'

describe('mobile FRIDAY CSS contract', () => {
  it('uses the approved breakpoint, safe area, and width containment', () => {
    expect(mobileCss).toContain('@media(max-width:700px)')
    expect(mobileCss).toContain('env(safe-area-inset-bottom)')
    expect(mobileCss).toContain('max-width:100%')
    expect(mobileCss).toContain('overflow-x:hidden')
  })

  it('includes reduced-motion treatment', () => {
    expect(mobileCss).toContain('@media (prefers-reduced-motion: reduce)')
  })
})
```

If `?raw` typing requires it, use the existing Vite client types rather than adding a dependency.

- [ ] **Step 2: Run CSS test and verify RED**

Run:

```bash
npx vitest run src/mobile-css.test.ts
```

Expected: FAIL because `src/mobile.css` does not exist.

- [ ] **Step 3: Implement the phone shell stylesheet**

Create `src/mobile.css` with base mobile classes guarded by the single phone media query:

```css
@media(max-width:700px){
  html,body,#root,.v3-shell,.v3-workspace{max-width:100%;overflow-x:hidden}
  .v3-workspace{margin-left:0;min-height:100dvh;padding-bottom:calc(76px + env(safe-area-inset-bottom))}
  .v3-main{padding:18px 14px 28px}
  .v3-mobile-header{position:sticky;top:0;z-index:30;min-height:58px;display:flex;align-items:center;justify-content:space-between;padding:0 14px;border-bottom:1px solid var(--line);background:rgba(7,9,13,.92);backdrop-filter:blur(18px)}
  .v3-mobile-commandbar{position:fixed;z-index:50;left:0;right:0;bottom:0;min-height:68px;padding:6px 8px calc(6px + env(safe-area-inset-bottom));display:grid;grid-template-columns:repeat(5,minmax(0,1fr));border-top:1px solid var(--line);background:rgba(7,9,13,.96);backdrop-filter:blur(20px)}
  .v3-mobile-commandbar button{min-width:0;min-height:44px;border:0;background:transparent;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font-size:9px}
  .v3-mobile-home{display:grid;gap:14px}
  .v3-mobile-health-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
  .v3-mobile-infra,.v3-mobile-services{display:grid;grid-template-columns:1fr;gap:8px}
  .v3-diagnostic-grid{grid-template-columns:1fr}
  .v3-diagnostic-logs{max-width:100%;overflow:auto}
}

@media (prefers-reduced-motion: reduce){
  .v3-ring,.v3-mobile-core-ring{animation:none!important}
}
```

Expand with polished FRIDAY tokens, incident attention treatment, More sheet, compact command card, and status cards. Do not set hard widths wider than the viewport.

- [ ] **Step 4: Remove conflicting old phone-shrink rules**

In the existing `@media(max-width:700px)` block in `src/styles.css`, remove rules whose only purpose was shrinking the desktop rail/workspace onto phones, because React no longer renders that rail on phone. Preserve reusable typography/grid adjustments that still benefit phone DetailView, but avoid duplicate contradictory declarations.

Do not change the desktop rules above the phone media query.

- [ ] **Step 5: Add touch/focus/accessibility states**

Every mobile nav/action button gets `min-height:44px`. Add `:focus-visible` rules with a visible FRIDAY cyan outline. Ensure More sheet is width-contained (`width:min(100% - 20px,420px)`). Ensure log output wraps internally.

- [ ] **Step 6: Run CSS/full tests and build**

Run:

```bash
npx vitest run src/mobile-css.test.ts
npm test
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit Task 8**

```bash
git add src/mobile.css src/mobile-css.test.ts src/pages/Dashboard.tsx src/styles.css src/monitoring.css
git commit -m "style: add friday mobile operations layout"
```

---

### Task 9: Mobile Integration Verification and Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/codex/BUILD_STATUS.md`
- Modify: `docs/codex/NEXT_STEPS.md`
- Modify: PR body after final verification

**Interfaces:**
- Produces a mobile-ready branch that remains desktop-compatible.
- Does not merge or deploy without explicit user approval.

- [ ] **Step 1: Add a no-remediation source assertion to frontend tests/CI if not already covered**

Ensure tests/source checks fail if the diagnostic components gain buttons with execution verbs. A component-level assertion must at minimum cover:

```tsx
expect(screen.queryByRole('button', { name: /restart|repair|execute|stop|start container/i })).not.toBeInTheDocument()
```

The diagnostics backend CI gate remains the authoritative mutation-path check.

- [ ] **Step 2: Run complete frontend and repository verification**

Run:

```bash
npm test
npm run build
```

Expected: zero failures and successful TypeScript/Vite build.

Then run the complete verification commands from the diagnostics plan Task 8, including Compose/image checks or use the exact-head GitHub Actions run when Docker is not available locally.

- [ ] **Step 3: Perform responsive browser validation at 360/390/430 px**

Using the available browser/device tooling against a branch build, inspect at widths `360`, `390`, and `430` px. At each width verify:

```text
- no desktop left rail
- no horizontal page scrollbar
- active incident is above FRIDAY command on Home
- bottom command bar is fully visible
- More opens without clipping
- View Diagnosis opens incident detail
- Inspect Logs content stays inside its panel
- touch controls are not visually cramped
```

Capture screenshots or test artifacts if the environment supports them. If no browser/e2e tool is available, explicitly record that limitation and require this check on VM102/device before merge or rollout; do not claim visual overflow verification from JSDOM alone.

- [ ] **Step 4: Verify desktop regression at a desktop viewport**

At a desktop width such as `1440px`, verify:

```text
- V3 left rail present
- topbar present
- large FRIDAY command-center hero present
- Infrastructure/telemetry/agent/service sections still render
- Incidents workspace still works
- no mobile bottom bar
```

- [ ] **Step 5: Update docs with exact mobile IA**

Record:

```text
Phone <= 700px:
Home | FRIDAY | Infrastructure | Incidents | More

Mobile Home priority:
Incident attention -> Health -> FRIDAY -> Infrastructure -> Services
```

Document that diagnostics/log inspection is read-only and no remediation control exists.

- [ ] **Step 6: Commit Task 9**

```bash
git add README.md docs/codex/BUILD_STATUS.md docs/codex/NEXT_STEPS.md
git commit -m "docs: record friday mobile dashboard"
```

- [ ] **Step 7: Verify the exact final PR head**

Require GitHub `Friday CI` success on the exact current head SHA after all diagnostics and mobile commits are present. Re-run if the head moves.

- [ ] **Step 8: Stop at the merge gate**

Report:
- exact head SHA;
- CI run number/status;
- diagnostics test status;
- mobile test/build status;
- whether true 360/390/430 browser validation was completed;
- any remaining production rollout requirement.

Do not merge until the user explicitly chooses to merge.
