# Friday Cloudflare Tunnel + Access staging on VM100

**Status (2026-10-13): staging deployed on VM100, Cloudflare Tunnel token rotated, browser login accepted.** Production Friday remains unchanged; staging deployment does not authorize production cutover or PR merge. Earlier setup instructions below document how the approved deployment was established, not work that still needs to be performed. The live staging installation is `/home/stalin/staging/friday`, with Compose in `deploy/staging/compose.yaml`. PR #29 remains draft until independent review and separate release approval.

## Observed, read-only VM100 baseline

- VM100 `infrastructure`: 192.168.1.124 (legacy) and 10.1.10.10 (VLAN 10). Docker Engine 29.6.1 / Compose v5.3.1.
- Existing live `nginx-proxy-manager` listens on 80/443; live `friday-observer` listens on 3199. Do **not** change either.
- Historical baseline: an unmanaged `cloudflare/cloudflared:latest` container named `clever_nobel` existed before staging. Both obsolete, stopped token-bearing Docker containers were verified and removed on 2026-10-12 with approval. The active staging connector is the separate `friday-access-stage-cloudflared-staging-1` service; do not repurpose production/other tunnels.
- Cloudflare public DNS queries returned NXDOMAIN for `friday-staging.mytechtactics.com` and `friday.mytechtactics.com` at the time of inspection. Internal Friday DNS resolves privately and is not an Access verification.
- VM102 production Friday runs a different, healthy image with root-owned `friday_data`, unchanged. Stage must never mount production state or use VM102 runtime secrets.

## Deployed staging route (deliberately bypasses Nginx Proxy Manager)

```text
Remote browser
  → Cloudflare Access app: friday-staging.mytechtactics.com
    (allowlisted identity and separate staging AUD)
  → Cloudflare Tunnel (dedicated remotely-managed staging tunnel)
  → VM100 Docker service cloudflared-staging, profile=tunnel
    on isolated Compose network friday-access-stage_friday_staging
  → http://friday-staging:3010
  → Friday candidate image (live-mode authentication enforced)
```

No local reverse-proxy modification is needed for this first staging test. **This staging setup does not verify Nginx Proxy Manager's JWT forwarding; that remains a separate production acceptance gate.** Cloudflare Tunnel makes outbound connections; the router needs no inbound forwarding. Neither staging container publishes any host TCP port. The only shared resource is a dedicated, privately scoped Docker bridge, not the Docker socket, VM100 observer network, production Friday volume, or existing tunnels.

### Historical Cloudflare administrator setup (completed for staging)

