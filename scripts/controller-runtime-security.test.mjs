import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
test('final image strips Node base-image npm and npx vulnerable global tooling',async()=>{
 const dockerfile=await readFile(resolve(root,'Dockerfile'),'utf8')
 assert.match(dockerfile,/rm -rf \/usr\/local\/lib\/node_modules\b/)
 assert.match(dockerfile,/rm -f \/usr\/local\/bin\/npm \/usr\/local\/bin\/npx \/usr\/local\/bin\/corepack\b/)
 assert.match(dockerfile,/rm -rf \/opt\/yarn-v1\.22\.22\b/)
})
test('CI scans exact built image through a tar with no scanner Docker daemon socket',async()=>{
 const workflow=await readFile(resolve(root,'.github/workflows/ci.yml'),'utf8')
 const script=await readFile(resolve(root,'scripts/scan-controller-image.sh'),'utf8').catch(()=> '')
 assert.match(workflow,/sh scripts\/scan-controller-image\.sh friday-ci/)
 assert.match(script,/docker save /)
 assert.match(script,/--input \/scan\/controller\.tar/)
 assert.match(script,/TMPDIR=\/cache\/tmp/)
 assert.doesNotMatch(script,/--tmpfs \/tmp/)
 assert.match(script,/--severity HIGH,CRITICAL/)
 assert.match(script,/--exit-code 1/)
 assert.doesNotMatch(script,/docker\.sock/)
})
