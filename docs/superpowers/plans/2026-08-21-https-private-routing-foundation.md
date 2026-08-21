# HTTPS + Private Routing Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move FRIDAY to one private, browser-trusted URL at `https://friday.mytechtactics.com`, with Nginx Proxy Manager as the private HTTPS gateway, AdGuard as private DNS, Twingate as the remote path, and VM102 TCP/3010 reachable only from VM100.

**Architecture:** NPM on VM100 (`192.168.1.124`) owns private TCP/80, TCP/81, and TCP/443 and proxies the FRIDAY FQDN to VM102 (`192.168.1.64:3010`). Cloudflare is used only for DNS-01 certificate validation. VM102 keeps UFW as host policy and adds a root-only `DOCKER-USER` guard so Docker-published TCP/3010 cannot bypass the source restriction.

**Tech Stack:** Docker Engine/Compose, Nginx Proxy Manager, AdGuard Home, Cloudflare DNS API + Let's Encrypt DNS-01, Twingate, Ubuntu 26.04 UFW, iptables-nft-compatible `DOCKER-USER`, systemd, Node 22 tests, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-20-https-private-routing-foundation-design.md`

## Global Constraints

- FRIDAY must remain unavailable as a public Internet service.
- Canonical URL is exactly `https://friday.mytechtactics.com` for LAN and Twingate.
- VM100 is `192.168.1.124`; VM102 is `192.168.1.64`; FRIDAY backend port is `3010`.
- NPM moves from host `4443:443` to `443:443`; NPM admin TCP/81 stays private.
- Cloudflare is certificate-validation infrastructure only; do not create a public Cloudflare proxy route to FRIDAY.
- Cloudflare credentials must never enter git, frontend code, `VITE_*`, shell history, screenshots, or docs.
- After rollout, VM100 (`192.168.1.124`) is the only permitted remote source to VM102 TCP/3010.
- UFW alone is not accepted for the Docker-published-port boundary; `DOCKER-USER` must exist and must enforce the source restriction.
- Preserve SSH to VM102 before enabling/changing UFW.
- Never set Docker `iptables=false` or `ip6tables=false`.
- Do not pull/upgrade NPM as part of the 443 migration.
- Do not alter NPM database/certificates/unrelated proxy hosts except the explicit FRIDAY certificate/proxy host.
- Do not add authentication, Supabase, break-glass access, approval endpoints, container restart authority, Docker mutation APIs, or Proxmox mutation APIs in this plan.
- Do not restart unrelated VM100 services.
- Stop at the first failed live validation and roll back only the component changed in that task.
- Every live mutation task requires explicit user approval at its execution checkpoint.

## File Map

- Create `ops/friday-backend-guard.sh` — owns exactly two `DOCKER-USER` rules for FRIDAY TCP/3010.
- Create `ops/friday-backend-guard.service` — reapplies the guard after Docker starts/restarts; has no automatic rule-removal action.
- Create `ops/friday-backend-guard.test.mjs` — fake-iptables tests; no root/firewall required.
- Modify `.github/workflows/ci.yml` — syntax-check `ops/*.sh` and prove privileged ops are not referenced by FRIDAY runtime/browser code.
- Create `docs/runbooks/https-private-routing-foundation.md` — source-controlled operator/rollback runbook.
- Modify after live acceptance `docs/codex/BUILD_STATUS.md` and `docs/codex/NEXT_STEPS.md`.

Live state outside git:

- NPM Compose: `/home/stalin/docker/nginx-proxy-manager/docker-compose.yml`
- NPM data: `/home/stalin/docker/nginx-proxy-manager/data`
- NPM certificate state: `/home/stalin/docker/nginx-proxy-manager/letsencrypt`
- AdGuard/Omada/Cloudflare/Twingate configuration
- VM102 UFW and `DOCKER-USER` rules

---

### Task 1: Build and test the VM102 Docker-aware backend guard

**Files:**
- Create `ops/friday-backend-guard.sh`
- Create `ops/friday-backend-guard.test.mjs`

**Interfaces:**
- Consumes: `DOCKER-USER`, original destination `192.168.1.64:3010`, approved proxy source `192.168.1.124`.
- Produces: `friday-backend-guard.sh apply|check|remove`; comments `friday-backend-guard-allow` and `friday-backend-guard-drop`.

- [ ] **Step 1: Write the failing test**

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