1. At [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) → **Access controls → Applications**, create a **new self-hosted public application** named `Friday Staging` for exactly `friday-staging.mytechtactics.com`, blank path (protect *all* paths, including assets, APIs, and health). Do **not** use a wildcard or change the existing production Friday app.
2. Attach an **Allow** policy with **Include → Emails** for the intended explicit staging testers; ensure the Include section has no `Authentication Method → PWD`, Everyone, or Bypass rule that could widen access (multiple Include rules are OR). Set chosen identity provider and MFA/security requirements as supported. Validate saved policy is attached to **Friday Staging**.
3. Save the staging application and obtain its own **Application Audience (AUD) Tag**. It **must differ** from production Friday AUD `f566316cef0d66e796fc90eeb68fbddb2f08926d9a4f14599fed509046c1c564`. Your team domain is `https://mytechtactics.cloudflareaccess.com`. These are identifiers, not tunnel-token secrets.
4. Under **Networking → Tunnels**, create or select a newly dedicated **remotely managed** tunnel named `friday-staging-vm100`; do not reuse the existing VM100 connector. Record the tunnel ID privately, and collect its token **only to a private file on VM100 after deployment approval**. A token can run the tunnel; treat it as a secret. Do not put it in terminal history, chat, Git, a shell CLI argument, or `.env`.
5. Only after Access policy is confirmed, add a published **HTTP** application route:
   - Public hostname: `friday-staging.mytechtactics.com`
   - Service URL: **`http://friday-staging:3010`** (Docker's internal DNS on the dedicated shared network; **not** localhost, VM100 host port, NPM, or VM102 production)
   - On an account with full Cloudflare DNS, the route normally creates its proxied DNS CNAME. Verify the public DNS record is associated with the **staging** tunnel and that it does not overwrite production records.
   - If Cloudflare offers **Protect with Access** for the tunnel route, select the **Friday Staging** application and its staging audience/policy. Keep Friday's own origin-side JWT verification enabled regardless.
   - A fallthrough/unmatched route should return 404. Do not publish other hostname routes from this tunnel.

> Cloudflare documentation recommends creating the Access application **before** publishing a tunnel route; an unprotected published hostname may otherwise be accessible publicly. The candidate Friday server also rejects requests missing a valid signed Access JWT, providing a second control.

### Repository files and zero-deployment preflight

- `deploy/staging/compose.yaml` — isolated Docker Compose stack, separate Friday image and Cloudflared sidecar.
- `deploy/staging/.env.example` — staging-only AUD plus **host file path** for remote tunnel token; no secrets.
- `scripts/verify-friday-staging.sh` — builds a synthetic Compose config, inspects it, and starts **nothing**.
- `scripts/verify-friday-staging.mjs` — fails on host ports, host privilege, Docker socket/volumes, production AUD, missing JWT enforcement, exposed tunnel token, or an active-by-default tunnel sidecar.
- `scripts/verify-friday-staging.test.mjs` — unit tests for the security constraints; CI runs all tests and the Compose dry run.

Run the no-deploy check in a *separate repository checkout*, not the live production checkout:

```sh
sh scripts/verify-friday-staging.sh
```

This uses a **synthetic** AUD and a disposable fake token file strictly for `docker compose config`; it does not invoke Cloudflare, run containers or change DNS.

### Historical initial VM100 staging deployment procedure

The isolated staging deployment was already approved and completed at `/home/stalin/staging/friday`. The alternative `/srv/staging/friday` paths below describe the original preparation procedure, not another installation to create. Do **not** rerun these steps for ordinary continuation; a new staging activation or teardown needs its own scoped authorization.

1. On VM100 create a separate checkout under `/srv/staging/friday`, pin it to a specific, green commit of the **existing PR branch**. Never use `/srv/infrastructure/apps/friday` or any VM102 checkout. Verify commit SHA, image hashes, and free disk.
2. Under `/srv/staging/friday/deploy/staging`, copy `.env.example` to a **private** `.env` and set the separately obtained `FRIDAY_STAGE_CF_ACCESS_AUD`. Do not use the production Friday AUD or production credentials.
3. Write the tunnel token to a **private file** such as `/srv/friday-stage-secrets/staging-tunnel.token`, not to the command line or Docker environment. The file must be readable by the cloudflared container UID 65532 through the Compose secret mount; set narrow ownership/permissions and check them without printing the token. File owner UID 65532 + mode 0400 may be necessary with a file-based Compose secret (mode settings may not override bind-mount permissions). Parent path can remain root-only. Never grant world-read access.
4. Run `docker compose --env-file .env -f compose.yaml config`, then run the fail-closed checker with **real AUD** if approved. Do not print the full Compose configuration to public logs because it may contain identifiers and deployment information.
5. **Start only the staging app** (no tunnel): `docker compose --env-file .env -f compose.yaml up -d --build friday-staging`. This creates a staging project network and a disposable-in-memory `/data` (no host published ports, production volumes or service integration). Verify container health from VM100 by Docker inspect and a separate ephemeral Docker network test client (no host port).
6. Confirm the Cloudflare **staging Allow policy** is applied and the tunnel remote route maps only to `http://friday-staging:3010`. Then, and **only then**, start the connector: `docker compose --env-file .env -f compose.yaml --profile tunnel up -d cloudflared-staging`.
7. Verify public DNS for the staging hostname and test **from outside the LAN in an InPrivate browser**:
   - anonymous GETs to `/`, scripts and APIs redirect to Access login or deny;
   - listed user logs in and signed identity can load both HTML and assets plus `/api/overview`;
   - unlisted identity denied, expired/forged JWT rejected, origin-side JWT signature/AUD checked;
   - no operator privileges (staging operator allowlist is **empty** by design), real integrations, Docker access, model invocation or production user data;
   - check tunnel logs **without showing tokens** and verify no route to VM102 or NPM;
   - check no published host ports or unexpected Docker volume mounts.
8. If any check fails, remove the **staging** tunnel published route and staging DNS record using the Cloudflare dashboard, then stop only this dedicated Compose project (e.g. `docker compose --env-file .env -f compose.yaml --profile tunnel down`). Never remove or stop other tunnel instances, NPM, the observer or production Friday. The ephemeral staging `/data` contents are discarded on container restart.

### Rollout gate

The initial staging activation and later token rotation were specifically approved and completed. That approval does not authorize a new activation, teardown, credential rotation or production deployment. Continue with the existing isolated staging stack and the pending acceptance checks. The production Friday release still requires separate Cloudflare/NPM acceptance, independent security review, a verified root-owned volume backup and copy-only migration, and separate cutover approval. Phase 2C remains disabled.

Official Cloudflare docs: [Self-hosted public application](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/), [tunnel published application route](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/), [run token-file](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/).

## Staging reboot recovery (2026-10-13)

The first approved VM100 staging deployment used `restart: "no"` for `friday-staging`. Following a VM100 host reboot on 2026-10-13, Docker restarted the `cloudflared-staging` connector (which already used `unless-stopped`), but left `friday-staging` exited. The controller had to be started manually. **Candidate source** at `511b9f70e237900fce24cbd0f0099c42c7bb3c97` declares `restart: unless-stopped` for both services; CI #437 passed. After VM100 reconnected on 2026-10-13, the existing app's Compose line and runtime policy were updated and verified; **both live services now report `unless-stopped`** with unchanged container IDs and start times. No service was restarted or recreated, and no Docker/VM reboot was performed. Both live services are eligible to restart when the Docker daemon starts after a host reboot, **unless an operator intentionally stopped them**. This is not a substitute for VM100 host uptime, Docker daemon availability, an independent watchdog, or recovery from a merely unhealthy-but-running process.

**Production and Cloudflare caveats:** Do not restart the Docker daemon or reboot VM100 just to test this in production. Use the isolated CI container to confirm its actual Docker restart policy. The currently approved staged instance lives under `/home/stalin/staging/friday`; never apply this Compose file to VM102 or change NPM, the observer, or the Cloudflare Access application.

Safe read-only verification on VM100:

```sh
docker inspect friday-access-stage-friday-staging-1 \
  --format 'app={{.State.Health.Status}} restart={{.HostConfig.RestartPolicy.Name}} published_ports={{len .HostConfig.PortBindings}} mounts={{len .Mounts}}'
docker inspect friday-access-stage-cloudflared-staging-1 \
  --format 'connector={{.State.Status}} restart={{.HostConfig.RestartPolicy.Name}}'
curl --silent --show-error --max-redirs 0 --output /dev/null \
  --write-out 'anonymous_http=%{http_code}\n' \
  https://friday-staging.mytechtactics.com/
```

Expected values: healthy app, `unless-stopped` on both services, zero host port bindings/mounts, running connector, and HTTPS 302 to the exact Cloudflare Access team login for an anonymous request. A successful *authenticated* sign-in must still be tested by a user; do not collect their JWT or cookie. Record failures in PR #29. Staging restart-policy changes do not confer production release authorization.
