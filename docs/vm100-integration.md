# VM 100 Integration

## Initial deployment location
Recommended path:

```text
/srv/infrastructure/apps/friday
```

## Clone and start

```bash
sudo mkdir -p /srv/infrastructure/apps
sudo chown -R "$USER":"$USER" /srv/infrastructure/apps
cd /srv/infrastructure/apps
git clone https://github.com/StMedrano/Friday.git friday
cd friday
cp .env.example .env
docker compose config
docker compose up -d --build
```

## Default port
Friday publishes `3010/tcp` on VM 100.

Before changing that port:

```bash
sudo ss -tulpn | grep ':3010 ' || true
docker ps --format 'table {{.Names}}\t{{.Ports}}'
```

## Reverse proxy
Once Friday is healthy locally, add it to Nginx Proxy Manager using the chosen internal hostname. Proxy to VM 100 port 3010. Do not publish the development Vite server.

## Health

```bash
curl -fsS http://127.0.0.1:3010/healthz
docker inspect --format '{{json .State.Health}}' friday-ui
```

## Updating

```bash
cd /srv/infrastructure/apps/friday
git pull --ff-only
docker compose up -d --build
./scripts/verify.sh
```

## Rollback
Use Git tags or a known-good commit, rebuild, and verify. Avoid deleting Docker state as a troubleshooting shortcut.