async function fakeIptables() {
  const dir = await mkdtemp(join(tmpdir(), 'friday-iptables-'))
  const binary = join(dir, 'iptables')
  const log = join(dir, 'calls.log')
  const state = join(dir, 'state')
  await writeFile(state, '')
  await writeFile(binary, `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$IPTABLES_LOG"
comment=''
case "$*" in
  *friday-backend-guard-allow*) comment='allow' ;;
  *friday-backend-guard-drop*) comment='drop' ;;
esac
case "$1" in
  -S) exit 0 ;;
  -C)
    grep -qx "$comment" "$IPTABLES_STATE" && exit 0
    exit 1
    ;;
  -I)
    grep -qx "$comment" "$IPTABLES_STATE" 2>/dev/null || printf '%s\\n' "$comment" >> "$IPTABLES_STATE"
    exit 0
    ;;
  -D)
    grep -vx "$comment" "$IPTABLES_STATE" > "$IPTABLES_STATE.tmp" || true
    mv "$IPTABLES_STATE.tmp" "$IPTABLES_STATE"
    exit 0
    ;;
  *) exit 0 ;;
esac
`)
  await chmod(binary, 0o755)
  return { binary, log, state }
}

function run(command, fake) {
  return spawnSync('sh', [script, command], {
    encoding: 'utf8',
    env: {
      ...process.env,
      IPTABLES_BIN: fake.binary,
      IPTABLES_LOG: fake.log,
      IPTABLES_STATE: fake.state,
      FRIDAY_PROXY_IP: '192.168.1.124',
      FRIDAY_BACKEND_HOST_IP: '192.168.1.64',
      FRIDAY_BACKEND_PORT: '3010',
    },
  })
}

test('apply inserts drop first then allow at position 1, yielding allow-before-drop final order', async () => {
  const fake = await fakeIptables()
  const result = run('apply', fake)
  assert.equal(result.status, 0, result.stderr)
  const inserts = (await readFile(fake.log, 'utf8')).split('\n').filter((line) => line.startsWith('-I DOCKER-USER'))
  assert.equal(inserts.length, 2)
  assert.match(inserts[0], /--comment friday-backend-guard-drop -j DROP/)
  assert.match(inserts[1], /-I DOCKER-USER 1 .* -s 192\.168\.1\.124 .*--ctorigdst 192\.168\.1\.64 .*--ctorigdstport 3010 .*--comment friday-backend-guard-allow -j ACCEPT/)
})

test('apply is idempotent', async () => {
  const fake = await fakeIptables()
  assert.equal(run('apply', fake).status, 0)
  assert.equal(run('apply', fake).status, 0)
  const inserts = (await readFile(fake.log, 'utf8')).split('\n').filter((line) => line.startsWith('-I DOCKER-USER'))
  assert.equal(inserts.length, 2)
})

test('check fails when rules are absent and passes after apply', async () => {
  const fake = await fakeIptables()
  assert.notEqual(run('check', fake).status, 0)
  assert.equal(run('apply', fake).status, 0)
  assert.equal(run('check', fake).status, 0)
})

test('remove deletes only the two named rules', async () => {
  const fake = await fakeIptables()
  assert.equal(run('apply', fake).status, 0)
  assert.equal(run('remove', fake).status, 0)
  assert.equal((await readFile(fake.state, 'utf8')).trim(), '')
  const calls = await readFile(fake.log, 'utf8')
  assert.match(calls, /-D DOCKER-USER .*friday-backend-guard-allow/)
  assert.match(calls, /-D DOCKER-USER .*friday-backend-guard-drop/)
})
```

- [ ] **Step 2: Run RED**

```bash
node --test ops/friday-backend-guard.test.mjs
```

Expected: FAIL because `ops/friday-backend-guard.sh` is absent.

- [ ] **Step 3: Implement the guard**

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

chain_exists() { "$IPTABLES_BIN" -S "$CHAIN" >/dev/null 2>&1; }
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
  chain_exists || { echo "FRIDAY backend guard: $CHAIN is unavailable; no rules changed." >&2; exit 1; }
}
check_rules() { require_chain; allow_exists && drop_exists; }
apply_rules() {
  require_chain
  drop_exists || "$IPTABLES_BIN" -I "$CHAIN" 1 -p tcp \
    -m conntrack --ctorigdst "$BACKEND_IP" --ctorigdstport "$BACKEND_PORT" \
    -m comment --comment "$DROP_COMMENT" -j DROP
  allow_exists || "$IPTABLES_BIN" -I "$CHAIN" 1 -p tcp -s "$PROXY_IP" \
    -m conntrack --ctorigdst "$BACKEND_IP" --ctorigdstport "$BACKEND_PORT" \
    -m comment --comment "$ALLOW_COMMENT" -j ACCEPT
  check_rules
  echo "FRIDAY backend guard active: $PROXY_IP -> $BACKEND_IP:$BACKEND_PORT only."
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
  check) check_rules && echo 'FRIDAY backend guard rules are present.' ;;
  remove) remove_rules ;;
  *) echo 'usage: friday-backend-guard.sh apply|check|remove' >&2; exit 2 ;;
esac
```

