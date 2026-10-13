import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {dirname,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
test('live controller Compose cannot mount the raw Docker socket or enable Docker discovery',async()=>{
  const live=await readFile(resolve(root,'compose.live.yaml'),'utf8')
  const base=await readFile(resolve(root,'compose.yaml'),'utf8')
  assert.doesNotMatch(live,/\/var\/run\/docker\.sock|\/run\/docker\.sock/)
  assert.match(live,/FRIDAY_DOCKER_ENABLED:\s*false\s*$/m)
  assert.doesNotMatch(base,/\/var\/run\/docker\.sock\s*:/)
})

test('candidate live Compose requires Cloudflare Access identity verification',async()=>{
 const live=await readFile(resolve(root,'compose.live.yaml'),'utf8')
 assert.match(live,/FRIDAY_CF_ACCESS_ENABLED:\s*['"]?true['"]?\s*$/m)
})
