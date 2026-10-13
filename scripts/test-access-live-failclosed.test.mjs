import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
test('CI tests the real image in live mode and denies missing Access config without production access',async()=>{
 const script=await readFile(resolve(root,'scripts/test-access-live-failclosed.sh'),'utf8')
 const ci=await readFile(resolve(root,'.github/workflows/ci.yml'),'utf8')
 assert.match(script,/--network none/)
 assert.match(script,/FRIDAY_MODE=live/)
 assert.match(script,/FRIDAY_CF_ACCESS_ENABLED=false/)
 assert.match(script,/expected 503/)
 assert.match(script,/\/api\/overview/)
 assert.match(script,/\/api\/assistant/)
 assert.match(script,/\/healthz/)
 assert.doesNotMatch(script,/\bfriday_data\b|--publish|--privileged|docker compose down/)
 assert.match(ci,/run: sh scripts\/test-access-live-failclosed\.sh friday-ci/)
})
