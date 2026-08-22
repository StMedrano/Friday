# FRIDAY HTTPS + Private Routing Runbook

Canonical URL: `https://friday.mytechtactics.com`
NPM / AdGuard: VM100 `192.168.1.124`
FRIDAY controller: VM102 `192.168.1.64`
FRIDAY backend: TCP/3010
NPM admin: private TCP/81

## Security boundary

- Cloudflare is DNS-01 only; no public FRIDAY proxy route.
- AdGuard rewrite: `friday.mytechtactics.com -> 192.168.1.124`.
- NPM proxy: `https://friday.mytechtactics.com -> http://192.168.1.64:3010`.
- Only VM100 may remotely reach original destination `192.168.1.64:3010`.
- NPM TCP/81 is LAN + admin-authorized Twingate only.
- No router forwarding for NPM TCP/81 or VM102 TCP/3010.
- No public FRIDAY application forwarding is part of this design.
- Never store the Cloudflare API token in git, shell history, screenshots, frontend configuration, or documentation.

## Rollback

- NPM: restore the timestamped Compose backup and recreate only NPM with `--pull never`.
- VM102 backend guard: run `/usr/local/sbin/friday-backend-guard remove` only for intentional recovery.
- LAN DNS: restore DHCP DNS to `192.168.1.254`.
- Twingate: disable only the FRIDAY/NPM Resources created by this rollout.

Rollback is component-local. Do not restart or reconfigure unrelated VM100 services to recover FRIDAY routing.
