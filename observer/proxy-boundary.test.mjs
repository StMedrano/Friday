import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
const path=fileURLToPath(new URL('./compose.yaml',import.meta.url))

test('observer receives restricted UNIX socket only; Docker socket is sidecar-only',async()=>{
 const compose=await readFile(path,'utf8')
 const [before,after]=compose.split(/^  friday-observer:\s*$/m)
 assert.ok(before&&after,'two separate sidecar/observer services')
 assert.match(before,/^  friday-docker-readonly:$/m)
 assert.match(before,/network_mode: none/)
 assert.match(before,/FRIDAY_DOCKER_SOCKET_GID:\?/)
 assert.match(before,/\/var\/run\/docker\.sock:\/var\/run\/docker\.sock:ro/)
 assert.match(after,/FRIDAY_OBSERVER_DOCKER_SOCKET: \/proxy\/docker\.sock/)
 assert.doesNotMatch(after,/\/var\/run\/docker\.sock/)
 assert.match(after,/friday_docker_proxy_socket:\/proxy:ro/)
 assert.match(after,/user: "10001:10001"/)
 assert.match(after,/cap_drop:\s*\n\s+- ALL/)
 assert.match(after,/read_only: true/)
})

test('observer and sidecar use patch-pinned minimal rootless runtime images',async()=>{
 const observer=await readFile(new URL('./Dockerfile',import.meta.url),'utf8')
 const proxy=await readFile(new URL('./Dockerfile.proxy',import.meta.url),'utf8')
 for(const file of [observer,proxy]){
  assert.match(file,/FROM node:22\.\d+\.\d+-alpine3\.\d+/)
  assert.match(file,/USER 10001:10001/)
  assert.match(file,/apk upgrade --no-cache/)
  assert.match(file,/rm -rf \/usr\/local\/lib\/node_modules/)
 }
})
