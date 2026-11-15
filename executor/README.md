# Friday homelab executor

A small service that lets Friday **start, stop or restart** specific Docker
containers on one host. Nothing else: no exec, create, delete, images, volumes
or networks. Friday never holds the Docker socket; this executor does, and it
only acts on the containers in its own allowlist.

Two independent locks guard every change:

1. Friday: the container must be in Friday's action file
   (`/data/homelab-actions.json`, `"kind": "docker"`), an operator previews the
   change and approves it by typing the name, and in execute mode the
   automation gate must be armed. See `docs/integrations.md`, Homelab changes.
2. This executor: the container and operation must be in `allowlist.json`
   on the Docker host, and the request must carry the bearer token.

## Set up (on the Docker host, for example VM100)

```sh
cd /srv/infrastructure/apps/friday/executor   # a checkout of this repository
cat > allowlist.json <<'JSON'
{"schemaVersion": 1, "containers": [
  {"name": "plex", "operations": ["restart"]}
]}
JSON
chmod 644 allowlist.json
cat > .env <<ENV
FRIDAY_EXECUTOR_TOKEN=$(openssl rand -hex 32)
FRIDAY_EXECUTOR_BIND_ADDRESS=10.1.10.10
FRIDAY_DOCKER_SOCKET_GID=$(stat -c %g /var/run/docker.sock)
ENV
chmod 600 .env
docker compose up -d --build
curl -s http://10.1.10.10:3198/health
```

Then on VM102 set `FRIDAY_HOMELAB_EXECUTOR_URL=http://10.1.10.10:3198` and
`FRIDAY_HOMELAB_EXECUTOR_TOKEN` to the same token (copy it from the executor's
`.env` without printing it to a shared terminal log).

## API

- `GET /health`: no token.
- `GET /v1/containers/<name>`: `{"ok":true,"name","state"}` with Docker's state
  (`running`, `exited`, ...). 403 when not allowlisted.
- `POST /v1/containers/<name>/<start|stop|restart>`: `{"ok":true}` when Docker
  accepted it. Stop and restart give the container 30 seconds before a kill.
  403 `not-allowlisted`, 404 `container-missing`, 502 `docker-refused`, 503
  `docker-unavailable`. Changes on one host run one at a time.

Every change is logged to stdout as one JSON line (`requested`, `succeeded`,
`failed`, `refused`) with the container and operation; the token is never logged.
Edit `allowlist.json` and `docker compose restart friday-executor` to change it.
Remove a container from the list to take Friday's ability away immediately.
