# FRIDAY VM100 Observer

The VM100 observer is FRIDAY's deliberately read-only Docker visibility service for VM 100 nic1 (`10.1.10.10`, VLAN 10). The legacy vmbr0 rollback address is `192.168.1.124`. It never publishes Docker's native TCP API and never exposes start, stop, restart, exec, remove, image, volume, network, archive, or daemon mutation operations.

## Exposed HTTP contract

```text
GET /health
GET /api/v1/containers                         bearer-authenticated
GET /api/v1/containers/:id/inspect             bearer-authenticated
GET /api/v1/containers/:id/logs?tail=100       bearer-authenticated
```

The two diagnostic routes are read-only. `:id` must be a known 12-64 character hexadecimal container ID obtained from the observer's sanitized inventory. The observer re-reads local inventory, resolves the ID to one known full Docker ID, and rejects unknown or ambiguous IDs. It is not a generic Docker proxy.

Allowed local Docker Engine requests are limited to:

```text
GET /containers/json?all=1
GET /containers/{validated-id}/json
GET /containers/{validated-id}/logs?stdout=1&stderr=1&timestamps=1&tail=N
```

Inspect output is allowlisted. Environment variables, command arguments, bind paths, arbitrary labels, health-check output text, and raw Docker inspect JSON never cross the observer boundary. Logs are sanitized, default to 100 requested lines, cap requested tail at 200, and return no more than 64 KiB of sanitized text with a `truncated` marker when needed.

## Preflight on VM100

```bash
ip -4 addr
ss -ltn | grep ':3199 ' && { echo 'Port 3199 is occupied; STOP'; exit 1; } || true
docker info >/dev/null
test -S /var/run/docker.sock
```

Do not continue with a new installation if port `3199` is already occupied by an unknown service.

## Install

```bash
sudo mkdir -p /srv/infrastructure/friday-observer
sudo chown "$USER:$USER" /srv/infrastructure/friday-observer
git clone https://github.com/StMedrano/Friday.git /srv/infrastructure/friday-observer
cd /srv/infrastructure/friday-observer/observer
cp .env.example .env
chmod 600 .env
# Required for the isolated Docker proxy only (never add observer to docker group).
DOCKER_SOCKET_GID=$(stat -c %g /var/run/docker.sock)
sed -i "s/^FRIDAY_DOCKER_SOCKET_GID=.*/FRIDAY_DOCKER_SOCKET_GID=$DOCKER_SOCKET_GID/" .env
unset DOCKER_SOCKET_GID
```

Generate a 256-bit observer token without committing or displaying it:

```bash
TOKEN=$(openssl rand -hex 32)
sed -i "s/^FRIDAY_OBSERVER_TOKEN=.*/FRIDAY_OBSERVER_TOKEN=$TOKEN/" .env
unset TOKEN
grep -qE '^FRIDAY_OBSERVER_TOKEN=.{64}$' .env && echo 'Observer token configured'
```

Keep these deployment values unless the approved architecture changes:

```env
FRIDAY_OBSERVER_BIND_ADDRESS=10.1.10.10
FRIDAY_OBSERVER_PORT=3199
FRIDAY_OBSERVER_HOST_NAME=VM 100
```

Validate and start:

```bash
docker compose config >/dev/null
docker compose up -d --build
docker compose ps
curl -fsS http://10.1.10.10:3199/health | jq
```

The `.env` file is ignored runtime configuration and must remain mode `600`.

## Read-only validation

Set `TOKEN` privately in your shell from the observer `.env`; do not paste the token into chat or commit it.

Inventory remains the source of valid container IDs:

```bash
curl -fsS -H "Authorization: Bearer $TOKEN" \
  http://10.1.10.10:3199/api/v1/containers | jq
```

For a known container such as Nginx Proxy Manager, obtain its sanitized ID from inventory:

```bash
CONTAINER_ID=$(curl -fsS -H "Authorization: Bearer $TOKEN" \
  http://10.1.10.10:3199/api/v1/containers \
  | jq -r '.containers[] | select(.name=="nginx-proxy-manager") | .id')
```

