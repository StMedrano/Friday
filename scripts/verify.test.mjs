import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

async function makeExecutable(path, content) {
  await writeFile(path, content, 'utf8')
  await chmod(path, 0o755)
}

async function runVerify({ curlMode }) {
  const root = await mkdtemp(join(tmpdir(), 'friday-verify-test-'))
  const bin = join(root, 'bin')
  const countFile = join(root, 'curl-count')
  await import('node:fs/promises').then(({ mkdir }) => mkdir(bin))
  await writeFile(countFile, '0\n', 'utf8')

  await makeExecutable(join(bin, 'docker'), `#!/usr/bin/env sh
if [ "$1" = "compose" ] && [ "$2" = "config" ]; then exit 0; fi
if [ "$1" = "ps" ]; then echo friday; exit 0; fi
exit 0
`)

  await makeExecutable(join(bin, 'sleep'), '#!/usr/bin/env sh\nexit 0\n')

  await makeExecutable(join(bin, 'curl'), `#!/usr/bin/env sh
count=$(cat "$VERIFY_CURL_COUNT_FILE")
count=$((count + 1))
printf '%s\\n' "$count" > "$VERIFY_CURL_COUNT_FILE"
url=""
for value in "$@"; do url="$value"; done
case "$VERIFY_CURL_MODE" in
  fail-once)
    if [ "$count" -eq 1 ]; then exit 56; fi
    printf '200'
    ;;
  always-fail)
    exit 56
    ;;
  protected-overview)
    case "$url" in */api/overview) printf '403';; *) printf '200';; esac
    ;;
  unavailable-overview)
    case "$url" in */api/overview) printf '503';; *) printf '200';; esac
    ;;
esac
`)

  const result = spawnSync('sh', ['scripts/verify.sh'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      VERIFY_CURL_COUNT_FILE: countFile,
      VERIFY_CURL_MODE: curlMode,
    },
    encoding: 'utf8',
  })
  const count = Number((await readFile(countFile, 'utf8')).trim())
  await rm(root, { recursive: true, force: true })
  return { result, count }
}

test('verify retries a transient HTTP startup failure and succeeds once endpoints become available', async () => {
  const { result, count } = await runVerify({ curlMode: 'fail-once' })
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  assert.ok(count >= 4, `expected retry plus all endpoint checks, got ${count} curl calls`)
})

test('verify retries repeated HTTP startup failures before returning failure', async () => {
  const { result, count } = await runVerify({ curlMode: 'always-fail' })
  assert.notEqual(result.status, 0)
  assert.ok(count > 1, `expected more than one curl attempt, got ${count}`)
})

test('verify accepts deliberate Access denial from the protected overview', async () => {
  const { result, count } = await runVerify({ curlMode: 'protected-overview' })
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  assert.equal(count, 3)
})

test('verify rejects an unavailable Access verifier', async () => {
  const { result } = await runVerify({ curlMode: 'unavailable-overview' })
  assert.notEqual(result.status, 0)
})
