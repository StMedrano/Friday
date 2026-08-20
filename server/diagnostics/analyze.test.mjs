import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDiagnosticReport } from './analyze.mjs'

function incident(overrides = {}) {
  return {
    id: 'npm-offline-1',
    type: 'service-offline',
    status: 'open',
    source: 'monitoring',
    host: 'VM 100',
    serviceId: 'vm100-observer-abcdef123456',
    serviceName: 'nginx-proxy-manager',
    firstSeen: '2026-08-20T00:00:00.000Z',
    openedAt: '2026-08-20T00:05:00.000Z',
    ...overrides,
  }
}

function inspect(overrides = {}) {
  return {
    id: 'abcdef123456',
    name: 'nginx-proxy-manager',
    host: 'VM 100',
    image: 'jc21/nginx-proxy-manager:latest',
    state: 'exited',
    exitCode: 255,
    oomKilled: false,
    restartCount: 0,
    startedAt: '2026-08-18T00:00:00.000Z',
    finishedAt: '2026-08-18T00:00:02.000Z',
    health: null,
    restartPolicy: { name: 'unless-stopped', maximumRetryCount: 0 },
    ports: [],
    compose: { project: 'npm', service: 'app' },
    networks: ['frontend'],
    observedAt: '2026-08-20T01:00:00.000Z',
    ...overrides,
  }
}

function overview(otherOnline = 2) {
  return {
    services: [
      { id: 'vm100-observer-abcdef123456', host: 'VM 100', status: 'offline' },
      ...Array.from({ length: otherOnline }, (_, index) => ({ id: `neighbor-${index}`, host: 'VM 100', status: 'online' })),
    ],
  }
}

test('non-zero exit becomes observed facts plus deterministic application failure and isolation findings', () => {
  const report = buildDiagnosticReport({
    incident: incident(),
    inspect: inspect(),
    overview: overview(2),
    now: '2026-08-20T01:00:00.000Z',
  })
  assert.equal(report.id, 'diagnostic-npm-offline-1')
  assert.equal(report.status, 'available')
  assert.equal(report.metadata.exitCode, 255)
  assert.ok(report.facts.some((fact) => fact.id === 'exit-code' && fact.value === '255'))
  assert.ok(report.facts.some((fact) => fact.id === 'oom-killed' && fact.value === 'No'))
  assert.ok(report.findings.includes('The container exited with an application/startup failure rather than an OOM termination.'))
  assert.ok(report.findings.includes('The failure appears isolated to this service rather than a host-wide Docker outage.'))
  assert.ok(report.likelyCauses.includes('Application or startup configuration failure is likely.'))
  assert.ok(report.recommendations.includes('Inspect recent sanitized application logs and recent configuration/deployment changes.'))
  assert.equal(report.logsAvailable, true)
  assert.equal(report.lastLogInspectionAt, null)
})

test('container that ran at least five minutes is classified as runtime application failure rather than startup failure', () => {
  const report = buildDiagnosticReport({
    incident: incident(),
    inspect: inspect({
      startedAt: '2026-08-10T17:35:51.097Z',
      finishedAt: '2026-08-17T12:10:16.128Z',
    }),
    overview: overview(2),
    now: '2026-08-20T01:00:00.000Z',
  })

  assert.ok(report.findings.includes('The container exited with a runtime/application failure rather than an OOM termination.'))
  assert.ok(report.likelyCauses.includes('A runtime application or dependency failure is likely.'))
  assert.equal(report.findings.some((value) => /startup failure/i.test(value)), false)
  assert.equal(report.likelyCauses.some((value) => /startup configuration failure/i.test(value)), false)
})

test('container that exits before five minutes retains startup configuration failure classification', () => {
  const report = buildDiagnosticReport({
    incident: incident(),
    inspect: inspect({
      startedAt: '2026-08-18T00:00:00.000Z',
      finishedAt: '2026-08-18T00:04:59.999Z',
    }),
    overview: overview(2),
    now: '2026-08-20T01:00:00.000Z',
  })

  assert.ok(report.findings.includes('The container exited with an application/startup failure rather than an OOM termination.'))
  assert.ok(report.likelyCauses.includes('Application or startup configuration failure is likely.'))
})

test('OOM termination is diagnosed from the explicit OOM flag', () => {
  const report = buildDiagnosticReport({
    incident: incident(),
    inspect: inspect({ exitCode: 137, oomKilled: true }),
    overview: overview(2),
    now: '2026-08-20T01:00:00.000Z',
  })
  assert.ok(report.findings.includes('The container was terminated by the kernel due to memory pressure.'))
  assert.ok(report.likelyCauses.includes('Memory pressure caused the container termination.'))
  assert.ok(report.recommendations.includes('Inspect host/container memory pressure and recent workload changes before considering remediation.'))
  assert.equal(report.findings.some((value) => /application\/startup failure/i.test(value)), false)
})

test('restart count of three reports historical restart evidence without claiming a timed crash loop', () => {
  const report = buildDiagnosticReport({
    incident: incident(),
    inspect: inspect({ restartCount: 3 }),
    overview: overview(2),
    now: '2026-08-20T01:00:00.000Z',
  })
  assert.ok(report.findings.includes('The container has restarted multiple times.'))
  assert.equal(report.findings.some((value) => /crash loop/i.test(value)), false)
})

test('service flapping plus restart evidence supports a recent instability finding', () => {
  const report = buildDiagnosticReport({
    incident: incident({ type: 'service-flapping' }),
    inspect: inspect({ state: 'running', exitCode: 0, restartCount: 4 }),
    overview: overview(2),
    now: '2026-08-20T01:00:00.000Z',
  })
  assert.ok(report.findings.includes('FRIDAY observed recent repeated runtime-state changes consistent with service instability.'))
  assert.ok(report.recommendations.includes('Inspect recent logs and dependency/configuration health before any restart action.'))
})

test('running but unhealthy container is diagnosed separately from process state', () => {
  const report = buildDiagnosticReport({
    incident: incident({ type: 'service-degraded' }),
    inspect: inspect({ state: 'running', exitCode: 0, health: { status: 'unhealthy', recent: [] } }),
    overview: overview(2),
    now: '2026-08-20T01:00:00.000Z',
  })
  assert.ok(report.findings.includes('The container process is running, but its configured health check is failing.'))
  assert.ok(report.recommendations.includes('Inspect health-check status, service dependencies, and recent logs.'))
})

test('isolation inference requires at least two other online VM100 services', () => {
  const report = buildDiagnosticReport({
    incident: incident(),
    inspect: inspect(),
    overview: overview(1),
    now: '2026-08-20T01:00:00.000Z',
  })
  assert.equal(report.findings.includes('The failure appears isolated to this service rather than a host-wide Docker outage.'), false)
})

test('diagnostic metadata is cloned rather than aliasing provider payload', () => {
  const source = inspect()
  const report = buildDiagnosticReport({ incident: incident(), inspect: source, overview: overview(2), now: '2026-08-20T01:00:00.000Z' })
  source.exitCode = 0
  assert.equal(report.metadata.exitCode, 255)
})
