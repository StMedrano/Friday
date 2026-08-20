import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

async function writeExecutable(path, content) {
  await writeFile(path, content, 'utf8')
  await chmod(path, 0o755)
}

async function makeFakeBin({ curlScript }) {
  const root = await mkdtemp(join(tmpdir(), 'friday-verify-'))
  const bin = join(root, 'bin')
  const state = join(root, 'curl-count')
  spawnSync('mkdir', ['-p', bin])

  await writeExecutable(join(bin, 'docker'), `#!/bin/sh\nif [ "$1 $2" = "compose config" ]; then exit 0; fi\nif [ "$1" = "ps" ]; then echo friday; exit 0; fi\nexit 0\n`)
  await writeExecutable(join(bin, 'curl'), curlScript)
  await writeExecutable(join(bin, 'sleep'), '#!/bin/sh\nexit 0\n')
  return { bin, state }
}

function runVerify({ bin, state, attempts = '3', delay = '0' }) {
  return spawnSync('sh', ['scripts/verify.sh'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      CURL_STATE: state,
      FRIDAY_HEALTH_ATTEMPTS: attempts,
      FRIDAY_HEALTH_RETRY_SECONDS: delay,
    },
  })
}

test('verify retries transient HTTP failures and succeeds within the bounded window', async () => {
  const { bin, state } = await makeFakeBin({
    curlScript: '#!/bin/sh\ncount=0\n[ -f "$CURL_STATE" ] && count=$(cat "$CURL_STATE")\ncount=$((count + 1))\necho "$count" > "$CURL_STATE"\n[ "$count" -le 2 ] && exit 56\nexit 0\n',
  })

  const result = runVerify({ bin, state })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, /Friday health and overview endpoints: ok/)
  assert.ok(Number(await readFile(state, 'utf8')) >= 5)
})

test('verify fails after the configured bounded retry count when HTTP never becomes healthy', async () => {
  const { bin, state } = await makeFakeBin({
    curlScript: '#!/bin/sh\ncount=0\n[ -f "$CURL_STATE" ] && count=$(cat "$CURL_STATE")\ncount=$((count + 1))\necho "$count" > "$CURL_STATE"\nexit 56\n',
  })

  const result = runVerify({ bin, state })
  assert.notEqual(result.status, 0)
  assert.equal(Number(await readFile(state, 'utf8')), 3)
  assert.match(`${result.stdout}\n${result.stderr}`, /health checks failed/i)
})
