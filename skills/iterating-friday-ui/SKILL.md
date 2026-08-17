---
name: iterating-friday-ui
description: Use when redesigning, extending, or fixing Friday dashboard screens and operator interactions.
---

# Iterating the Friday UI

## Product intent
Friday is an infrastructure operations console, not a marketing landing page. Optimize for scanability, status clarity, and safe operator decisions.

## Workflow
1. Read `src/lib/infrastructure.ts`, `src/lib/api.ts`, `src/styles.css`, and the affected components.
2. Keep provider-specific data out of components; change normalized types/adapters instead.
3. Write or update Testing Library tests before behavior changes.
4. Reuse existing layout, panel, badge, and status patterns before adding new primitives.
5. Every state needs text/icon semantics; never communicate health through color alone.
6. Keep destructive actions visually distinct and disabled until backend policy supports them.
7. Preserve responsive behavior and keyboard-accessible controls.
8. Run `npm test` and `npm run build` before completing the change.

## Visual rules
- Dark graphite base, restrained blue/cyan accents.
- Dense operational layouts are preferred over oversized cards.
- Avoid decorative gradients, excessive glass blur, and animation that competes with status information.
- Put the most actionable failures above informational activity.

## Friday assistant UI
AI output is advisory. Label proposed/previewed work clearly and never display text implying an action executed unless the backend returns an audited execution result.
