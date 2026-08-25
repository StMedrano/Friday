# Friday Security Model

Friday is an infrastructure control plane. Its default posture is visibility first, actions later.

## Trust boundaries

- Browser: untrusted client. Never receives infrastructure or AI provider secrets.
- Friday server on VM102: reads narrowly scoped credentials from server-side environment variables.
- Proxmox: accessed through a dedicated read-only API token.
- VM100 Docker: observed through the separate token-authenticated read-only observer; Docker's native TCP API is never exposed.
- AI providers: receive normalized Friday state and a shared advisory/read-only policy, never infrastructure mutation tools.
- CT108 Ollama: GPU-backed local provider on `192.168.1.70:11434`; its firewall should permit access only from VM102.
- Optional Compose Ollama: private development/recovery service with no host/LAN-published port.
- Network devices: remain authoritative for routing, VPN, VLAN, DHCP, DNS, and firewall policy.

## Current action policy

The MVP exposes read-only data, diagnostics, command previews, and advisory assistant output only.

Allowed preview/read families include:

- health check
- active alerts
- backup status when a read adapter provides it
- network overview when a read adapter provides it
- service status
- incident diagnostics and explicit bounded log inspection

Not implemented:

- VM start/stop/reboot
- container start/stop/restart/delete
- arbitrary shell/exec
- firewall or ACL changes
- VLAN changes
- DNS/DHCP changes
- Omada device adoption/reset
- package upgrades
- file deletion

## Assistant security invariants

AI providers receive no infrastructure mutation tools.

API keys remain server-side and never use `VITE_*` variables.

Preferred provider failover is sequential:

```text
Groq -> Gemini -> CT108 Ollama -> deterministic local analysis
```

Friday never fans normalized infrastructure state to multiple providers in parallel. A provider failure is normalized before orchestration or HTTP responses. A normal model refusal is returned as the provider's answer; it is not treated as permission to bypass the refusal through another provider.

Assistant output is advisory and cannot authorize or execute infrastructure changes.

The shared AI policy requires exact service IDs, VM/LXC numbers, host names, and service-name mappings from normalized state. Providers must not infer, renumber, merge, or substitute those identifiers.

The deterministic final fallback uses existing read-only command-preview/local-analysis behavior. It does not create an execution path.

## Secrets

- Keep `.env` out of Git and restrict its file permissions.
- Use a dedicated read-only Proxmox API token.
- Keep Groq, Gemini, OpenAI, Anthropic, observer, and other provider/integration credentials in server-side environment variables only.
- Rotate any token exposed in logs, screenshots, commits, or chat.
- Do not put tokens in `VITE_*` variables because Vite embeds those values into browser assets.
- Prefer Docker secrets or a dedicated secret manager when Friday moves beyond the MVP.

## Docker boundaries

The normal production controller runs with `FRIDAY_DOCKER_ENABLED=false` and does not need a VM102 Docker socket mount for Proxmox or VM100 visibility.

If local VM102 Docker observation is explicitly enabled, treat the Docker socket as privileged even when the bind mount is read-only. Do not expose Friday directly to the public Internet and do not use local-socket access as a shortcut around the VM100 observer design.

The VM100 observer may use the local Unix socket but is constrained to fixed authenticated GET routes. It must not gain restart, stop, kill, exec, remove, image creation, volume mutation, network mutation, archive write, or arbitrary Docker-path proxy behavior.

## Diagnostics boundary

Incident Diagnostics can automatically capture one metadata-only report for supported incidents when enabled. Raw container logs are never fetched automatically. Explicit log inspection is bounded, sanitized, ephemeral, and never persisted in monitoring state/history.

Diagnostics expose no remediation endpoint.

## Future write-action rule

A future action engine must require all of the following before any infrastructure mutation:

1. exact allowlisted action identifier
2. target validation
3. authenticated user or documented trusted identity boundary
4. role authorization
5. dry-run/preview result
6. explicit approval where policy requires it
7. durable append-only action audit event before and after execution
8. action request lifecycle state
9. timeout and bounded retry policy
10. global automation kill switch

No natural-language model output may directly become a shell command or infrastructure API request.
