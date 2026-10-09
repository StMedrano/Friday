import test from 'node:test'
import assert from 'node:assert/strict'
import { createNvidiaProvider } from './nvidia.mjs'
import { ProviderUnavailableError } from './errors.mjs'

const hosted = { deployment: 'hosted', baseUrl: 'https://integrate.api.nvidia.com/v1', apiKey: 'private-secret', model: 'vendor/model', maxTokens: 300 }
const local = { deployment: 'local', baseUrl: 'http://nvidia-nim:8000/v1/', model: 'local/model' }
const request = { messages: [{ role: 'user', content: 'Hello' }], maxTokens: 900 }

test('hosted completion sends authorized bounded request, returns normalized response', async () => {
  const provider = createNvidiaProvider({ fetchImpl: async (url, init) => {
    assert.equal(url, 'https://integrate.api.nvidia.com/v1/chat/completions')
    assert.equal(init.headers.Authorization, 'Bearer private-secret')
    assert.deepEqual(JSON.parse(init.body), { model: 'vendor/model', messages: request.messages, max_tokens: 300 })
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {status:200})
  } })
  assert.deepEqual(await provider.generate({ providerConfig: hosted, request }), {provider:'nvidia', model:'vendor/model', text:'ok'})
})
test('local requests omit authorization and work without a key', async () => {
  const provider = createNvidiaProvider({ fetchImpl: async (url, init) => {
    assert.equal(url, 'http://nvidia-nim:8000/v1/chat/completions')
    assert.equal('Authorization' in init.headers, false)
    return new Response(JSON.stringify({choices:[{message:{content:[{type:'text',text:'local ok'}]}}]}), {status:200})
  }})
  assert.equal((await provider.generate({providerConfig:local,request})).text,'local ok')
})
test('health verifies exact configured model and authenticates hosted only', async () => {
  const provider = createNvidiaProvider({fetchImpl:async (url,init) => {
    assert.equal(url,'https://integrate.api.nvidia.com/v1/models')
    assert.equal(init.headers.Authorization,'Bearer private-secret')
    return new Response(JSON.stringify({data:[{id:'vendor/model'}]}))
  }})
  assert.deepEqual(await provider.health({providerConfig:hosted}), {healthy:true})
  const absent=createNvidiaProvider({fetchImpl:async ()=>new Response(JSON.stringify({data:[{id:'other'}]}))})
  await assert.rejects(absent.health({providerConfig:local}),e=>e instanceof ProviderUnavailableError && e.kind==='model-unavailable')
})
test('hosted requires credentials; malformed endpoint is rejected', async () => {
  const provider=createNvidiaProvider({fetchImpl:async()=>{throw Error('network should not run')}})
  await assert.rejects(provider.generate({providerConfig:{...hosted,apiKey:''},request}), e=>e.kind==='configuration')
  await assert.rejects(provider.health({providerConfig:{...local,baseUrl:'file:///tmp/private'}}), e=>e.kind==='configuration')
})
test('HTTP/network/empty response errors are normalized without leaking upstream details', async () => {
  for(const [status,kind] of [[401,'authentication'],[403,'authentication'],[429,'rate-limited'],[503,'upstream']]) {
    const provider=createNvidiaProvider({fetchImpl:async()=>new Response('private upstream payload',{status})})
    await assert.rejects(provider.generate({providerConfig:local,request}),e=>e.kind===kind && !e.message.includes('private'))
  }
  const network=createNvidiaProvider({fetchImpl:async()=>{throw Error('private transport')}})
  await assert.rejects(network.health({providerConfig:local}),e=>e.kind==='network' && !e.message.includes('private'))
  const invalid=createNvidiaProvider({fetchImpl:async()=>new Response('{}')})
  await assert.rejects(invalid.generate({providerConfig:local,request}),e=>e.kind==='invalid-response')
})