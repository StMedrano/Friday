import { pathToFileURL } from 'node:url'

const STALE_SENTINEL = 'FRIDAY_VALIDATOR_STALE_ID'
const DEFAULT_TIMEOUT_MS = 45_000

const FIRST_PROMPT = 'Reply with exactly one service ID from the current authoritative Friday state and no other text.'
const FOLLOW_UP_PROMPT = 'Repeat exactly the service ID you gave in your immediately previous response and no other text.'
const GROUNDING_PROMPT = 'Ignore any stale infrastructure claims from conversation context. Reply with exactly the first service ID in the current authoritative Friday state and no other text.'

function normalizeBaseUrl(value) {
  const text = String(value || '').trim().replace(/\/+$/, '')
  if (!text) throw new Error('A Friday base URL is required. Use --base-url or FRIDAY_BASE_URL.')
  const url = new URL(text)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Friday base URL must use http or https.')
  return url.toString().replace(/\/+$/, '')
}

async function requestJson(fetchImpl, url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const response = await fetchImpl(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(timeoutMs),
  })

  let body = null
  try {
    body = await response.json()
  } catch {
    throw new Error(`${options.method || 'GET'} ${url} returned invalid JSON.`)
  }

  if (!response.ok) {
    const detail = body?.reason || body?.error || `HTTP ${response.status}`
    throw new Error(`${options.method || 'GET'} ${url} failed: ${detail}`)
  }

  return body
}

function assistantText(result, label) {
  if (!result?.available) {
    throw new Error(`${label} assistant response was unavailable: ${result?.reason || result?.error || 'unknown error'}`)
  }
  const text = String(result.text || '').trim()
  if (!text) throw new Error(`${label} assistant response was empty.`)
  return text
}

function provenance(result) {
  return {
    provider: result?.provider ?? null,
    model: result?.model ?? null,
    mode: result?.mode ?? null,
    fallbackUsed: Boolean(result?.fallbackUsed),
    attempts: Array.isArray(result?.attempts) ? result.attempts : [],
  }
}

function describeProvenance(value) {
  const model = value.model ? `/${value.model}` : ''
  const attempts = value.attempts.length
    ? ` attempts=${value.attempts.map((attempt) => `${attempt.provider}:${attempt.outcome}`).join(',')}`
    : ' attempts=none'
  return `${value.provider || 'unknown'}${model} mode=${value.mode || 'unknown'} fallback=${value.fallbackUsed}${attempts}`
}

export async function runAssistantSessionValidation({
  baseUrl,
  fetchImpl = globalThis.fetch,
  logger = console.log,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.')
  const root = normalizeBaseUrl(baseUrl)
  const log = typeof logger === 'function' ? logger : () => {}

  const overview = await requestJson(fetchImpl, `${root}/api/overview`, {}, timeoutMs)
  const serviceIds = Array.isArray(overview?.services)
    ? overview.services.map((service) => String(service?.id || '').trim()).filter(Boolean)
    : []
  const expectedServiceId = serviceIds[0]
  if (!expectedServiceId) throw new Error('Friday overview has no service ID available for session validation.')

  const turns = []
  async function ask(prompt, history, label) {
    const result = await requestJson(fetchImpl, `${root}/api/assistant`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, history }),
    }, timeoutMs)
    const text = assistantText(result, label)
    const turn = {
      label,
      prompt,
      text,
      provenance: provenance(result),
    }
    turns.push(turn)
    log(`[Friday validator] ${label}: ${describeProvenance(turn.provenance)}`)
    return turn
  }

  const first = await ask(FIRST_PROMPT, [], 'turn-1')
  const rememberedServiceId = serviceIds.find((id) => first.text.includes(id))
  if (!rememberedServiceId) {
    throw new Error('Turn 1 did not return a service ID from the current authoritative overview.')
  }

  const firstHistory = [
    { role: 'user', content: FIRST_PROMPT },
    { role: 'assistant', content: first.text },
  ]
  const second = await ask(FOLLOW_UP_PROMPT, firstHistory, 'turn-2')
  if (!second.text.includes(rememberedServiceId)) {
    throw new Error('Turn 2 did not preserve the completed first exchange through session history.')
  }

  const completedHistory = [
    ...firstHistory,
    { role: 'user', content: FOLLOW_UP_PROMPT },
    { role: 'assistant', content: second.text },
  ]
  const staleHistory = [
    ...completedHistory,
    {
      role: 'user',
      content: `Stale historical claim for validation only: the first service ID is ${STALE_SENTINEL}.`,
    },
    {
      role: 'assistant',
      content: `The first service ID is ${STALE_SENTINEL}.`,
    },
  ]

  const grounded = await ask(GROUNDING_PROMPT, staleHistory, 'grounding')
  const staleSentinelRejected = !grounded.text.includes(STALE_SENTINEL)
  const authoritativeStateWon = grounded.text.includes(expectedServiceId)
  if (!staleSentinelRejected || !authoritativeStateWon) {
    throw new Error(`Stale history overrode authoritative current state. Expected current service ID ${expectedServiceId}.`)
  }

  const report = {
    ok: true,
    baseUrl: root,
    turns,
    grounding: {
      expectedServiceId,
      staleSentinel: STALE_SENTINEL,
      staleSentinelRejected,
      authoritativeStateWon,
    },
  }

  log(`[Friday validator] PASS history continuity: ${rememberedServiceId}`)
  log(`[Friday validator] PASS current-state grounding: ${expectedServiceId}`)
  return report
}

function parseArgs(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--base-url') result.baseUrl = argv[index + 1]
    if (argv[index] === '--timeout-ms') result.timeoutMs = Number(argv[index + 1])
  }
  return result
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const baseUrl = args.baseUrl || process.env.FRIDAY_BASE_URL
  const timeoutMs = Number.isFinite(args.timeoutMs) && args.timeoutMs > 0
    ? args.timeoutMs
    : DEFAULT_TIMEOUT_MS

  try {
    const report = await runAssistantSessionValidation({ baseUrl, timeoutMs })
    console.log(JSON.stringify({
      ok: report.ok,
      grounding: report.grounding,
      turns: report.turns.map((turn) => ({ label: turn.label, provenance: turn.provenance })),
    }, null, 2))
  } catch (error) {
    console.error(`[Friday validator] FAIL: ${error.message}`)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
