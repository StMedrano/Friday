# Friday Security Model

Friday is an infrastructure control plane. Its default posture is visibility first, actions later.

## Trust boundaries

- Browser: untrusted client. Never receives infrastructure secrets.
- Friday server: reads narrowly scoped credentials from environment variables.
- Proxmox, Docker, Omada and other services: accessed only through dedicated adapters.
- AI providers: receive normalized Friday state and a shared advisory/read-only policy, never infrastructure mutation tools.
- Private Ollama: optional Docker service reachable only through `friday_frontend`; no host/LAN port is published.
- Network devices: remain authoritative for routing, VPN, VLAN, DHCP and firewall policy.

## Current action policy

The MVP exposes read-only data, diagnostics, command previews, and advisory assistant output only.

Allowed preview families:

- health check
- active alerts
- backup status
- network overview
- service status

Not implemented:

- VM start/stop/reboot
- container start/stop/restart/delete
- firewall or ACL changes
- VLAN changes
- DNS/DHCP changes
- Omada device adoption/reset
- package upgrades
- file deletion

## Assistant security invariants

AI providers receive no infrastructure mutation tools.

API keys remain server-side.

Ollama has no host-published port.

Provider failover is sequential, not parallel fanout.

Assistant output is advisory and cannot authorize or execute infrastructure changes.

Provider failures are normalized before they reach orchestration or HTTP responses. Raw upstream exceptions, credentials, and private provider details are not returned to the browser. A normal model refusal is treated as the provider's answer; it is not interpreted as permission to try to bypass the refusal through another provider.

The deterministic final fallback uses the existing read-only `previewCommand` command families. It does not create an execution path.

## Secrets

- Keep `.env` out of Git.
- Use a dedicated read-only Proxmox API token.
- Keep OpenAI, Anthropic, and Gemini credentials in server-side environment variables only.
- Rotate any token exposed in logs, screenshots, commits, or chat.
- Do not put tokens in `VITE_*` variables because Vite embeds those values into browser assets.
- Prefer Docker secrets or a dedicated secret manager when Friday moves beyond the MVP.

## Docker socket

Even a read-only bind mount of `/var/run/docker.sock` gives the Friday process visibility into Docker metadata. Treat access to the socket as privileged and do not expose Friday directly to the public Internet.

The optional Ollama service does not require the Docker socket. It is isolated to the Friday Docker network and persists model data only in the dedicated `friday_ollama` volume.

## Future write-action rule

A future action engine must require all of the following before any infrastructure mutation:

1. exact allowlisted action identifier
2. target validation
3. authenticated user
4. role authorization
5. dry-run/preview result
6. explicit approval where policy requires it
7. audit event before and after execution
8. timeout and bounded retry policy

No natural-language model output may directly become a shell command or infrastructure API request.