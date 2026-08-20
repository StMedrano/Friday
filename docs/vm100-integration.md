# VM 100 Integration

VM 100 (`192.168.1.124`) is managed infrastructure. FRIDAY itself runs on VM 102. VM 100 hosts only the standalone read-only Docker observer for FRIDAY.

## Observer deployment location

```text
/srv/infrastructure/friday-observer
```

## Observer port

```text
192.168.1.124:3199
```

Before deployment:

```bash
ss -ltn | grep ':3199 ' && { echo 'Port 3199 is occupied; STOP'; exit 1; } || true
docker info >/dev/null
test -S /var/run/docker.sock
```

## Deploy

Use the files under `observer/`. Copy `.env.example` to `.env`, set a strong `FRIDAY_OBSERVER_TOKEN`, run `chmod 600 .env`, validate Compose, and start the observer.

```bash
docker compose config >/dev/null
docker compose up -d --build
docker compose ps
curl -fsS http://192.168.1.124:3199/health
```

From VM 102, a request without a bearer token must return `401`; a request with the configured token may read sanitized container inventory from `/api/v1/containers`.

The currently deployed observer has been verified end-to-end from VM102 and reports the real VM100 container inventory. Keep `FRIDAY_DOCKER_ENABLED=false` on VM102 unless local VM102 Docker observation is explicitly required.

## Security

Do not expose Docker's native TCP API. Do not add SSH-based Docker execution. The observer has no mutation routes. Existing VM100 application Compose projects remain independent from the observer project.

See `observer/README.md` for the full install/update procedure.
