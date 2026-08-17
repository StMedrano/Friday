# Agent Instructions

Read `CODEX.md` before making infrastructure integration changes.

## Mandatory safety
- Never commit secrets.
- Never put privileged credentials in `VITE_*` variables.
- Never mount the Docker socket into the frontend.
- Never modify VM 100 networking, Omada routing, VLANs, DNS, DHCP, firewall rules, or Proxmox settings as a side effect of frontend work.
- Keep Friday read-only until authentication, policy, audit, and approval paths exist.

## Engineering
- Run `npm test` and `npm run build` before committing application changes.
- Keep mock/live data behind typed adapters.
- Preserve the existing design tokens and component boundaries unless a deliberate redesign is requested.
