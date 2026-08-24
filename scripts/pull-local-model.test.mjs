import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('local model bootstrap uses the configured Friday instruct model through private Ollama compose service', async () => {
  const source = await readFile(new URL('./pull-local-model.sh', import.meta.url), 'utf8')
  assert.match(source, /FRIDAY_LOCAL_AI_MODEL/)
  assert.match(source, /qwen3:4b-instruct/)
  assert.match(source, /docker compose.*ollama.*pull/s)
})
