import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const load = (name) => readFile(resolve(root, name), 'utf8')

test('controller stages use a patch-pinned Node/Alpine image and lockfile installs', async () => {
  const dockerfile = await load('Dockerfile')
  for (const stage of ['build', 'runtime-deps', 'runtime-base']) {
    assert.match(dockerfile, new RegExp(`^FROM node:22\\.\\d+\\.\\d+-alpine3\\.\\d+ AS ${stage}$`, 'm'))
  }
  assert.match(dockerfile, /^COPY package\.json package-lock\.json \.\/$/m)
  assert.match(dockerfile, /^RUN npm ci --no-audit --no-fund$/m)
  assert.match(dockerfile, /^RUN npm ci --omit=dev --no-audit --no-fund/m)
  assert.doesNotMatch(dockerfile, /npm install/)
})

test('runtime keeps web-push dependencies but drops the npm and Yarn toolchain', async () => {
  const dockerfile = await load('Dockerfile')
  const runtime = dockerfile.split(/^FROM .* AS runtime-base$/m)[1].split(/^FROM /m)[0]
  assert.ok(runtime, 'runtime stage present')
  assert.match(runtime, /COPY --from=runtime-deps \/app\/node_modules \.\/node_modules/)
  assert.match(runtime, /apk upgrade --no-cache/)
  assert.match(runtime, /rm -rf \/usr\/local\/lib\/node_modules/)
  assert.match(runtime, /rm -f \/usr\/local\/bin\/npm \/usr\/local\/bin\/npx/)
  assert.doesNotMatch(runtime, /^RUN npm /m)
})

test('live override never mounts the Docker socket into the controller', async () => {
  assert.doesNotMatch(await load('compose.live.yaml'), /docker\.sock/)
})

test('the non-root candidate runs as UID 10001 and the default image stays root until the data migration', async () => {
  const dockerfile = await load('Dockerfile')
  const stages = dockerfile.split(/^(?=FROM )/m)
  const nonroot = stages.find((stage) => /^FROM runtime-base AS runtime-nonroot$/m.test(stage))
  assert.ok(nonroot, 'runtime-nonroot stage present')
  assert.match(nonroot, /^USER 10001:10001$/m)
  assert.match(nonroot, /chown 10001:10001 \/data/)
  const last = stages.at(-1)
  assert.match(last, /^FROM runtime-base AS runtime\s*$/m, 'default stage stays last')
  assert.doesNotMatch(last, /^USER /m)
  for (const file of ['compose.yaml', 'compose.live.yaml']) assert.doesNotMatch(await load(file), /runtime-nonroot/)
})

test('CI scans the controller, observer and proxy images', async () => {
  const workflow = await load('.github/workflows/ci.yml')
  for (const image of ['friday-ci', 'friday-observer-ci', 'friday-docker-proxy-ci']) {
    assert.match(workflow, new RegExp(`sh scripts/scan-controller-image\\.sh ${image}$`, 'm'))
  }
})
