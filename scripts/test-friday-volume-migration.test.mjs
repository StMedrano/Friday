import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('volume migration rehearsal uses disposable volumes and a read-only source', async () => {
  const script = await readFile(resolve(root, 'scripts/test-friday-volume-migration.sh'), 'utf8')
  assert.match(script, /docker volume create/)
  assert.match(script, /friday-migration-fixture-source-/)
  assert.match(script, /friday-migration-fixture-target-/)
  assert.match(script, /source=\$source_volume,target=\/old,readonly/)
  assert.match(script, /source=\$target_volume,target=\/new/)
  assert.match(script, /chown -R 10001:10001 \/new/)
  assert.match(script, /docker volume rm/)
  assert.doesNotMatch(script, /docker volume prune|docker system prune|\bfriday_data\b|docker compose down/)
})
test('volume migration rehearsal is a mandatory CI check after image smoke test', async () => {
  const workflow = await readFile(resolve(root, '.github/workflows/ci.yml'), 'utf8')
  assert.match(workflow, /run: sh scripts\/test-friday-volume-migration\.sh friday-ci/)
})
