import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

test('normal controller updates preserve private reader TLS trust and refuse a missing certificate', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'friday-update-tls-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  for (const path of ['.git', 'bin', 'scripts']) await mkdir(join(dir, path))
  for (const name of ['preflight-controller.sh', 'verify.sh']) await writeFile(join(dir, 'scripts', name), 'exit 0\n')
  await writeFile(join(dir, 'bin/git'), '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  await writeFile(join(dir, 'bin/docker'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALLS"\n', { mode: 0o700 })
  const cert = join(dir, 'reader.pem')
  await writeFile(cert, 'public test certificate')
  await writeFile(join(dir, '.env'), `FRIDAY_MODE=live\nFRIDAY_DOCKER_ENABLED=false\nFRIDAY_WEB_GROWTH_READER_CA_FILE=${cert}\n`)
  const env = { ...process.env, PATH: join(dir, 'bin') + ':' + process.env.PATH, FRIDAY_APP_DIR: dir, CALLS: join(dir, 'calls') }
  const script = new URL('./update-controller.sh', import.meta.url).pathname
  const result = spawnSync('sh', [script], { env, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(await readFile(env.CALLS, 'utf8'), /compose -f compose.yaml -f compose.web-growth-tls.yaml up -d --build/)
  await rm(cert)
  assert.notEqual(spawnSync('sh', [script], { env }).status, 0)
})
