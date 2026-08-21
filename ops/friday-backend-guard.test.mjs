import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const script = fileURLToPath(new URL('./friday-backend-guard.sh', import.meta.url))
const service = fileURLToPath(new URL('./friday-backend-guard.service', import.meta.url))

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

test('systemd reapplies policy when Docker restarts and never removes it automatically', async () => {
  const text = await readFile(service, 'utf8')
  assert.match(text, /^After=docker\.service network-online\.target$/m)
  assert.match(text, /^Requires=docker\.service$/m)
  assert.match(text, /^PartOf=docker\.service$/m)
  assert.match(text, /^ExecStart=\/usr\/local\/sbin\/friday-backend-guard apply$/m)
  assert.doesNotMatch(text, /^ExecStop=/m)
})
