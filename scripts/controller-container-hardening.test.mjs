import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const load=name=>readFile(resolve(root,name),'utf8')

test('controller runtime uses dedicated non-root user and a pinned Node patch image',async()=>{
 const dockerfile=await load('Dockerfile')
 assert.match(dockerfile,/^FROM node:22\.\d+\.\d+-alpine3\.\d+ AS build$/m)
 assert.match(dockerfile,/^FROM node:22\.\d+\.\d+-alpine3\.\d+ AS runtime$/m)
 assert.match(dockerfile,/^USER 10001:10001$/m)
 assert.match(dockerfile,/^RUN .*\bchown\b.*\/data/m)
 assert.doesNotMatch(dockerfile,/^USER root$/m)
})
test('build dependencies are installed reproducibly with a lockfile and audited in CI',async()=>{
 const dockerfile=await load('Dockerfile')
 const workflow=await load('.github/workflows/ci.yml')
 const lock=JSON.parse(await load('package-lock.json'))
 const pkg=JSON.parse(await load('package.json'))
 assert.equal(lock.lockfileVersion,3)
 assert.equal(lock.packages[''].dependencies.vite,pkg.dependencies.vite)
 assert.equal(lock.packages[''].devDependencies.vitest,pkg.devDependencies.vitest)
 assert.match(dockerfile,/^COPY package\.json package-lock\.json \.\/$/m)
 assert.match(dockerfile,/^RUN npm ci --no-audit --no-fund$/m)
 assert.doesNotMatch(dockerfile,/npm install/)
 assert.match(workflow,/run: npm ci --no-audit --no-fund/)
 assert.match(workflow,/run: npm audit --audit-level=moderate/)
})
test('Compose controller is unprivileged with read-only root and bounded temporary writes',async()=>{
 const compose=await load('compose.yaml')
 const live=await load('compose.live.yaml')
 assert.match(compose,/^    user: ['"]?10001:10001['"]?$/m)
 assert.match(compose,/^    read_only: true$/m)
 assert.match(compose,/^    cap_drop:\s*\n      - ALL$/m)
 assert.match(compose,/^    pids_limit: 128$/m)
 assert.match(compose,/^    tmpfs:\s*\n      - \/tmp:.*noexec.*nosuid.*nodev.*uid=10001.*gid=10001/m)
 assert.match(compose,/^      - friday_data:\/data$/m)
 assert.doesNotMatch(live,/docker\.sock/)
})
