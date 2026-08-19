# FRIDAY VM100 Observer

The VM100 observer is a deliberately read-only Docker inventory service for VM 100 (`192.168.1.74`). It exposes only `GET /health` and token-authenticated `GET /api/v1/containers`; it never exposes Docker's native TCP API.

## Preflight on VM 100

Run these before deployment:

```bash
ip -4 addr
ss -ltn | grep ':3199 ' && { echo 'Port 3199 is occupied; STOP'; exit 1; } || true
docker info >/dev/null
test -S /var/run/docker.sock
```

Do not continue if port `3199` is already listening.

## Install

```bash
sudo mkdir -p /srv/infrastructure/friday-observer
sudo chown -R "$USER:$USER" /srv/infrastructure/friday-observer
cd /srv/infrastructure/friday-observer
```

Copy the `observer/` directory from the authoritative FRIDAY repository into this directory, then:

```bash
cp .env.example .env
chmod 600 .env
```

Generate a 256-bit observer token without putting the token itself in shell history:

```bash
TOKEN=$(openssl rand -hex 32)
sed -i "s/^FRIDAY_OBSERVER_TOKEN=.*/FRIDAY_OBSERVER_TOKEN=$TOKEN/" .env
unset TOKEN
```

Confirm the secret is present without printing it:

```bash
grep -qE '^FRIDAY_OBSERVER_TOKEN=.{64}$' .env && echo 'Observer token configured'
```

Keep `FRIDAY_OBSERVER_BIND_ADDRESS=192.168.1.74`, `FRIDAY_OBSERVER_PORT=3199`, and `FRIDAY_OBSERVER_HOST_NAME=VM 100` unless the approved architecture changes.

Validate and start:

```bash
docker compose config >/dev/null
docker compose up -d --build
docker compose ps
curl -fsS http://192.168.1.74:3199/health
```

Test authentication from VM 102. The unauthenticated request must return `401`; the authenticated request must return sanitized inventory. Read the token privately from the VM100 `.env` when transferring it to VM102—do not paste it into chat or commit it to Git.

## Update

Replace the observer source with the version from the authoritative FRIDAY `main` branch, preserve `.env`, then run:

```bash
docker compose config >/dev/null
docker compose up -d --build
docker compose ps
curl -fsS http://192.168.1.74:3199/health
```

## Security boundary

The observer container mounts `/var/run/docker.sock` read-only, but Docker socket access is still highly privileged. The observer source therefore contains only the fixed Docker request `GET /containers/json?all=1`, and the network API exposes no mutation routes. Do not publish the native Docker socket over TCP and do not add restart, exec, remove, image, volume, or network mutation endpoints.
