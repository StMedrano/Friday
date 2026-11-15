import test from 'node:test'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {chmod, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'

const script = fileURLToPath(new URL('./prepare-observer-redeploy.sh', import.meta.url))
const token = 'a'.repeat(64)

function run(args) {
  return new Promise(resolve => execFile('sh', [script, '--no-docker', ...args], (error, stdout, stderr) =>
    resolve({code: error ? error.code : 0, stdout, stderr})))
}

async function fixture(t, envText, mode = 0o600) {
  const root = await mkdtemp(join(tmpdir(), 'friday-observer-prep-'))
  const socket = join(root, 'docker.sock')
  const server = createServer().listen(socket)
  t.after(async () => { server.close(); await rm(root, {recursive: true, force: true}) })
  const env = join(root, '.env')
  await writeFile(env, envText)
  await chmod(env, mode)
  const gid = (await stat(socket)).gid
  return {env, socket, gid}
}

test('refuses a loose .env or a bad token and never prints the token', async t => {
  const loose = await fixture(t, `FRIDAY_OBSERVER_TOKEN=${token}\n`, 0o644)
  const a = await run(['--env', loose.env, '--socket', loose.socket])
  assert.notEqual(a.code, 0)
  assert.match(a.stderr, /mode 644/)
  const bad = await fixture(t, 'FRIDAY_OBSERVER_TOKEN=short\n')
  const b = await run(['--env', bad.env, '--socket', bad.socket])
  assert.notEqual(b.code, 0)
  assert.match(b.stderr, /64 hex/)
  assert.ok(!(a.stdout + a.stderr + b.stdout + b.stderr).includes(token))
})

test('reports a missing socket group id and writes it only with --write-gid', async t => {
  const f = await fixture(t, `FRIDAY_OBSERVER_TOKEN=${token}\nFRIDAY_DOCKER_SOCKET_GID=`)
  const dry = await run(['--env', f.env, '--socket', f.socket])
  assert.notEqual(dry.code, 0)
  assert.match(dry.stderr, /--write-gid/)
  assert.ok(!(await readFile(f.env, 'utf8')).includes(`GID=${f.gid}`))
  const write = await run(['--env', f.env, '--socket', f.socket, '--write-gid'])
  assert.equal(write.code, 0, write.stderr)
  const text = await readFile(f.env, 'utf8')
  assert.match(text, new RegExp(`^FRIDAY_DOCKER_SOCKET_GID=${f.gid}$`, 'm'))
  assert.equal((await stat(f.env)).mode & 0o777, 0o600)
  assert.ok(!write.stdout.includes(token))
  // Idempotent: a second run only confirms.
  const again = await run(['--env', f.env, '--socket', f.socket])
  assert.equal(again.code, 0)
  assert.match(again.stdout, /matches/)
})

test('appends on a new line when .env lacks a trailing newline, and refuses a mismatched id', async t => {
  const f = await fixture(t, `FRIDAY_OBSERVER_TOKEN=${token}`)
  assert.equal((await run(['--env', f.env, '--socket', f.socket, '--write-gid'])).code, 0)
  assert.equal(await readFile(f.env, 'utf8'), `FRIDAY_OBSERVER_TOKEN=${token}\nFRIDAY_DOCKER_SOCKET_GID=${f.gid}\n`)
  const wrong = await fixture(t, `FRIDAY_OBSERVER_TOKEN=${token}\nFRIDAY_DOCKER_SOCKET_GID=${f.gid + 1}\n`)
  const result = await run(['--env', wrong.env, '--socket', wrong.socket, '--write-gid'])
  assert.notEqual(result.code, 0)
  assert.match(result.stderr, /fix .env by hand/)
})

test('never starts, stops, restarts or builds containers', async () => {
  const text = await readFile(script, 'utf8')
  const code = text.split('\n').filter(line => !line.trim().startsWith('#') && !line.includes("echo '")).join('\n')
  assert.doesNotMatch(code, /compose (up|down|restart|build|stop)|docker (restart|stop|start|run|rm|kill|build)|prune/)
})
