import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getSanitizedContainerInspect,
  getSanitizedContainerLogs,
  normalizeLogTail,
  resolveKnownContainer,
  sanitizeContainerInspect,
  sanitizeLogText,
} from './docker.mjs'

const config = {
  dockerSocketPath: '/sock',
  hostName: 'VM 100',
  allowedLabelKeys: ['com.docker.compose.project', 'com.docker.compose.service'],
}

function rawInventory() {
  return [
    { Id: 'abcdef123456000000000000', Names: ['/nginx-proxy-manager'], Image: 'jc21/nginx-proxy-manager:latest', State: 'exited', Status: 'Exited (255)' },
    { Id: '999999999999000000000000', Names: ['/healthy'], Image: 'healthy:latest', State: 'running', Status: 'Up' },
  ]
}

function rawInspect() {
  return {
    Id: 'abcdef123456000000000000',
    Name: '/nginx-proxy-manager',
    Image: 'sha256:image123',
    RestartCount: 0,
    Config: {
      Image: 'jc21/nginx-proxy-manager:latest',
      Env: ['DB_PASSWORD=super-secret'],
      Cmd: ['start', '--token=secret'],
      Labels: {
        'com.docker.compose.project': 'npm',
        'com.docker.compose.service': 'app',
        private: 'do-not-forward',
      },
    },
    State: {
      Status: 'exited',
      ExitCode: 255,
      OOMKilled: false,
      StartedAt: '2026-08-17T00:00:00.000Z',
      FinishedAt: '2026-08-17T00:00:02.000Z',
      Health: {
        Status: 'unhealthy',
        Log: [
          { Start: 'a', End: 'b', ExitCode: 1, Output: 'password=hidden' },
          { Start: 'c', End: 'd', ExitCode: 2, Output: 'Bearer hidden-token' },
          { Start: 'e', End: 'f', ExitCode: 3, Output: 'third' },
          { Start: 'g', End: 'h', ExitCode: 4, Output: 'fourth' },
        ],
      },
    },
    HostConfig: {
      RestartPolicy: { Name: 'unless-stopped', MaximumRetryCount: 0 },
      Binds: ['/secret/host/path:/config'],
    },
    NetworkSettings: {
      Ports: {
        '80/tcp': [{ HostIp: '0.0.0.0', HostPort: '8080' }],
        '443/tcp': null,
      },
      Networks: { frontend: {}, backend: {} },
    },
  }
}