- [ ] **Step 4: Run GREEN**

```bash
node --test ops/friday-backend-guard.test.mjs
sh -n ops/friday-backend-guard.sh
```

Expected: four tests PASS; shell syntax exits 0.

- [ ] **Step 5: Commit**

```bash
git add ops/friday-backend-guard.sh ops/friday-backend-guard.test.mjs
git commit -m "feat: add VM102 backend firewall guard"
```

---

### Task 2: Persist the guard after Docker restarts and isolate it from FRIDAY runtime authority

**Files:**
- Create `ops/friday-backend-guard.service`
- Modify `ops/friday-backend-guard.test.mjs`
- Modify `.github/workflows/ci.yml`
- Create `docs/runbooks/https-private-routing-foundation.md`

**Interfaces:**
- Consumes: Task 1 helper installed as `/usr/local/sbin/friday-backend-guard`.
- Produces: systemd unit that is restarted with Docker and CI that fails if runtime/browser code references privileged host-routing operations.

- [ ] **Step 1: Add the failing service-unit test**

Append:

```js
const service = fileURLToPath(new URL('./friday-backend-guard.service', import.meta.url))

test('systemd reapplies policy when Docker restarts and never removes it automatically', async () => {
  const text = await readFile(service, 'utf8')
  assert.match(text, /^After=docker\.service network-online\.target$/m)
  assert.match(text, /^Requires=docker\.service$/m)
  assert.match(text, /^PartOf=docker\.service$/m)
  assert.match(text, /^ExecStart=\/usr\/local\/sbin\/friday-backend-guard apply$/m)
  assert.doesNotMatch(text, /^ExecStop=/m)
})
```

- [ ] **Step 2: Run RED**

```bash
node --test ops/friday-backend-guard.test.mjs
```

Expected: service-unit test FAILS because the unit is absent.

- [ ] **Step 3: Create the service unit**

`ops/friday-backend-guard.service`:

```ini
[Unit]
Description=FRIDAY VM102 Docker published-port backend guard
After=docker.service network-online.target
Requires=docker.service
PartOf=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/friday-backend-guard apply
ExecReload=/usr/local/sbin/friday-backend-guard apply
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
```

`PartOf=docker.service` ensures a Docker restart also restarts this oneshot after Docker, so the dynamically recreated `DOCKER-USER` chain gets the FRIDAY rules again. There is intentionally no `ExecStop`; stopping the unit alone must not widen access.

- [ ] **Step 4: Expand CI**

In `.github/workflows/ci.yml`, change:

```yaml
for file in scripts/*.sh; do
```

to:

```yaml
for file in scripts/*.sh ops/*.sh; do
```

Add after shell validation:

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

Do not copy `ops/` into the runtime stage of `Dockerfile`.

- [ ] **Step 5: Create the runbook**

Create `docs/runbooks/https-private-routing-foundation.md` containing exactly:

```markdown
# FRIDAY HTTPS + Private Routing Runbook

Canonical URL: `https://friday.mytechtactics.com`
NPM / AdGuard: VM100 `192.168.1.124`
FRIDAY controller: VM102 `192.168.1.64`
FRIDAY backend: TCP/3010
NPM admin: private TCP/81

Security boundary:
- Cloudflare is DNS-01 only; no public FRIDAY proxy route.
- AdGuard rewrite: `friday.mytechtactics.com -> 192.168.1.124`.
- NPM proxy: `https://friday.mytechtactics.com -> http://192.168.1.64:3010`.
- Only VM100 may remotely reach original destination `192.168.1.64:3010`.
- NPM TCP/81 is LAN + admin-authorized Twingate only.
- No router forwarding for NPM TCP/81 or VM102 TCP/3010.
- Never store the Cloudflare API token in git or shell history.