Then use only that returned ID:

```bash
curl -fsS -H "Authorization: Bearer $TOKEN" \
  "http://10.1.10.10:3199/api/v1/containers/$CONTAINER_ID/inspect" | jq

curl -fsS -H "Authorization: Bearer $TOKEN" \
  "http://10.1.10.10:3199/api/v1/containers/$CONTAINER_ID/logs?tail=100" | jq
```

Do not replace `CONTAINER_ID` with a Docker API path, shell expression, container name, file path, or arbitrary query string.

## Update / Phase 1 diagnostics rollout

After the feature is merged and rollout is explicitly approved, upgrade the observer **before** enabling diagnostics on VM102:

```bash
cd /srv/infrastructure/friday-observer
git status --short
git checkout main
git pull --ff-only origin main
cd observer
docker compose config >/dev/null
docker compose up -d --build --force-recreate
docker compose ps
curl -fsS http://10.1.10.10:3199/health | jq
```

Verify inventory, inspect, and logs using the commands above. Finally prove the validation target was not changed:

```bash
docker ps -a --filter name=nginx-proxy-manager \
  --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
```

For the current validation case, Nginx Proxy Manager must remain in its pre-validation `Exited (255)` state.

## Security boundary

Mounting `/var/run/docker.sock` read-only does not make Docker API access inherently safe; the code-level fixed-request allowlist is the observer's primary boundary. Keep the observer bearer token server-side, do not publish Docker TCP `2375/2376`, and do not add mutation routes or generic Docker path forwarding.


## Security hardening candidate (PR #29) — segregated Docker API access

**Not deployed to VM100.** The older deployed observer remains in place until an independent security review, release approval and rollback plan. The new architecture replaces the observer's direct `/var/run/docker.sock` mount with a **dedicated Unix-socket proxy**. It also changes the observer and proxy to UID/GID 10001, read-only root filesystems and dropped Linux capabilities.

The sidecar `friday-docker-readonly` alone mounts the raw host Docker socket. It has no network, published ports, observer authentication token, process-management features or generic API pass-through. Its application is a small, deny-by-default Node server that forwards exactly these requests:

```text
GET /containers/json?all=1
GET /containers/<64-hex-id>/json
GET /containers/<64-hex-id>/logs?stdout=1&stderr=1&timestamps=1&tail=1..200
```

Other methods, paths, API versions, unordered/extra query parameters, container mutations and daemon-management requests receive HTTP **403** without an upstream request. Bounded upstream timeouts and response sizes are enforced. Proxy and observer communicate through a shared volume with a mode-0600 Unix socket: the observer mounts **only that restricted socket volume, read-only**, never the Docker daemon socket. The observer itself retains its authenticated GET-only, sanitized inventory and diagnostic response surface. CI uses a local no-network fixture to prove a permitted GET, a rejected POST and a successful authenticated observer inventory.

Both image builds pin their Node/Alpine release, remove unnecessary globally bundled npm/Yarn tooling, perform available Alpine package updates and are checked by the same HIGH/CRITICAL Trivy image scan used for the Friday controller. Proxy and observer images remain separately scanned and independently gate CI.

**Residual risk:** membership of the host Docker socket group grants root-equivalent daemon access to **the proxy process**; this design reduces the observer attack surface but cannot make a compromised proxy unprivileged. Do not expose the proxy socket to other workloads or users, never publish a Docker TCP port, and do not use this candidate in production before reviewing the code and VM100 networking policies. A stronger future variant could use an independently audited daemon API authorization plugin or a host-side broker with sandbox confinement.

For an approved VM100 maintenance window: verify `stat -c '%a %g' /var/run/docker.sock` on VM100, set `FRIDAY_DOCKER_SOCKET_GID` in the observer's private .env to that numeric group ID, build/pull both images, verify the intended bind address, and exercise authenticated inventory, inspect, logs, 401/403 checks and health before considering cutover. Retain the old immutable image digest and Compose file for rollback. On failure, restore the prior approved deployment and investigate without changing unrelated containers. Do not change user/group IDs or Docker privileges on the VM100 host.
