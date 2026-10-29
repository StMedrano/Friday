import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
const script=await readFile(new URL('./check-friday-volume-readiness.sh',import.meta.url),'utf8')
test('production data preflight inspects container/volume only and never mutates live data',()=>{
 assert.match(script,/docker volume inspect/)
 assert.match(script,/docker container inspect/)
 assert.match(script,/docker exec .* sh -c/)
 assert.match(script,/stat -c/)
 assert.doesNotMatch(script,/docker volume (rm|create|prune)|docker compose (up|down)|docker cp|\bchown\b.*-R|\bchmod\b.*[0-9]/)
 assert.doesNotMatch(script,/rsync |tar -c|cp -a |docker restart|docker stop|docker run/)
})
