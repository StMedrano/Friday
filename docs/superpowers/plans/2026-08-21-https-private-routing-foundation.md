# HTTPS + Private Routing Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move FRIDAY to a single private HTTPS URL at `https://friday.mytechtactics.com`, with Nginx Proxy Manager as the private TLS gateway, AdGuard as private DNS, Twingate as the remote path, and VM102 TCP/3010 reachable only from VM100.

**Architecture:** NPM on VM100 (`192.168.1.124`) owns private TCP/80, TCP/81, and TCP/443 and proxies `friday.mytechtactics.com` to FRIDAY on VM102 (`192.168.1.64:3010`). AdGuard resolves the FRIDAY FQDN to VM100; Cloudflare is used only for DNS-01 validation; Twingate exposes the same FQDN privately. VM102 keeps UFW as the host policy and installs a separate root-only Docker `DOCKER-USER` guard so Docker-published TCP/3010 cannot bypass the source restriction.

**Tech Stack:** Docker Engine/Compose, Nginx Proxy Manager, AdGuard Home, Cloudflare DNS API + Let's Encrypt DNS-01, Twingate, Ubuntu 26.04 UFW, iptables-nft-compatible `DOCKER-USER`, systemd, Node 22 tests, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-20-https-private-routing-foundation-design.md`

## Global Constraints

- FRIDAY remains unavailable as a public Internet service.
- Canonical URL is exactly `https://friday.mytechtactics.com` for LAN and Twingate.
- VM100 is `192.168.1.124`; VM102 is `192.168.1.64`; FRIDAY backend port is `3010`.
- NPM moves from host `4443:443` to standard host `443:443`; NPM admin TCP/81 remains private.
- Cloudflare is certificate-validation infrastructure only; no Cloudflare proxy route to FRIDAY is created.
- Cloudflare credentials stay out of git, frontend code, `VITE_*`, shell history, screenshots, and docs.
- VM102 TCP/3010 permits VM100 (`192.168.1.124`) as the only remote source after rollout.
- UFW INPUT rules alone are not accepted as the Docker-published-port boundary; the implementation must use `DOCKER-USER` and stop if that chain is not present.
- SSH access to VM102 must be preserved before any UFW enable/change.
- Do not disable Docker's firewall management (`iptables=false` / `ip6tables=false`).
- Do not pull or upgrade NPM as part of the 443 migration.
- Do not change NPM database/certificate/proxy-host data except the explicit FRIDAY certificate/proxy host.
- Do not add authentication, Supabase, break-glass access, approval endpoints, Docker mutation APIs, Proxmox mutation APIs, or container restart authority in this plan.
- Do not restart unrelated VM100 services.
- Stop at the first failed live validation; roll back only the component changed in that task.
- All live mutation steps require explicit user approval at the execution checkpoint before they are run.

---

## File Map

- Create: `ops/friday-backend-guard.sh` — root-only host helper that owns exactly two `DOCKER-USER` rules for the FRIDAY published backend.
- Create: `ops/friday-backend-guard.service` — systemd oneshot that reapplies the guard after Docker starts; it does not remove rules automatically on stop.
- Create: `ops/friday-backend-guard.test.mjs` — deterministic tests using a fake `iptables` executable; no root or real firewall required.
- Modify: `.github/workflows/ci.yml` — syntax-check `ops/*.sh` and prove the privileged helper is not referenced by FRIDAY runtime/browser code.
- Create: `docs/runbooks/https-private-routing-foundation.md` — operator runbook containing the approved hostnames, IPs, validation commands, rollback commands, and secret-handling rules.
- Modify after production acceptance: `docs/codex/BUILD_STATUS.md` — record the canonical HTTPS/private-routing production state.
- Modify after production acceptance: `docs/codex/NEXT_STEPS.md` — advance next major work to Owner authentication + Supabase/PostgreSQL.

The NPM Compose file at `/home/stalin/docker/nginx-proxy-manager/docker-compose.yml`, AdGuard configuration, Omada DHCP settings, Cloudflare zone, and Twingate Resources are live infrastructure state outside this repository. They are changed only by the explicit operational tasks below and are never copied into git with secrets.

---

### Task 1: Build the VM102 Docker-aware backend guard

**Files:**
- Create: `ops/friday-backend-guard.sh`
- Create: `ops/friday-backend-guard.test.mjs`

**Interfaces:**
- Consumes: Docker-created `DOCKER-USER` chain; original destination `192.168.1.64:3010`; approved proxy source `192.168.1.124`.
- Produces: CLI `sh ops/friday-backend-guard.sh apply|check|remove`; exactly one allow rule followed by one drop rule, identified by comments `friday-backend-guard-allow` and `friday-backend-guard-drop`.

- [ ] **Step 1: Write the failing Node test with a fake iptables binary**

Create `ops/friday-backend-guard.test.mjs`:

```js
import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const script = fileURLToPath(new URL('./friday-backend-guard.sh', import.meta.url))

async function fakeIptables(checkResult = 1) {
  const dir = await mkdtemp(join(tmpdir(), 'friday-iptables-'))
  const log = join(dir, 'calls.log')
  const binary = join(dir, 'iptables')
  await writeFile(binary, `#!/bin/sh\nprintf '%s\\n' "$*" >> "$IPTABLES_LOG"\ncase "$1" in\n  -S) exit 0 ;;\n  -C) exit ${checkResult} ;;\n  -I|-D) exit 0 ;;\n  *) exit 0 ;;\nesac\n`)
  await chmod(binary, 0o755)
  return { binary, log }
}

