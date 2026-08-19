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

Copy the `observer/` directory from the FRIDAY repository into this directory, then:

```bash
cp .env.example .env
chmod 600 .env
```

Edit `.env` and set a strong random `FRIDAY_OBSERVER_TOKEN`. Keep the bind address `192.168.1.74` and port `3199` unless the approved architecture changes.

Validate and start:

```bash
docker compose config >/dev/null
docker compose up -d --build
docker compose ps
curl -fsS http://192.168.1.74:3199/health
```

Test authentication from VM 102:

```bash
curl -i http://192.168.1.74:3199/api/v1/containers
curl -fsS -H 'Authorization: Bearer YOUR_TOKEN' http://192.168.1.74:3199/api/v1/containers | jq
```

The first request must return `401`; the authenticated request must return sanitized container inventory.

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
