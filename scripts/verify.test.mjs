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
  const argsFile = join(root, 'curl-args')
  await import('node:fs/promises').then(({ mkdir }) => mkdir(bin))
  await writeFile(countFile, '0\n', 'utf8')

  await makeExecutable(join(bin, 'docker'), `#!/usr/bin/env sh
if [ "$1" = "compose" ] && [ "$2" = "config" ]; then exit 0; fi
if [ "$1" = "ps" ]; then echo friday; exit 0; fi
exit 0
`)

  await makeExecutable(join(bin, 'sleep'), '#!/usr/bin/env sh\nexit 0\n')

  const curlBody = curlMode === 'fail-once'
    ? `count=$(cat "$VERIFY_CURL_COUNT_FILE"); count=$((count + 1)); printf '%s\\n' "$count" > "$VERIFY_CURL_COUNT_FILE"; if [ "$count" -eq 1 ]; then exit 56; fi; exit 0`
    : `count=$(cat "$VERIFY_CURL_COUNT_FILE"); count=$((count + 1)); printf '%s\\n' "$count" > "$VERIFY_CURL_COUNT_FILE"; exit 56`
  await makeExecutable(join(bin, 'curl'), `#!/usr/bin/env sh\nprintf '%s\\n' \"$*\" >> \"$VERIFY_CURL_ARGS_FILE\"\n${curlBody}\n`)

  const result = spawnSync('sh', ['scripts/verify.sh'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      VERIFY_CURL_COUNT_FILE: countFile,
      VERIFY_CURL_ARGS_FILE: argsFile,
    },
    encoding: 'utf8',
  })
  const count = Number((await readFile(countFile, 'utf8')).trim())
  const calls = (await readFile(argsFile, 'utf8')).trim().split('\n')
  await rm(root, { recursive: true, force: true })
  return { result, count, calls }
}

test('verify retries a transient HTTP startup failure and succeeds once endpoints become available', async () => {
  const { result, count } = await runVerify({ curlMode: 'fail-once' })
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  assert.ok(count >= 4, `expected retry plus all endpoint checks, got ${count} curl calls`)
})

test('verify retries repeated HTTP startup failures before returning failure', async () => {
  const { result, count } = await runVerify({ curlMode: 'always-fail' })
  assert.notEqual(result.status, 0)
  assert.equal(count, 16, 'stop after the bounded retry count')
})

test('verify bounds every HTTP request, including health and overview checks after recovery', async () => {
  const { result, calls } = await runVerify({ curlMode: 'fail-once' })
  assert.equal(result.status, 0)
  assert.equal(calls.length, 4)
  for (const call of calls) {
    assert.match(call, /(?:^| )--max-time 5(?: |$)/)
  }
  assert.deepEqual(calls.map((call) => new URL(call.split(' ').at(-1)).pathname), [
    '/healthz', '/healthz', '/api/health', '/api/overview',
  ])
})
