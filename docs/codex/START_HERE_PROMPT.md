# Codex Start Prompt

Paste the block below into Codex after pulling Friday on VM102.

```text
You are continuing the Friday control-plane project on VM 102 (`friday-controller`, `192.168.1.64`). VM102 is the authoritative Friday controller. VM100 (`192.168.1.124`) is managed infrastructure and hosts only the separate read-only Docker observer.

Before changing anything:
1. Read AGENTS.md completely.
2. Read CODEX.md.
3. Read docs/codex/BUILD_STATUS.md and docs/codex/NEXT_STEPS.md.
4. Read the relevant repo-local skill under skills/ for the task you are doing.
5. Run make preflight on VM102 for controller deployment work.
6. Run make verify before implementing new application behavior. If verification fails, diagnose the existing failure first.

Do not re-scaffold or replace the application. Most of the core MVP is already implemented.

Current major completed capabilities include monitoring/incidents, merged Incident Diagnostics + Mobile Dashboard, and the sequential advisory AI chain Groq -> Gemini -> CT108 GPU Ollama -> deterministic local analysis.

Preserve these boundaries:
- browser never receives infrastructure or AI provider secrets;
- normal VM102 production keeps FRIDAY_DOCKER_ENABLED=false and no controller Docker socket mount;
- VM100 Docker visibility/diagnostics stay behind the separate fixed token-authenticated read-only observer;
- AI providers receive normalized state only and no Docker, Proxmox, shell, network, deployment, or remediation tools;
- adapters are read-only unless a separately reviewed action layer exists;
- do not change VM100 networking, Omada routing, VLANs, DNS, DHCP, firewall, VPN, Twingate, or Proxmox configuration as an incidental app change;
- no arbitrary shell execution;
- no destructive actions before authentication/RBAC, durable action audit logging, approval workflow, and a global automation kill switch exist.

Use docs/codex/NEXT_STEPS.md as the ordered build queue. Continue from the highest-priority unfinished item that can be verified in the current environment. The next product milestone is the Friday Assistant experience, not additional provider-chain work.

For behavior changes, write a failing test first. Run make verify before completing each meaningful milestone. Update docs/codex/BUILD_STATUS.md when a major capability becomes complete.
```
