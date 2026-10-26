# Friday cloud connection

Status: implemented locally and disabled by default. Cloudflare staging was
completed on 2026-10-26: a dedicated Access application, exact Service Auth
policy/identity, DNS record, and inactive dedicated tunnel exist. The tunnel
targets `http://friday:3011` but has no running connector yet, so the API is not
live. Production Friday has not been changed. This is an HTTPS API, not an MCP
server or a deployment channel.

## Connection and permissions

```text
Managed cloud workspace -> HTTPS / Cloudflare Access Service Auth
                       -> Cloudflare Tunnel -> VM102 automation listener :3011
                                            -> existing monitoring cache
```

Keep Twingate for private administration. Use a dedicated automation hostname and
Access application for **`friday-api.mytechtactics.com`**, separate from the existing Friday UI application/audience.
The UI remains on port 3010. Do not point the automation hostname at port 3010.

Every automation route requires a verified RS256 Access JWT with the configured
issuer, application audience, valid expiry/nbf, `type=app`, empty `sub`, and an
exact allowlisted `common_name` (the service token Client ID). Raw client-ID,
email or secret headers do not grant origin access. Browser identities are
rejected, and service tokens do not gain UI/operator access.

Only these exact GET requests are allowed; query strings, aliases, trailing
slashes and all other routes are rejected:

| Route | Result |
| --- | --- |
| `/api/health` | Authenticated listener health and live/mock mode |
| `/api/overview` | Last collected normalized inventory/health snapshot |
| `/api/incidents` | Existing incident summary and records |
| `/api/monitoring/history` | Existing bounded monitoring history |

The last three require enabled monitoring. Missing cache/data returns 503.
Responses are limited to 2 MiB and are not cached by HTTP clients. Requests do
not poll adapters, run AI, read repositories, fetch diagnostic logs, sync the
registry or execute commands. Snapshot timestamps must be inspected for
freshness; successful HTTP alone does not prove current upstream health.

Structured request records go to controller stdout with a generated request ID,
fixed route label, method, status, duration and hashed verified client ID.
Headers, arbitrary paths, query values, bodies and raw upstream errors are not
logged. The optional Compose overlay rotates logs (three 10 MiB files). These
are operational request logs, not the future durable action audit system.

## 1. Collect non-secret settings

Verified non-secret settings: hostname `friday-api.mytechtactics.com`, Access
team URL `https://mytechtactics.cloudflareaccess.com`, and a dedicated
application audience/client identity recorded in Cloudflare and the protected
VM102 rollout settings. Never copy the Client Secret or tunnel token into this
document, Git, chat, logs, or command arguments.

No Cloudflare administrative credentials or cloud caller secrets are configured
in this workspace. Its environment tools can inspect readiness but cannot edit
configuration. Desktop Commander provides an authorized VM102 connection:
read-only checks found a clean checkout at `d4b06ec` and passing `make preflight`
and `make health`. No cloudflared binary or active systemd service was found on
VM102; its running container list contains no cloudflared. The VM100 observer
reports Cloudflare connector containers, including a staging connector; their
association with the website tunnel has not been verified. Do not alter that
staging setup or PR #9. These observations do not establish cloud API readiness.

## 2. Configure Cloudflare Access before routing traffic

Completed in Cloudflare: the self-hosted application covers only the API
hostname; its sole policy is Service Auth for the exact `friday-cloud-reader`
token; the organization has strict service-token authentication enabled. The
token expires on 2026-11-24 and must be rotated or replaced before then.

The Access Client Secret belongs in the cloud caller. The tunnel credential
belongs on the homelab connector. Neither belongs in Git, chat or `VITE_*`.
Upstream provider credentials stay in the controller's existing protected `.env`.

## 3. Deploy the listener on VM102

Inventory the running controller and tunnel first. Preserve production `.env`;
do not overwrite unexplained source changes or deploy unrelated local work.
Deliver the reviewed application revision through the normal repository workflow.

Add these settings to the existing VM102 `.env` (substitute actual identifiers):

```dotenv
FRIDAY_AUTOMATION_ENABLED=true
FRIDAY_AUTOMATION_ACCESS_TEAM_DOMAIN=https://YOUR-TEAM.cloudflareaccess.com
FRIDAY_AUTOMATION_ACCESS_AUD=YOUR-AUTOMATION-APPLICATION-AUD
FRIDAY_AUTOMATION_SERVICE_TOKEN_IDS=YOUR-CLIENT-ID.access
FRIDAY_MONITORING_ENABLED=true
```

Keep production `FRIDAY_MODE=live` and `FRIDAY_DOCKER_ENABLED=false`. The new
adapters remain disabled until separately configured and validated. Existing
UI Access settings must remain intact. A separate automation audience prevents
accidental cross-use of UI and automation JWTs.

Recommended for the observed layout: create a **dedicated remotely managed
tunnel** named `friday-cloud-api` and run its connector alongside Friday on VM102.
This avoids changing the website tunnel or opening a LAN origin port. Save the
new tunnel token as a protected file outside the checkout (for example
`/srv/infrastructure/secrets/friday-cloud-tunnel.token`, with a restricted parent
directory). Make the file readable by the connector's container UID only as
needed; file-backed Compose secrets preserve host ownership/permissions. Never
place the token in command arguments or committed environment files. Configure:

