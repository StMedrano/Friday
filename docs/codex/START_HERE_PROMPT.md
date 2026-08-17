# Codex Start Prompt

Paste the block below into Codex after pulling Friday on VM100.

```text
You are continuing the Friday control-plane project on VM 100.

Before changing anything:
1. Read AGENTS.md completely.
2. Read CODEX.md.
3. Read docs/codex/BUILD_STATUS.md and docs/codex/NEXT_STEPS.md.
4. Read the relevant repo-local skill under skills/ for the task you are doing.
5. Run make preflight.
6. Run make verify before implementing new behavior. If verification fails, diagnose the existing failure first.

Do not re-scaffold or replace the application. Most of the core MVP is already implemented.

Preserve these boundaries:
- browser never receives infrastructure or OpenAI secrets;
- base compose.yaml stays safe/mock and Docker-socket-free;
- live Docker socket access is read-only and only through compose.live.yaml;
- adapters are read-only unless a separately reviewed action layer exists;
- do not change VM100 networking, Omada routing, VLANs, DNS, DHCP, firewall, VPN, or Proxmox configuration as an incidental app change;
- no arbitrary shell execution;
- no destructive actions before authentication/RBAC, durable audit logging, and approval workflow exist.

Use docs/codex/NEXT_STEPS.md as the ordered build queue. Continue from the highest-priority unfinished item that can be verified in the current environment.

For behavior changes, write a failing test first. Run make verify before completing each meaningful milestone. Update docs/codex/BUILD_STATUS.md when a major capability becomes complete.
```