function run(command, fake) {
  return spawnSync('sh', [script, command], {
    encoding: 'utf8',
    env: {
      ...process.env,
      IPTABLES_BIN: fake.binary,
      IPTABLES_LOG: fake.log,
      FRIDAY_PROXY_IP: '192.168.1.124',
      FRIDAY_BACKEND_HOST_IP: '192.168.1.64',
      FRIDAY_BACKEND_PORT: '3010',
    },
  })
}

test('apply inserts VM100 allow before the FRIDAY backend drop', async () => {
  const fake = await fakeIptables(1)
  const result = run('apply', fake)
  assert.equal(result.status, 0, result.stderr)
  const calls = await readFile(fake.log, 'utf8')
  const inserts = calls.split('\n').filter((line) => line.startsWith('-I DOCKER-USER'))
  assert.equal(inserts.length, 2)
  assert.match(inserts[0], /--comment friday-backend-guard-drop -j DROP/)
  assert.match(inserts[1], /-s 192\.168\.1\.124 .*--ctorigdst 192\.168\.1\.64 .*--ctorigdstport 3010 .*--comment friday-backend-guard-allow -j ACCEPT/)
})

test('check fails closed when the rules are absent', async () => {
  const fake = await fakeIptables(1)
  const result = run('check', fake)
  assert.notEqual(result.status, 0)
})

test('remove deletes only the two named FRIDAY rules', async () => {
  const fake = await fakeIptables(0)
  const result = run('remove', fake)
  assert.equal(result.status, 0, result.stderr)
  const calls = await readFile(fake.log, 'utf8')
  assert.match(calls, /-D DOCKER-USER .*--comment friday-backend-guard-allow -j ACCEPT/)
  assert.match(calls, /-D DOCKER-USER .*--comment friday-backend-guard-drop -j DROP/)
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test ops/friday-backend-guard.test.mjs
```

Expected: FAIL because `ops/friday-backend-guard.sh` does not exist.

- [ ] **Step 3: Implement the minimal guard helper**

Create `ops/friday-backend-guard.sh`:

```sh
#!/usr/bin/env sh
set -eu

IPTABLES_BIN="${IPTABLES_BIN:-iptables}"
CHAIN="${FRIDAY_BACKEND_GUARD_CHAIN:-DOCKER-USER}"
PROXY_IP="${FRIDAY_PROXY_IP:-192.168.1.124}"
BACKEND_IP="${FRIDAY_BACKEND_HOST_IP:-192.168.1.64}"
BACKEND_PORT="${FRIDAY_BACKEND_PORT:-3010}"
ALLOW_COMMENT='friday-backend-guard-allow'
DROP_COMMENT='friday-backend-guard-drop'

chain_exists() {
  "$IPTABLES_BIN" -S "$CHAIN" >/dev/null 2>&1
}

allow_exists() {
  "$IPTABLES_BIN" -C "$CHAIN" -p tcp -s "$PROXY_IP" \
    -m conntrack --ctorigdst "$BACKEND_IP" --ctorigdstport "$BACKEND_PORT" \
    -m comment --comment "$ALLOW_COMMENT" -j ACCEPT >/dev/null 2>&1
}

drop_exists() {
  "$IPTABLES_BIN" -C "$CHAIN" -p tcp \
    -m conntrack --ctorigdst "$BACKEND_IP" --ctorigdstport "$BACKEND_PORT" \
    -m comment --comment "$DROP_COMMENT" -j DROP >/dev/null 2>&1
}

require_chain() {
  if ! chain_exists; then
    echo "FRIDAY backend guard: required $CHAIN chain is unavailable; no rules changed." >&2
    exit 1
  fi
}

check_rules() {
  require_chain
  allow_exists && drop_exists
}

apply_rules() {
  require_chain
  if ! drop_exists; then
    "$IPTABLES_BIN" -I "$CHAIN" 1 -p tcp \
      -m conntrack --ctorigdst "$BACKEND_IP" --ctorigdstport "$BACKEND_PORT" \
      -m comment --comment "$DROP_COMMENT" -j DROP
  fi
  if ! allow_exists; then
    "$IPTABLES_BIN" -I "$CHAIN" 1 -p tcp -s "$PROXY_IP" \
      -m conntrack --ctorigdst "$BACKEND_IP" --ctorigdstport "$BACKEND_PORT" \
      -m comment --comment "$ALLOW_COMMENT" -j ACCEPT
  fi
  check_rules
  echo "FRIDAY backend guard active: $PROXY_IP may reach $BACKEND_IP:$BACKEND_PORT; other remote sources are dropped."
}

remove_rules() {
  require_chain
  while allow_exists; do
    "$IPTABLES_BIN" -D "$CHAIN" -p tcp -s "$PROXY_IP" \
      -m conntrack --ctorigdst "$BACKEND_IP" --ctorigdstport "$BACKEND_PORT" \
      -m comment --comment "$ALLOW_COMMENT" -j ACCEPT
  done
  while drop_exists; do
    "$IPTABLES_BIN" -D "$CHAIN" -p tcp \
      -m conntrack --ctorigdst "$BACKEND_IP" --ctorigdstport "$BACKEND_PORT" \
      -m comment --comment "$DROP_COMMENT" -j DROP
  done
  echo 'FRIDAY backend guard rules removed.'
}

case "${1:-}" in
  apply) apply_rules ;;
  check)
    if check_rules; then
      echo 'FRIDAY backend guard rules are present.'
    else
      echo 'FRIDAY backend guard rules are missing.' >&2
      exit 1
    fi
    ;;
  remove) remove_rules ;;
  *)
    echo 'usage: friday-backend-guard.sh apply|check|remove' >&2
    exit 2
    ;;