test('inspect sanitizer exposes only approved metadata', () => {
  const result = sanitizeContainerInspect(rawInspect(), {
    hostName: 'VM 100',
    observedAt: '2026-08-20T00:00:00.000Z',
  })

  assert.equal(result.id, 'abcdef123456')
  assert.equal(result.name, 'nginx-proxy-manager')
  assert.equal(result.image, 'jc21/nginx-proxy-manager:latest')
  assert.equal(result.imageId, 'sha256:image123')
  assert.equal(result.state, 'exited')
  assert.equal(result.exitCode, 255)
  assert.equal(result.oomKilled, false)
  assert.equal(result.restartCount, 0)
  assert.equal(result.compose.project, 'npm')
  assert.equal(result.compose.service, 'app')
  assert.deepEqual(result.networks, ['backend', 'frontend'])
  assert.deepEqual(result.ports, [
    { containerPort: '443', protocol: 'tcp', hostIp: '', hostPort: '' },
    { containerPort: '80', protocol: 'tcp', hostIp: '0.0.0.0', hostPort: '8080' },
  ])
  assert.equal(result.health.recent.length, 3)
  assert.equal(result.health.recent[0].exitCode, 2)
  assert.equal(result.health.recent[2].exitCode, 4)
  assert.equal('output' in result.health.recent[0], false)

  const serialized = JSON.stringify(result)
  for (const forbidden of ['super-secret', '/secret/host/path', '--token=secret', 'do-not-forward', 'hidden-token']) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} must not cross the observer boundary`)
  }
})

test('known container resolver accepts one unique sanitized prefix and rejects unknown invalid and ambiguous ids', async () => {
  const raw = rawInventory()
  const resolved = await resolveKnownContainer(config, 'abcdef123456', async () => raw)
  assert.equal(resolved.fullId, raw[0].Id)
  assert.equal(resolved.inventory.id, 'abcdef123456')
  await assert.rejects(() => resolveKnownContainer(config, '111111111111', async () => raw), /unknown container/i)
  await assert.rejects(() => resolveKnownContainer(config, '../bad', async () => raw), /invalid container id/i)
  const ambiguous = [
    { ...raw[0], Id: 'abcdef123456000000000001' },
    { ...raw[0], Id: 'abcdef123456000000000002' },
  ]
  await assert.rejects(() => resolveKnownContainer(config, 'abcdef123456', async () => ambiguous), /ambiguous container/i)
})

test('log tail defaults to 100 and caps at 200', () => {
  assert.equal(normalizeLogTail(undefined), 100)
  assert.equal(normalizeLogTail('100'), 100)
  assert.equal(normalizeLogTail('9999'), 200)
  assert.equal(normalizeLogTail('-4'), 100)
  assert.equal(normalizeLogTail('1.5'), 100)
})

test('log sanitizer redacts common credentials and caps output at 64 KiB', () => {
  const source = [
    'Authorization: Bearer abc.def.ghi',
    'password=hunter2',
    'api_key=sk-example-secret',
    'secret: topsecret',
    'Server=db;Password=database-secret;User Id=friday',
    'x'.repeat(80 * 1024),
  ].join('\n')
  const result = sanitizeLogText(source)
  assert.match(result.logs, /Bearer \[redacted\]/)
  assert.match(result.logs, /password=\[redacted\]/i)
  assert.match(result.logs, /api_key=\[redacted\]/i)
  assert.match(result.logs, /secret: \[redacted\]/i)
  assert.match(result.logs, /Password=\[redacted\]/i)
  assert.ok(Buffer.byteLength(result.logs, 'utf8') <= 64 * 1024)
  assert.equal(result.truncated, true)
  for (const forbidden of ['hunter2', 'sk-example-secret', 'topsecret', 'database-secret', 'abc.def.ghi']) {
    assert.equal(result.logs.includes(forbidden), false)
  }
})

test('sanitized inspect resolves inventory before using the full id', async () => {
  let requestedId = null
  const result = await getSanitizedContainerInspect(config, 'abcdef123456', {
    requestContainers: async () => rawInventory(),
    requestInspect: async (_socketPath, fullId) => {
      requestedId = fullId
      return rawInspect()
    },
    now: () => new Date('2026-08-20T00:00:00.000Z'),
  })
  assert.equal(requestedId, 'abcdef123456000000000000')
  assert.equal(result.exitCode, 255)
  assert.equal(result.observedAt, '2026-08-20T00:00:00.000Z')
})

test('sanitized logs resolve inventory, enforce bounded tail, redact, and report raw truncation', async () => {
  let request = null
  const raw = Buffer.from('password=hunter2\nsafe line\n', 'utf8')
  const result = await getSanitizedContainerLogs(config, 'abcdef123456', 9999, {
    requestContainers: async () => rawInventory(),
    requestLogs: async (_socketPath, fullId, tail) => {
      request = { fullId, tail }
      return { buffer: raw, truncated: true }
    },
    now: () => new Date('2026-08-20T00:00:00.000Z'),
  })
  assert.deepEqual(request, { fullId: 'abcdef123456000000000000', tail: 200 })
  assert.equal(result.tail, 200)
  assert.equal(result.truncated, true)
  assert.equal(result.logs.includes('hunter2'), false)
  assert.match(result.logs, /password=\[redacted\]/i)
  assert.equal(result.observedAt, '2026-08-20T00:00:00.000Z')
})