Rollback:
- NPM: restore the timestamped Compose backup and recreate only NPM with `--pull never`.
- VM102 backend guard: run `/usr/local/sbin/friday-backend-guard remove` only for intentional recovery.
- LAN DNS: restore DHCP DNS to `192.168.1.254`.
- Twingate: disable only the FRIDAY/NPM Resources created by this rollout.
```

- [ ] **Step 6: Run GREEN and full verification**

```bash
node --test ops/friday-backend-guard.test.mjs
npm test
npm run build
for file in scripts/*.sh ops/*.sh; do sh -n "$file"; done
docker compose config >/dev/null
docker compose -f compose.yaml -f compose.live.yaml config >/dev/null
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add ops .github/workflows/ci.yml docs/runbooks/https-private-routing-foundation.md
git commit -m "chore: gate private routing operations"
```

---

### Task 3: Open the implementation PR and establish the exact-head gate

**Files:** none.

**Interfaces:**
- Consumes: Task 1-2 branch head.
- Produces: reviewed exact PR head approved for temporary live validation; no merge yet.

- [ ] **Step 1: Create the execution branch/worktree**

At execution time use `superpowers:using-git-worktrees` and create:

```text
feature/https-private-routing-20260821
```

from the commit containing this plan. The spec and plan must travel in the implementation PR.

- [ ] **Step 2: Verify repository**

```bash
make verify
```

Expected: PASS.

- [ ] **Step 3: Push/open PR**

Title:

```text
feat: establish private HTTPS routing foundation
```

Body:

```text
Adds only host-operator routing guard assets, CI isolation checks, the approved design/plan, and runbook. It does not add authentication or infrastructure mutation authority to the FRIDAY web/server runtime. Live NPM, AdGuard, UFW, Cloudflare, and Twingate changes remain separately approval-gated.
```

- [ ] **Step 4: Require exact-head CI and review**

Use `superpowers:requesting-code-review`. Confirm the exact current PR head has green Friday CI. Review must prove:

```text
no server/src invocation of ops/friday-backend-guard.sh
no Docker socket expansion
no remediation HTTP route
no browser-visible Cloudflare/DNS/firewall secret
guard fails when DOCKER-USER is absent
guard apply is idempotent
allow is final-chain ordered before drop
systemd has PartOf=docker.service and no ExecStop
```

- [ ] **Step 5: STOP for explicit live-validation approval**

Present exact head SHA + green CI + review evidence. Do not merge yet. Obtain explicit approval before Tasks 4-9.

---

### Task 4: Capture live baseline and rollback state

**Files:** live infrastructure only.

**Interfaces:**
- Produces: NPM rollback bundle, persisted backup-pointer file, VM102 firewall baseline, and pre-change FRIDAY health evidence.

- [ ] **Step 1: VM100 NPM baseline**

```bash
STAMP=$(date +%Y%m%d-%H%M%S)
NPM_DIR=/home/stalin/docker/nginx-proxy-manager
cd "$NPM_DIR"
docker compose ps -a
docker port nginx-proxy-manager
sudo ss -lntup | grep -E ':(80|81|443|4443)([[:space:]]|$)' || true
curl -fsS -o /dev/null -w 'NPM admin: %{http_code}\n' http://127.0.0.1:81/
if sudo ss -lntH '( sport = :443 )' | grep -q .; then
  echo 'STOP: VM100 TCP/443 is already in use.' >&2
  exit 1
fi
```

Expected: NPM running; 80/81/4443 present; host 443 free.

- [ ] **Step 2: Create NPM rollback bundle and persist its path**

```bash
BACKUP="$NPM_DIR/backups/private-routing-$STAMP"
sudo mkdir -p "$BACKUP"
sudo cp -a "$NPM_DIR/docker-compose.yml" "$BACKUP/docker-compose.yml"
sudo cp -a "$NPM_DIR/data" "$BACKUP/data"
sudo cp -a "$NPM_DIR/letsencrypt" "$BACKUP/letsencrypt"
printf '%s\n' "$BACKUP" | sudo tee "$NPM_DIR/backups/.last-private-routing-backup" >/dev/null
sudo file "$BACKUP/data/database.sqlite"
sudo stat --printf='DB bytes=%s modified=%y\n' "$BACKUP/data/database.sqlite"
```

Expected: SQLite, nonzero DB size.

- [ ] **Step 3: VM102 baseline**

```bash
cd /srv/infrastructure/apps/friday
git status --short
git rev-parse HEAD
make health
sudo ufw status verbose
if ! sudo iptables -S DOCKER-USER; then
  echo 'STOP: DOCKER-USER is unavailable; do not invent a workaround.' >&2
  exit 1
fi
sudo ss -lntup
```

Expected: clean repo, healthy FRIDAY, `DOCKER-USER` exists.

- [ ] **Step 4: Capture firewall reference files**

```bash
STAMP=$(date +%Y%m%d-%H%M%S)
sudo ufw status numbered | tee "/tmp/friday-ufw-before-$STAMP.txt"
sudo iptables-save | sudo tee "/tmp/friday-iptables-before-$STAMP.rules" >/dev/null
```

Never bulk-restore the `iptables-save` file; it is inspection evidence only because Docker owns unrelated dynamic rules.

---

### Task 5: Move NPM from host TCP/4443 to TCP/443

**Files:** live `/home/stalin/docker/nginx-proxy-manager/docker-compose.yml` only.

**Interfaces:**
- Consumes: Task 4 backup and proof 443 is free.
- Produces: NPM on host 80/81/443 with persistent state preserved.

- [ ] **Step 1: Replace exactly one mapping**

```bash
cd /home/stalin/docker/nginx-proxy-manager
python3 - <<'PY'
from pathlib import Path
import re
p = Path('docker-compose.yml')
text = p.read_text()
updated, count = re.subn(r'(?m)^(\s*-\s*["\']?)4443:443(["\']?\s*)$', r'\g<1>443:443\g<2>', text)
if count != 1:
    raise SystemExit(f'STOP: expected exactly one 4443:443 mapping, found {count}')
p.write_text(updated)
PY
grep -nE '80:80|81:81|443:443|4443:443' docker-compose.yml
docker compose config >/dev/null
```

Expected: 443:443 present once; 4443:443 absent.

- [ ] **Step 2: Recreate only NPM, no pull**

```bash
docker compose up -d --no-deps --force-recreate --pull never nginx-proxy-manager
sleep 10
```

- [ ] **Step 3: Validate**

```bash
docker compose ps -a
docker port nginx-proxy-manager
sudo ss -lntup | grep -E ':(80|81|443)([[:space:]]|$)'
curl -fsS -o /dev/null -w 'NPM admin: %{http_code}\n' http://127.0.0.1:81/
docker exec nginx-proxy-manager getent hosts cloudflare.com
sudo file data/database.sqlite
```

Then privately open `http://192.168.1.124:81` and confirm existing proxy-host data is still present.

- [ ] **Step 4: Component-local rollback if validation fails**

```bash
cd /home/stalin/docker/nginx-proxy-manager
BACKUP=$(sudo cat backups/.last-private-routing-backup)
sudo cp -a "$BACKUP/docker-compose.yml" ./docker-compose.yml
docker compose config >/dev/null
docker compose up -d --no-deps --force-recreate --pull never nginx-proxy-manager
```

Stop after rollback and diagnose NPM before continuing.

---

### Task 6: Establish private DNS, DNS-01 certificate, and FRIDAY proxy host

**Files:** live AdGuard, Cloudflare, NPM only.

**Interfaces:**
- Consumes: NPM on 443 and still-open VM102 backend.
- Produces: trusted HTTPS through NPM before direct backend is restricted.

- [ ] **Step 1: Verify/create AdGuard rewrite and upstream DNS**

Ensure in AdGuard:

```text
friday.mytechtactics.com -> 192.168.1.124
```

Then:

```bash
dig @192.168.1.124 friday.mytechtactics.com +short
dig @192.168.1.124 cloudflare.com +short | head
```

Expected: first command returns exactly `192.168.1.124`; second returns public address(es).

- [ ] **Step 2: Verify public DNS is not exposing the private FRIDAY destination**

```bash
dig @1.1.1.1 friday.mytechtactics.com +short
```

Expected: no `192.168.1.124`. If any public FRIDAY A/AAAA/CNAME exists, stop and review it.

- [ ] **Step 3: Create a dedicated Cloudflare token in the Cloudflare UI**

Use exactly:

```text
Permissions:
  Zone / DNS / Edit
  Zone / Zone / Read
Zone Resources:
  Include / Specific zone / mytechtactics.com
```

Do not put the token in a shell or repo.

- [ ] **Step 4: Request certificate in NPM**

```text
SSL Certificates -> Add SSL Certificate -> Let's Encrypt
Domain: friday.mytechtactics.com
DNS Challenge: enabled
Provider: Cloudflare
Credentials: dns_cloudflare_api_token = <enter only in NPM secret field>
```

Expected: valid certificate for `friday.mytechtactics.com`.

- [ ] **Step 5: Create NPM proxy host**

```text
Domain: friday.mytechtactics.com
Scheme: http
Forward host: 192.168.1.64
Forward port: 3010
Websockets: enabled
Certificate: friday.mytechtactics.com
Force SSL: enabled
HTTP/2: enabled when offered
HSTS: disabled for this rollout
```

- [ ] **Step 6: Validate HTTPS and redirect before firewalling**

```bash
curl --resolve friday.mytechtactics.com:443:192.168.1.124 -fsS https://friday.mytechtactics.com/healthz
curl --resolve friday.mytechtactics.com:443:192.168.1.124 -fsS https://friday.mytechtactics.com/api/health
curl --resolve friday.mytechtactics.com:443:192.168.1.124 -fsS https://friday.mytechtactics.com/api/overview >/dev/null
curl --resolve friday.mytechtactics.com:80:192.168.1.124 -sSI http://friday.mytechtactics.com/ | head -10
```

Expected: API calls succeed; HTTP redirects to HTTPS.

---

### Task 7: Enforce VM102 UFW + Docker-aware backend restriction

**Files:** install reviewed `ops/friday-backend-guard.sh` and `.service` on VM102.

**Interfaces:**
- Produces: VM100 -> TCP/3010 PASS; other remote sources -> TCP/3010 DROP; NPM HTTPS still PASS.

- [ ] **Step 1: Fetch exact reviewed branch without switching production FRIDAY off main**

```bash
cd /srv/infrastructure/apps/friday
git status --short
git fetch origin feature/https-private-routing-20260821
```

If `git status --short` is nonempty, stop.

- [ ] **Step 2: Install exact reviewed helper/unit**

```bash
git show origin/feature/https-private-routing-20260821:ops/friday-backend-guard.sh | sudo tee /usr/local/sbin/friday-backend-guard >/dev/null
git show origin/feature/https-private-routing-20260821:ops/friday-backend-guard.service | sudo tee /etc/systemd/system/friday-backend-guard.service >/dev/null
sudo chmod 0755 /usr/local/sbin/friday-backend-guard
sudo chmod 0644 /etc/systemd/system/friday-backend-guard.service
sudo sh -n /usr/local/sbin/friday-backend-guard
```

- [ ] **Step 3: Record whether UFW was already active and inspect listeners**

```bash
sudo install -d -m 0750 /var/lib/friday-backend-guard
sudo sh -c "ufw status | awk '/^Status:/ {print \$2}' > /var/lib/friday-backend-guard/ufw-before-state"
sudo ss -lntH
cat /var/lib/friday-backend-guard/ufw-before-state
```

If an unexpected externally-bound VM102 service exists beyond SSH/FRIDAY, stop before default-deny.

- [ ] **Step 4: Establish UFW host policy while preserving SSH**

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp comment 'VM102 SSH'
sudo ufw allow from 192.168.1.124 to any port 3010 proto tcp comment 'NPM to FRIDAY backend'
sudo ufw --force enable
sudo ufw status verbose
```

- [ ] **Step 5: Enable Docker-aware guard**

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now friday-backend-guard.service
sudo /usr/local/sbin/friday-backend-guard check
sudo iptables -S DOCKER-USER | grep 'friday-backend-guard'
```

Expected: allow rule is listed before drop rule.

- [ ] **Step 6: Validate allowed path from VM100**

On VM100:

```bash
curl -fsS --connect-timeout 3 http://192.168.1.64:3010/healthz
```

Expected: FRIDAY health JSON.

- [ ] **Step 7: Validate denied path and HTTPS path from a non-VM100 LAN client**

```bash
curl --connect-timeout 3 -v http://192.168.1.64:3010/healthz
curl --resolve friday.mytechtactics.com:443:192.168.1.124 -fsS https://friday.mytechtactics.com/healthz
```

Expected: first fails; second succeeds.

- [ ] **Step 8: Verify FRIDAY authority flags unchanged**

On VM102:

```bash
cd /srv/infrastructure/apps/friday
docker compose ps
make health
grep -E '^(FRIDAY_DOCKER_ENABLED|FRIDAY_VM100_OBSERVER_ENABLED|FRIDAY_MONITORING_ENABLED|FRIDAY_DIAGNOSTICS_ENABLED)=' .env
```

Expected:

```text
FRIDAY_DOCKER_ENABLED=false
FRIDAY_VM100_OBSERVER_ENABLED=true
FRIDAY_MONITORING_ENABLED=true
FRIDAY_DIAGNOSTICS_ENABLED=true
```

- [ ] **Step 9: Component-local rollback if backend proxy fails**

```bash
sudo /usr/local/sbin/friday-backend-guard remove
sudo systemctl disable --now friday-backend-guard.service
if [ "$(cat /var/lib/friday-backend-guard/ufw-before-state)" = inactive ]; then
  sudo ufw disable
fi
```

Stop and diagnose; do not weaken NPM/AdGuard.

---

### Task 8: Make AdGuard the LAN DHCP DNS source in stages

**Files:** live AdGuard + Omada DHCP only.

**Interfaces:**
- Produces: LAN clients resolve FRIDAY through AdGuard; rollback DNS is `192.168.1.254`.

- [ ] **Step 1: Use VM102 as a temporary system-resolver test client**

```bash
IFACE=$(ip route show default | awk '{print $5; exit}')
resolvectl status "$IFACE"
sudo resolvectl dns "$IFACE" 192.168.1.124
sudo resolvectl domain "$IFACE" '~.'
resolvectl flush-caches
resolvectl query friday.mytechtactics.com
resolvectl query cloudflare.com
curl -fsS https://friday.mytechtactics.com/healthz
```

Expected: FRIDAY resolves to `192.168.1.124`, ordinary DNS and HTTPS succeed.

- [ ] **Step 2: Revert temporary VM102 resolver override**

```bash
sudo resolvectl revert "$IFACE"
resolvectl flush-caches
```

- [ ] **Step 3: Change only Omada LAN DHCP DNS**

In the active `192.168.1.0/24` LAN/DHCP network set:

```text
Primary DNS: 192.168.1.124
Secondary DNS: blank
```

Do not change VLAN, gateway, mask, DHCP pool, or routes. Do not add a public secondary resolver.

- [ ] **Step 4: Renew one Windows 11 LAN test client**

```powershell
ipconfig /release
ipconfig /renew
ipconfig /flushdns
ipconfig /all | findstr /C:"DNS Servers"
nslookup friday.mytechtactics.com
curl.exe -fsS https://friday.mytechtactics.com/healthz
nslookup cloudflare.com
```

Expected: DNS includes `192.168.1.124`; FRIDAY resolves to VM100; public DNS and HTTPS work.

- [ ] **Step 5: Roll back only DHCP DNS if validation fails**

Restore Omada DHCP DNS to:

```text
192.168.1.254
```

Renew the test client and stop for DNS diagnosis.

---

### Task 9: Add Twingate private access

**Files:** live Twingate only.

**Interfaces:**
- Produces: authorized remote users get FRIDAY TCP/443; only admin users get NPM TCP/81; no VM102:3010 Resource exists.

- [ ] **Step 1: Verify Connector-side DNS**

On the Twingate Connector host:

```bash
getent hosts friday.mytechtactics.com
```

Expected: includes `192.168.1.124`. If not, stop and correct Connector-side LAN DNS adoption; do not add a public FRIDAY DNS fallback.

- [ ] **Step 2: Create FRIDAY FQDN Resource**

```text
Name: FRIDAY Control Plane
Address: friday.mytechtactics.com
Port: TCP 443 only
Access: intended FRIDAY users/groups only
```

- [ ] **Step 3: Create separate NPM admin Resource**

```text
Name: NPM Admin
Address: 192.168.1.124
Port: TCP 81 only
Access: Owner/admin group only
```

Do not create a Resource for `192.168.1.64:3010`.

- [ ] **Step 4: Validate from remote Twingate client**

```bash
curl -fsS https://friday.mytechtactics.com/healthz
curl --connect-timeout 3 -v http://192.168.1.64:3010/healthz
```

Expected: HTTPS succeeds with trusted certificate; direct 3010 fails.

- [ ] **Step 5: Validate NPM admin separately**

From an authorized admin identity open:

```text
http://192.168.1.124:81
```

Expected: NPM loads. Do not assign this Resource to normal FRIDAY users.

---

### Task 10: Final regression, docs, exact-head verification, and merge gate

**Files:**
- Modify `docs/codex/BUILD_STATUS.md`
- Modify `docs/codex/NEXT_STEPS.md`

**Interfaces:**
- Produces: source-of-truth records Spec 1 as production validated and makes Owner authentication + Supabase/PostgreSQL the next milestone.

- [ ] **Step 1: Run LAN HTTPS regression**

```bash
curl -fsS https://friday.mytechtactics.com/healthz
curl -fsS https://friday.mytechtactics.com/api/health
curl -fsS https://friday.mytechtactics.com/api/overview >/dev/null
curl -fsS https://friday.mytechtactics.com/api/incidents >/dev/null
```

Expected: all exit 0.

- [ ] **Step 2: Validate diagnostic-rerun transport only when an applicable open incident exists**

```bash
INCIDENT_ID=$(curl -fsS https://friday.mytechtactics.com/api/incidents \
  | jq -r '.incidents[] | select(.serviceName=="nginx-proxy-manager" and .status=="open") | .id' \
  | head -n1)
if [ -n "$INCIDENT_ID" ]; then
  curl -fsS -X POST "https://friday.mytechtactics.com/api/incidents/$INCIDENT_ID/diagnostics/rerun" \
    | jq '{status, findings, likelyCauses, lastLogInspectionAt}'
else
  echo 'No open NPM incident; diagnostic rerun transport is not applicable.'
fi
```

This POST mutates only FRIDAY-owned diagnostic/audit state; it must not restart NPM or any infrastructure service.

- [ ] **Step 3: Record acceptance matrix**

```text
LAN -> friday.mytechtactics.com:443                  PASS
Twingate -> friday.mytechtactics.com:443             PASS
VM100 -> 192.168.1.64:3010                           PASS
ordinary LAN -> 192.168.1.64:3010                    FAIL as designed
Twingate -> 192.168.1.64:3010                        FAIL as designed
LAN/admin Twingate -> 192.168.1.124:81               PASS when authorized
public Internet -> NPM TCP/81                         NOT EXPOSED
public Internet -> VM102 TCP/3010                     NOT EXPOSED
```

- [ ] **Step 4: Update BUILD_STATUS**

Add:

```markdown
## HTTPS + Private Routing Foundation — production validated

- Canonical FRIDAY URL: `https://friday.mytechtactics.com`.
- NPM on VM100 `192.168.1.124` is the private HTTPS gateway on TCP/80, TCP/81, TCP/443.
- AdGuard resolves the FRIDAY FQDN privately to VM100 and is the LAN DHCP DNS resolver.
- Cloudflare is DNS-01 only; FRIDAY is not publicly proxied.
- NPM forwards FRIDAY to VM102 `192.168.1.64:3010`.
- VM102 uses UFW plus the root-only `DOCKER-USER` backend guard; VM100 is the only permitted remote source to TCP/3010.
- Twingate provides FRIDAY TCP/443 plus a separate admin-only NPM TCP/81 Resource.
- FRIDAY application authority remains unchanged: no infrastructure start/stop/restart/delete/update endpoint exists.
```

Remove/replace stale statements claiming NPM is offline or direct 3010 is the canonical user path.

- [ ] **Step 5: Update NEXT_STEPS**

Make the next major milestones exactly:

```markdown
1. Owner authentication backed by Supabase/PostgreSQL on VM100.
2. SSH-activated single-use break-glass Owner access on VM102.
3. Approval-gated restart of one existing VM100 Docker container only after authentication, approval, and durable audit are production-validated.
```

- [ ] **Step 6: Run final repository verification**

```bash
make verify
```

Expected: PASS.

- [ ] **Step 7: Commit docs and push**

```bash
git add docs/codex/BUILD_STATUS.md docs/codex/NEXT_STEPS.md
git commit -m "docs: record private HTTPS production baseline"
git push
```

- [ ] **Step 8: Re-run exact-head CI and final review**

Use `superpowers:verification-before-completion` and `superpowers:requesting-code-review`. Require a fresh green Friday CI run for the new exact PR head SHA.

- [ ] **Step 9: STOP for explicit merge approval**

Present exact PR head SHA, exact-head CI, review result, NPM 80/81/443 evidence, AdGuard DNS evidence, LAN/Twingate HTTPS evidence, VM100->3010 allow evidence, ordinary-client 3010 deny evidence, and confirmation no public FRIDAY/NPM-admin forwarding was added.

- [ ] **Step 10: Merge only after approval, then verify main without unnecessary restarts**

After approved merge:

```bash
cd /srv/infrastructure/apps/friday
git checkout main
git pull --ff-only origin main
make health
sudo /usr/local/sbin/friday-backend-guard check
```

Expected: main is current, FRIDAY healthy, guard active. Do not restart NPM or FRIDAY merely because the PR merged.