esac
```

Do not add any invocation of this script to `server/`, `src/`, `package.json`, `Makefile`, or the FRIDAY container runtime.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
node --test ops/friday-backend-guard.test.mjs
sh -n ops/friday-backend-guard.sh
```

Expected: all three Node tests PASS and shell syntax check exits 0.

- [ ] **Step 5: Commit Task 1**

```bash
git add ops/friday-backend-guard.sh ops/friday-backend-guard.test.mjs
git commit -m "feat: add VM102 backend firewall guard"
```

---

### Task 2: Persist the guard after Docker starts and add CI isolation checks

**Files:**
- Create: `ops/friday-backend-guard.service`
- Modify: `ops/friday-backend-guard.test.mjs`
- Modify: `.github/workflows/ci.yml`
- Create: `docs/runbooks/https-private-routing-foundation.md`

**Interfaces:**
- Consumes: `/usr/local/sbin/friday-backend-guard` installed from Task 1 and Docker's `DOCKER-USER` chain.
- Produces: systemd unit `friday-backend-guard.service`; CI proves privileged host operations remain outside FRIDAY runtime/browser authority.

- [ ] **Step 1: Extend tests for the systemd unit and privileged-code isolation**

Append to `ops/friday-backend-guard.test.mjs`:

```js
const service = fileURLToPath(new URL('./friday-backend-guard.service', import.meta.url))

test('systemd unit applies after Docker and never removes policy automatically', async () => {
  const text = await readFile(service, 'utf8')
  assert.match(text, /^After=docker\.service network-online\.target$/m)
  assert.match(text, /^Requires=docker\.service$/m)
  assert.match(text, /^ExecStart=\/usr\/local\/sbin\/friday-backend-guard apply$/m)
  assert.doesNotMatch(text, /^ExecStop=/m)
})
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
node --test ops/friday-backend-guard.test.mjs
```

Expected: FAIL because `ops/friday-backend-guard.service` does not exist.

- [ ] **Step 3: Create the fail-closed systemd unit**

Create `ops/friday-backend-guard.service`:

```ini
[Unit]
Description=FRIDAY VM102 Docker published-port backend guard
After=docker.service network-online.target
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/friday-backend-guard apply
ExecReload=/usr/local/sbin/friday-backend-guard apply
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
```

There is intentionally no `ExecStop`; stopping the unit must not silently widen TCP/3010 access. Rollback uses the explicit `remove` command.

- [ ] **Step 4: Expand CI shell validation and add runtime-isolation gate**

Change the shell validation loop in `.github/workflows/ci.yml` from:

```yaml
for file in scripts/*.sh; do
```

to:

```yaml
for file in scripts/*.sh ops/*.sh; do
```

Add this step immediately after shell validation:

```yaml
      - name: Verify privileged ops isolation
        run: |
          if grep -RniE 'friday-backend-guard|DOCKER-USER|ctorigdst|iptables' server src compose.yaml compose.live.yaml package.json; then
            echo 'Privileged host-routing helper referenced by FRIDAY runtime/browser code.' >&2
            exit 1
          fi
          if grep -RniE 'VITE_.*(CLOUDFLARE|DNS|PROXY|FIREWALL)' src server compose.yaml .env.example; then
            echo 'Browser-visible private-routing secret/config variable detected.' >&2
            exit 1
          fi
```

Do not add `ops/` to the runtime stage of `Dockerfile`; the current runtime stage copies only `dist`, `server`, and `package.json`, which keeps this root-only helper outside the FRIDAY container.

- [ ] **Step 5: Create the operator runbook**

Create `docs/runbooks/https-private-routing-foundation.md` with these exact immutable identifiers and boundaries:

```markdown
# FRIDAY HTTPS + Private Routing Runbook

Canonical URL: `https://friday.mytechtactics.com`
NPM / AdGuard host: VM100 `192.168.1.124`
FRIDAY controller: VM102 `192.168.1.64`
FRIDAY backend: TCP/3010
NPM admin: private TCP/81
NPM public-facing-on-private-LAN ports: TCP/80 and TCP/443

Security boundary:
- Cloudflare: DNS-01 only; no public FRIDAY proxy record.
- AdGuard rewrite: `friday.mytechtactics.com -> 192.168.1.124`.
- NPM proxy: `https://friday.mytechtactics.com -> http://192.168.1.64:3010`.
- VM102 Docker-aware guard: only `192.168.1.124` may remotely reach original destination `192.168.1.64:3010`.
- NPM TCP/81 is LAN + admin-authorized Twingate only.
- No router forwarding for TCP/81 or TCP/3010.
- Never store the Cloudflare API token in this repository or shell history.