```dotenv
FRIDAY_CLOUDFLARED_IMAGE=cloudflare/cloudflared:2026.10.3
FRIDAY_TUNNEL_TOKEN_FILE=/srv/infrastructure/secrets/friday-cloud-tunnel.token
FRIDAY_CLOUDFLARED_UID=1000
FRIDAY_CLOUDFLARED_GID=1000
```

Set the UID/GID to the actual owner of the protected token file (`id -u` and
`id -g` on VM102); the checked-in defaults match the verified VM102 account.
The connector runs as that unprivileged identity so Docker's file-backed secret
remains readable without broadening the host file beyond mode 0600.

The default pins official release `2026.10.3`; its Git tag and Docker registry
manifest were verified during preparation. Future replacements must support
`--token-file` (2025.4.0 or later). Configure the
dedicated tunnel's protected hostname `friday-api.mytechtactics.com` with origin
**`http://friday:3011`**. The connector shares Friday's Docker network; port 3011
does not need a host mapping. Then:

```sh
make verify
make preflight
docker compose -f compose.yaml -f compose.cloud-tunnel.yaml config --quiet
docker compose -f compose.yaml -f compose.cloud-tunnel.yaml up -d --build friday friday-cloud-tunnel
make health
```

Keep the tunnel overlay in subsequent deployment commands. Do not copy the
website tunnel token here: another connector for an existing tunnel receives
that tunnel's routes and may route website traffic to the wrong origins.

Alternatively, for **host-installed cloudflared on VM102**, use the loopback overlay:

```sh
make verify
make preflight
docker compose -f compose.yaml -f compose.automation.yaml config --quiet
docker compose -f compose.yaml -f compose.automation.yaml up -d --build friday
make health
```

Port 3011 is bound only to `127.0.0.1` on VM102. Base Compose does not publish
it. Without `FRIDAY_AUTOMATION_ENABLED=true`, no automation listener starts.
Keep this overlay in subsequent update commands; bare `make update` uses base
Compose and would remove the host-local port mapping.

If cloudflared runs in a container on the Friday network, its origin should be
`http://friday:3011`, not its own localhost; no host port mapping is needed. If
the existing connector runs on another machine, the loopback origin will not
work: choose a local connector or explicitly design the restricted origin path
before activation. Do not publish 3011 to the LAN to work around this.

## 4. Route the protected hostname

For the recommended dedicated container connector, the remotely managed tunnel
origin is `http://friday:3011`; use only `compose.cloud-tunnel.yaml`, without the
loopback overlay. Add the hostname after its Access policy exists.

For a remotely managed tunnel, add the exact hostname with origin
`http://127.0.0.1:3011` when cloudflared runs on the VM102 host. Leave other
hostname routes unchanged. For a locally managed tunnel, use
[`deploy/cloudflare-tunnel.example.yml`](../deploy/cloudflare-tunnel.example.yml)
as an ingress-rule template, preserving existing rules and the final catch-all.
Create the hostname's tunnel DNS route through Cloudflare's tunnel workflow.
Do not use a public Quick Tunnel. No inbound router port forwarding is required.

The origin verifies the signed assertion even if Access routing is accidentally
misconfigured. TLS verification stays enabled; the local HTTP leg is confined
to loopback or the chosen local container network. VM102 must reach its Access
team's HTTPS JWKS endpoint to validate signatures.

## 5. Configure this cloud environment and verify

Through the supported environment settings workflow:

- Add only `friday-api.mytechtactics.com` to the HTTPS destination allowlist.
- Set non-secret runtime variable `FRIDAY_CLOUD_URL=https://friday-api.mytechtactics.com`.
- Bind `FRIDAY_CLOUD_CLIENT_ID` and `FRIDAY_CLOUD_CLIENT_SECRET` as secrets.
  Restrict credential injection to that exact hostname where supported, using
  headers `CF-Access-Client-Id` and `CF-Access-Client-Secret`.
- Apply the reviewed configuration, then confirm current readiness observations
  show the policy enforced and both secrets ready. Keep inherited proxies and
  CA settings; do not bypass a destination-policy denial.

Run from the cloud checkout with Node 22 and curl:

```sh
node scripts/check-cloud-connection.mjs
```

The script requires a live Friday automation response and a timestamped overview;
checks all four reads; expects 403 without credentials, 405 for POST overview,
and 404 for repository access. It uses curl's proxy/CA support, does not follow
redirects, bounds responses/timeouts, and passes credentials on stdin rather
than argv. Output contains only check results, never response bodies or secrets.
If the environment injects credentials into **every** request to this hostname,
perform the unauthenticated 403 check from a separate caller without that binding;
the script deliberately fails rather than misreporting that negative check.

Also verify a different service token and an ordinary browser-session JWT fail,
direct unauthenticated access to the local origin fails, the UI still works,
and snapshot IDs/timestamps match the actual homelab. `make preflight` and
`make health` must run on VM102 before calling the deployment complete.

## Revoke or roll back

Revoke/disable the service token at Cloudflare to stop new edge requests; remove
its Client ID from the origin allowlist and restart Friday for immediate origin
rejection of already-issued JWTs. Keep token lifetime short. Remove only the
automation hostname route and Access application if retiring the connection.
Set `FRIDAY_AUTOMATION_ENABLED=false` and recreate Friday using base Compose to
remove the listener/loopback mapping. If using the dedicated connector, stop and
remove only `friday-cloud-tunnel` with its overlay and revoke its tunnel token;
do not use `down` on the shared Compose project. Preserve UI access, Twingate and
data volumes.

References: [service-token JWT claims](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/),
[service tokens and Service Auth](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/).