Rollback:
- NPM port migration: restore timestamped `docker-compose.yml` backup and recreate only NPM with `--pull never`.
- VM102 backend guard: `/usr/local/sbin/friday-backend-guard remove`, then disable the unit only if direct backend access is intentionally required for recovery.
- LAN DNS: restore DHCP DNS to `192.168.1.254`.
- Twingate: disable/remove only the FRIDAY/NPM Resources created by this rollout.
```

- [ ] **Step 6: Run focused and full verification**

Run:

```bash
node --test ops/friday-backend-guard.test.mjs
npm test
npm run build
for file in scripts/*.sh ops/*.sh; do sh -n "$file"; done
docker compose config >/dev/null
docker compose -f compose.yaml -f compose.live.yaml config >/dev/null
```

Expected: all tests PASS, build succeeds, shell syntax passes, both controller Compose variants validate.

- [ ] **Step 7: Commit Task 2**

```bash
git add ops/friday-backend-guard.service ops/friday-backend-guard.test.mjs .github/workflows/ci.yml docs/runbooks/https-private-routing-foundation.md
git commit -m "chore: gate private routing operations"
```

---

### Task 3: Open the implementation PR and establish the exact-head review gate

**Files:**
- No additional source changes.

**Interfaces:**
- Consumes: Task 1-2 branch head.
- Produces: exact reviewed commit SHA approved for temporary live validation; no merge yet.

- [ ] **Step 1: Create the execution branch from the approved design/plan branch**

At execution time, use `superpowers:using-git-worktrees` and create:

```text
feature/https-private-routing-20260821
```

from the commit containing this implementation plan. Do not start from an older `main` because the spec and plan must travel with the implementation PR.

- [ ] **Step 2: Run the repository verification contract**

```bash
make verify
```

Expected: tests, production build, controller Compose, local Docker override Compose, and observer Compose all pass.

- [ ] **Step 3: Push and open a PR to `main`**

PR title:

```text
feat: establish private HTTPS routing foundation
```

PR body must state:

```text
Adds only host-operator routing guard assets, CI isolation checks, the approved design, plan, and runbook. Does not add authentication or infrastructure mutation authority to the FRIDAY web/server runtime. Live NPM, AdGuard, UFW, Cloudflare, and Twingate rollout remains a separately approved production-validation phase.
```

- [ ] **Step 4: Require exact-head CI and code review before live use**

Use `superpowers:requesting-code-review`. Confirm the Friday CI run associated with the exact current PR head SHA is green. Review specifically for:

```text
- no server/src import or invocation of ops/friday-backend-guard.sh
- no Docker socket expansion
- no POST/PUT/PATCH/DELETE remediation route
- no frontend-visible Cloudflare/DNS/firewall secret
- guard inserts allow before drop
- guard fails when DOCKER-USER is absent
- service has no ExecStop widening access
```

- [ ] **Step 5: STOP for explicit production-validation approval**

Do not merge yet. Present the exact PR head SHA and successful CI/review evidence. Obtain explicit user approval to use that exact head for the live routing rollout in Tasks 4-9.

---

### Task 4: Capture live baselines and rollback state

**Files:**
- Live infrastructure only; no repository changes.

**Interfaces:**
- Consumes: approved exact PR head from Task 3.
- Produces: timestamped NPM backup, recorded VM102 firewall baseline, and proof that FRIDAY is healthy before changes.

- [ ] **Step 1: Capture VM100 NPM baseline without changing it**

On VM100:

```bash
STAMP=$(date +%Y%m%d-%H%M%S)
NPM_DIR=/home/stalin/docker/nginx-proxy-manager
cd "$NPM_DIR"

echo "===== NPM BASELINE $STAMP ====="
docker compose ps -a
docker port nginx-proxy-manager
sudo ss -lntup | grep -E ':(80|81|443|4443)([[:space:]]|$)' || true
curl -fsS -o /dev/null -w 'NPM admin: %{http_code}\n' http://127.0.0.1:81/

echo "===== TCP 443 MUST BE FREE BEFORE MIGRATION ====="
if sudo ss -lntH '( sport = :443 )' | grep -q .; then
  echo 'STOP: VM100 TCP/443 is already in use.' >&2
  exit 1
fi
```

Expected: NPM is running; 80/81/4443 are bound by NPM; host TCP/443 is free.

- [ ] **Step 2: Create NPM rollback bundle**

On VM100:

```bash
BACKUP="$NPM_DIR/backups/private-routing-$STAMP"
sudo mkdir -p "$BACKUP"
sudo cp -a "$NPM_DIR/docker-compose.yml" "$BACKUP/docker-compose.yml"
sudo cp -a "$NPM_DIR/data" "$BACKUP/data"
sudo cp -a "$NPM_DIR/letsencrypt" "$BACKUP/letsencrypt"
sudo file "$BACKUP/data/database.sqlite"
sudo stat --printf='DB bytes=%s modified=%y\n' "$BACKUP/data/database.sqlite"
echo "Rollback bundle: $BACKUP"
```

Expected: backup database is reported as SQLite and has nonzero size.

- [ ] **Step 3: Capture VM102 controller/firewall baseline**

On VM102:

```bash
cd /srv/infrastructure/apps/friday

echo '===== FRIDAY REPO ====='
git status --short
git rev-parse HEAD
make health

echo '===== UFW ====='
sudo ufw status verbose

echo '===== DOCKER USER CHAIN ====='
if ! sudo iptables -S DOCKER-USER; then
  echo 'STOP: Docker DOCKER-USER chain is unavailable; do not apply the planned guard.' >&2
  exit 1
fi

echo '===== LISTENERS ====='
sudo ss -lntup
```

Expected: FRIDAY health passes; `DOCKER-USER` exists. If it does not exist, stop this implementation and return to design review rather than inventing a firewall workaround.

- [ ] **Step 4: Save pre-change UFW and Docker-filter snapshots**

On VM102:

```bash
STAMP=$(date +%Y%m%d-%H%M%S)
sudo ufw status numbered | tee "/tmp/friday-ufw-before-$STAMP.txt"
sudo iptables-save | sudo tee "/tmp/friday-iptables-before-$STAMP.rules" >/dev/null
echo "Saved /tmp/friday-ufw-before-$STAMP.txt"
echo "Saved /tmp/friday-iptables-before-$STAMP.rules"
```

These files are for inspection/rollback reference only; do not automatically restore a whole `iptables-save` image because that could overwrite unrelated Docker state.

---

### Task 5: Move NPM from host TCP/4443 to standard TCP/443

**Files:**
- Modify live only: `/home/stalin/docker/nginx-proxy-manager/docker-compose.yml`

**Interfaces:**
- Consumes: Task 4 rollback bundle and proof that host TCP/443 is free.
- Produces: NPM listening on host 80/81/443 with existing database/proxy data preserved.

- [ ] **Step 1: Change exactly one `4443:443` mapping**

On VM100:

```bash
cd /home/stalin/docker/nginx-proxy-manager
python3 - <<'PY'
from pathlib import Path
import re
p = Path('docker-compose.yml')
text = p.read_text()
updated, count = re.subn(
    r'(?m)^(\s*-\s*["\']?)4443:443(["\']?\s*)$',
    r'\g<1>443:443\g<2>',
    text,
)
if count != 1:
    raise SystemExit(f'STOP: expected exactly one 4443:443 mapping, found {count}')
p.write_text(updated)
PY

grep -nE '80:80|81:81|443:443|4443:443' docker-compose.yml
docker compose config >/dev/null
```

Expected: one `443:443` mapping; no `4443:443`; Compose validates.

- [ ] **Step 2: Recreate only NPM without pulling an image**

```bash
docker compose up -d --no-deps --force-recreate --pull never nginx-proxy-manager
sleep 10
```

- [ ] **Step 3: Verify ports, data, admin UI, and outbound DNS**

```bash
docker compose ps -a
docker port nginx-proxy-manager
sudo ss -lntup | grep -E ':(80|81|443)([[:space:]]|$)'
curl -fsS -o /dev/null -w 'NPM admin: %{http_code}\n' http://127.0.0.1:81/
docker exec nginx-proxy-manager getent hosts cloudflare.com
sudo file data/database.sqlite
```

Expected: mappings include `80`, `81`, `443`; admin returns a non-000 HTTP status; Cloudflare resolves; SQLite remains valid.

- [ ] **Step 4: Validate existing NPM configuration in the UI**

Open privately:

```text
http://192.168.1.124:81
```

Confirm the existing proxy host list and stored configuration still appear. Do not edit unrelated hosts.

- [ ] **Step 5: Roll back only if Task 5 validation fails**

Use the Task 4 backup path shown during execution:

```bash
cd /home/stalin/docker/nginx-proxy-manager
sudo cp -a "$BACKUP/docker-compose.yml" ./docker-compose.yml
docker compose config >/dev/null
docker compose up -d --no-deps --force-recreate --pull never nginx-proxy-manager
```

Then stop the rollout and diagnose the failed NPM stage before continuing.

---

### Task 6: Establish private DNS, DNS-01 certificate, and the FRIDAY proxy host

**Files:**
- Live AdGuard, Cloudflare, and NPM configuration only.

**Interfaces:**
- Consumes: NPM on VM100 TCP/443 and still-open VM102 backend `192.168.1.64:3010`.
- Produces: trusted `friday.mytechtactics.com` HTTPS path through NPM before direct backend access is restricted.

- [ ] **Step 1: Verify or create the AdGuard DNS rewrite**

In AdGuard Home on VM100, ensure exactly this rewrite exists:

```text
friday.mytechtactics.com -> 192.168.1.124
```

Then on VM100:

```bash
dig @192.168.1.124 friday.mytechtactics.com +short
```

Expected exactly:

```text
192.168.1.124
```

Also verify ordinary upstream DNS:

```bash
dig @192.168.1.124 cloudflare.com +short | head
```

Expected: one or more public addresses.

- [ ] **Step 2: Verify public DNS does not expose the private FRIDAY destination**

```bash
dig @1.1.1.1 friday.mytechtactics.com +short
```

Expected: no `192.168.1.124` result. If a public A/AAAA/CNAME for FRIDAY already exists, stop and review it before proceeding.

- [ ] **Step 3: Create the least-privilege Cloudflare DNS token in the Cloudflare UI**

Create one dedicated token with:

```text
Permissions:
  Zone / DNS / Edit
  Zone / Zone / Read

Zone Resources:
  Include / Specific zone / mytechtactics.com
```

Do not paste the token into a shell, `.env`, git, chat output, or screenshots. Keep it only long enough to enter it into NPM's DNS-provider credential field.

- [ ] **Step 4: Request the NPM Let's Encrypt certificate with DNS-01**

In NPM:

```text
SSL Certificates -> Add SSL Certificate -> Let's Encrypt
Domain: friday.mytechtactics.com
Use a DNS Challenge: enabled
DNS Provider: Cloudflare
Credentials: dns_cloudflare_api_token = <paste token only in NPM secret field>
Agree to Let's Encrypt terms
```

Expected: certificate status becomes valid for `friday.mytechtactics.com`. Do not enable a Cloudflare orange-cloud/public proxy record.

- [ ] **Step 5: Create the FRIDAY NPM proxy host**

In NPM create:

```text
Domain Names: friday.mytechtactics.com
Scheme: http
Forward Hostname / IP: 192.168.1.64
Forward Port: 3010
Websockets Support: enabled
SSL Certificate: friday.mytechtactics.com
Force SSL: enabled
HTTP/2 Support: enabled when offered
HSTS: leave disabled for this rollout so rollback is not browser-pinned
```

- [ ] **Step 6: Validate HTTPS through NPM before firewall restriction**

From VM100:

```bash
curl --resolve friday.mytechtactics.com:443:192.168.1.124 \
  -fsS https://friday.mytechtactics.com/healthz
curl --resolve friday.mytechtactics.com:443:192.168.1.124 \
  -fsS https://friday.mytechtactics.com/api/health
curl --resolve friday.mytechtactics.com:443:192.168.1.124 \
  -fsS https://friday.mytechtactics.com/api/overview >/dev/null
```

Expected: `/healthz` and `/api/health` succeed with normal FRIDAY JSON; `/api/overview` exits 0.

- [ ] **Step 7: Validate HTTP-to-HTTPS behavior**

```bash
curl --resolve friday.mytechtactics.com:80:192.168.1.124 \
  -sSI http://friday.mytechtactics.com/ | head -10
```

Expected: redirect to `https://friday.mytechtactics.com/`.

---

### Task 7: Enforce VM102 UFW + Docker-aware TCP/3010 source restriction

**Files:**
- Install from reviewed PR head: `ops/friday-backend-guard.sh` -> `/usr/local/sbin/friday-backend-guard`
- Install from reviewed PR head: `ops/friday-backend-guard.service` -> `/etc/systemd/system/friday-backend-guard.service`

**Interfaces:**
- Consumes: working NPM -> VM102 proxy from Task 6 and exact reviewed PR head from Task 3.
- Produces: VM100 can reach VM102 TCP/3010; ordinary LAN/Twingate clients cannot bypass NPM to TCP/3010; rule re-applies after Docker startup.

- [ ] **Step 1: Fetch the reviewed PR head on VM102 without switching production FRIDAY off `main`**

```bash
cd /srv/infrastructure/apps/friday
git status --short
git fetch origin feature/https-private-routing-20260821
```

Expected: working tree is clean. If not clean, stop and inspect; do not overwrite local files.

- [ ] **Step 2: Install exactly the reviewed guard files from the PR branch**

```bash
git show origin/feature/https-private-routing-20260821:ops/friday-backend-guard.sh \
  | sudo tee /usr/local/sbin/friday-backend-guard >/dev/null
git show origin/feature/https-private-routing-20260821:ops/friday-backend-guard.service \
  | sudo tee /etc/systemd/system/friday-backend-guard.service >/dev/null
sudo chmod 0755 /usr/local/sbin/friday-backend-guard
sudo chmod 0644 /etc/systemd/system/friday-backend-guard.service
sudo sh -n /usr/local/sbin/friday-backend-guard
```

- [ ] **Step 3: Preserve SSH and establish UFW host policy**

First inspect non-loopback TCP listeners:

```bash
sudo ss -lntH
```

If VM102 has an unexpected externally-bound service other than SSH/FRIDAY, stop and review before enabling a default-deny UFW policy.

Then:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp comment 'VM102 SSH'
sudo ufw allow from 192.168.1.124 to any port 3010 proto tcp comment 'NPM to FRIDAY backend'
sudo ufw --force enable
sudo ufw status verbose
```

The UFW 3010 rule documents the host policy, but it is not considered sufficient until the Docker-aware guard passes.

- [ ] **Step 4: Enable the Docker-aware guard**

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now friday-backend-guard.service
sudo /usr/local/sbin/friday-backend-guard check
sudo iptables -S DOCKER-USER | grep 'friday-backend-guard'
```

Expected ordering in `DOCKER-USER`: the `friday-backend-guard-allow` rule appears before `friday-backend-guard-drop`.

- [ ] **Step 5: Prove the allowed backend path from VM100**

On VM100:

```bash
curl -fsS --connect-timeout 3 http://192.168.1.64:3010/healthz
```

Expected: FRIDAY health JSON.

- [ ] **Step 6: Prove direct access is denied from an ordinary LAN client**

From a LAN client whose IP is not `192.168.1.124`:

```bash
curl --connect-timeout 3 -v http://192.168.1.64:3010/healthz
```

Expected: connection times out/fails; it must not return FRIDAY JSON.

- [ ] **Step 7: Prove the canonical HTTPS path still succeeds from that same LAN client**

```bash
curl --resolve friday.mytechtactics.com:443:192.168.1.124 \
  -fsS https://friday.mytechtactics.com/healthz
```

Expected: FRIDAY health JSON.

- [ ] **Step 8: Verify FRIDAY itself was not restarted or granted new authority**

On VM102:

```bash
cd /srv/infrastructure/apps/friday
docker compose ps
make health
grep -E '^(FRIDAY_DOCKER_ENABLED|FRIDAY_VM100_OBSERVER_ENABLED|FRIDAY_MONITORING_ENABLED|FRIDAY_DIAGNOSTICS_ENABLED)=' .env
```

Expected production safety flags remain:

```text
FRIDAY_DOCKER_ENABLED=false
FRIDAY_VM100_OBSERVER_ENABLED=true
FRIDAY_MONITORING_ENABLED=true
FRIDAY_DIAGNOSTICS_ENABLED=true
```

- [ ] **Step 9: Roll back only if NPM loses backend reachability**

On VM102:

```bash
sudo /usr/local/sbin/friday-backend-guard remove
sudo systemctl disable --now friday-backend-guard.service
```

If UFW was inactive before Task 7 and was enabled only for this rollout, disable it only after confirming the guard removal is intentional recovery behavior:

```bash
sudo ufw disable
```

Then stop and diagnose. Do not weaken NPM, AdGuard, or unrelated VM102 rules.

---

### Task 8: Make AdGuard the LAN DNS source in stages

**Files:**
- Live AdGuard and Omada LAN DHCP configuration only.

**Interfaces:**
- Consumes: working AdGuard upstream resolution/rewrite and working HTTPS proxy.
- Produces: LAN clients resolve `friday.mytechtactics.com` to VM100 without `--resolve`; prior DNS `192.168.1.254` remains the rollback target.

- [ ] **Step 1: Use VM102 as the temporary system-resolver test client**

On VM102:

```bash
IFACE=$(ip route show default | awk '{print $5; exit}')
echo "Testing resolver on $IFACE"
resolvectl status "$IFACE"
sudo resolvectl dns "$IFACE" 192.168.1.124
sudo resolvectl domain "$IFACE" '~.'
resolvectl flush-caches
resolvectl query friday.mytechtactics.com
resolvectl query cloudflare.com
curl -fsS https://friday.mytechtactics.com/healthz
```

Expected: FRIDAY resolves to `192.168.1.124`, ordinary DNS succeeds, canonical HTTPS succeeds.

- [ ] **Step 2: Revert the temporary VM102 resolver override**

```bash
sudo resolvectl revert "$IFACE"
resolvectl flush-caches
```

This prevents the test override from becoming an undocumented permanent server setting.

- [ ] **Step 3: Change the Omada LAN DHCP DNS option**

In Omada Controller, edit the active LAN/DHCP network for `192.168.1.0/24` and set DNS to manual:

```text
Primary DNS: 192.168.1.124
Secondary DNS: blank
```

Do not configure `1.1.1.1`, `8.8.8.8`, or `192.168.1.254` as a simultaneous client secondary resolver because clients could bypass the private rewrite. Record the previous value `192.168.1.254` for rollback.

Do not alter VLANs, gateway address, DHCP pool, subnet mask, or routes in this task.

- [ ] **Step 4: Renew one Windows LAN test client and validate before broad acceptance**

On one Windows 11 client:

```powershell
ipconfig /release
ipconfig /renew
ipconfig /flushdns
ipconfig /all | findstr /C:"DNS Servers"
nslookup friday.mytechtactics.com
curl.exe -fsS https://friday.mytechtactics.com/healthz
nslookup cloudflare.com
```

Expected: DNS server includes `192.168.1.124`; FRIDAY resolves to `192.168.1.124`; HTTPS and public DNS work.

- [ ] **Step 5: Roll back DHCP DNS only if the test client fails**

Restore the Omada LAN DHCP DNS setting to:

```text
192.168.1.254
```

Renew the test client again and stop the rollout for DNS diagnosis.

---

### Task 9: Add private Twingate access for FRIDAY and NPM administration

**Files:**
- Live Twingate configuration only.

**Interfaces:**
- Consumes: LAN private DNS now resolving FRIDAY correctly and NPM serving trusted HTTPS.
- Produces: authorized remote users can use `https://friday.mytechtactics.com`; only the admin group can reach NPM TCP/81; no Twingate direct resource is created for VM102 TCP/3010.

- [ ] **Step 1: Verify Connector-side DNS before creating the FRIDAY Resource**

On the host running the Twingate Connector, run:

```bash
getent hosts friday.mytechtactics.com
```

Expected: resolution includes `192.168.1.124`. If it does not, stop Task 9 and repair the Connector host's LAN DNS adoption before creating any public fallback record.

- [ ] **Step 2: Create the FRIDAY FQDN Resource in Twingate**

Create:

```text
Resource name: FRIDAY Control Plane
Address: friday.mytechtactics.com
Allowed port: TCP 443 only
Access: intended FRIDAY users/groups only
```

Do not create a Resource for `192.168.1.64:3010`.

- [ ] **Step 3: Create a separate admin-only NPM Resource**

Create:

```text
Resource name: NPM Admin
Address: 192.168.1.124
Allowed port: TCP 81 only
Access: Owner/admin group only
```

This Resource is independent of normal FRIDAY access.

- [ ] **Step 4: Validate from a remote device using Twingate**

With the device off the home LAN and Twingate connected:

```bash
curl -fsS https://friday.mytechtactics.com/healthz
```

Expected: FRIDAY health JSON with a browser-trusted certificate.

Also attempt the direct backend:

```bash
curl --connect-timeout 3 -v http://192.168.1.64:3010/healthz
```

Expected: failure; no FRIDAY JSON.

- [ ] **Step 5: Validate NPM admin authorization separately**

From an authorized admin Twingate identity, open:

```text
http://192.168.1.124:81
```

Expected: NPM admin loads. A non-admin Twingate identity must not be assigned this Resource.

---

### Task 10: Run final regression, update source-of-truth docs, and merge only after approval

**Files:**
- Modify: `docs/codex/BUILD_STATUS.md`
- Modify: `docs/codex/NEXT_STEPS.md`

**Interfaces:**
- Consumes: all Spec 1 acceptance checks passing in production.
- Produces: repository records the new canonical private HTTPS baseline and points future work to Spec 2 Owner authentication + Supabase/PostgreSQL.

- [ ] **Step 1: Run canonical HTTPS FRIDAY regression from LAN**

```bash
curl -fsS https://friday.mytechtactics.com/healthz
curl -fsS https://friday.mytechtactics.com/api/health
curl -fsS https://friday.mytechtactics.com/api/overview >/dev/null
curl -fsS https://friday.mytechtactics.com/api/incidents >/dev/null
```

Expected: all exit 0.

- [ ] **Step 2: Validate diagnostic rerun still works through HTTPS without remediation**

Use the current open NPM incident ID returned by `/api/incidents` and run exactly one controller-side diagnostic rerun:

```bash
INCIDENT_ID=$(curl -fsS https://friday.mytechtactics.com/api/incidents \
  | jq -r '.incidents[] | select(.serviceName=="nginx-proxy-manager" and .status=="open") | .id' \
  | head -n1)

if [ -n "$INCIDENT_ID" ]; then
  curl -fsS -X POST \
    "https://friday.mytechtactics.com/api/incidents/$INCIDENT_ID/diagnostics/rerun" \
    | jq '{status, findings, likelyCauses, lastLogInspectionAt}'
fi
```

Expected if an open supported incident still exists: diagnostic metadata refresh succeeds and no infrastructure remediation occurs. If NPM recovery has already resolved the incident and no open NPM incident exists, record that the rerun route is not applicable rather than creating a synthetic incident.

- [ ] **Step 3: Verify network acceptance matrix**

Record PASS/FAIL for:

```text
LAN -> https://friday.mytechtactics.com:443            PASS
Twingate -> https://friday.mytechtactics.com:443       PASS
VM100 -> http://192.168.1.64:3010                      PASS
ordinary LAN -> http://192.168.1.64:3010               FAIL as designed
Twingate -> http://192.168.1.64:3010                   FAIL as designed
LAN/admin Twingate -> http://192.168.1.124:81          PASS when authorized
public Internet -> NPM TCP/81                           NOT EXPOSED
public Internet -> VM102 TCP/3010                       NOT EXPOSED
```

- [ ] **Step 4: Update `docs/codex/BUILD_STATUS.md`**

Replace stale NPM-offline/direct-3010 statements and add:

```markdown
## HTTPS + Private Routing Foundation — production validated

- Canonical FRIDAY URL: `https://friday.mytechtactics.com`.
- NPM on VM100 `192.168.1.124` is the standard private HTTPS gateway and owns host TCP/80, TCP/81, TCP/443.
- AdGuard resolves `friday.mytechtactics.com` privately to `192.168.1.124` and is the LAN DHCP DNS resolver.
- Cloudflare is used for DNS-01 certificate validation only; FRIDAY is not publicly proxied.
- NPM forwards FRIDAY to VM102 `192.168.1.64:3010`.
- VM102 uses UFW plus the root-only `DOCKER-USER` backend guard; VM100 is the only permitted remote source to TCP/3010.
- Twingate provides remote FQDN access to FRIDAY and a separate admin-only TCP/81 Resource for NPM.
- FRIDAY application authority remains unchanged: no infrastructure restart/start/stop/delete/update endpoint exists.
```

- [ ] **Step 5: Update `docs/codex/NEXT_STEPS.md`**

Make the next major milestone:

```markdown
1. Owner authentication backed by Supabase/PostgreSQL on VM100.
2. SSH-activated single-use break-glass Owner access on VM102.
3. Approval-gated restart of one existing VM100 Docker container only after authentication, approval, and durable audit are production-validated.
```

Keep restart authority explicitly blocked until those prerequisites ship.

- [ ] **Step 6: Run final repository verification**

On the implementation branch:

```bash
make verify
```

Expected: PASS.

- [ ] **Step 7: Commit production-status documentation**

```bash
git add docs/codex/BUILD_STATUS.md docs/codex/NEXT_STEPS.md
git commit -m "docs: record private HTTPS production baseline"
```

- [ ] **Step 8: Re-run exact-head CI and final review**

Push the updated branch. Require a new Friday CI run tied to the new exact head SHA. Use `superpowers:verification-before-completion` and `superpowers:requesting-code-review` before any merge claim.

- [ ] **Step 9: STOP for explicit merge approval**

Present:

```text
- exact PR head SHA
- green exact-head CI
- code-review result
- LAN HTTPS validation
- Twingate HTTPS validation
- direct 3010 deny evidence
- VM100 -> 3010 allow evidence
- NPM 80/81/443 evidence
- AdGuard private-DNS evidence
- confirmation no public FRIDAY/NPM-admin port forwarding was added
```

Do not merge without explicit user approval.

- [ ] **Step 10: After approval, merge and verify `main`**

Use the approved merge method with an expected-head SHA guard. After merge, verify GitHub `main` points to the merge commit, then on VM102:

```bash
cd /srv/infrastructure/apps/friday
git checkout main
git pull --ff-only origin main
make health
sudo /usr/local/sbin/friday-backend-guard check
```

Expected: FRIDAY remains healthy and the backend guard remains active. Do not restart NPM or FRIDAY merely because the documentation/ops PR merged.
