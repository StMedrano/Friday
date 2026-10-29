import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {validateStagingCompose} from './verify-friday-staging.mjs'

const root=new URL('../deploy/staging/',import.meta.url)
const compose=()=>readFile(new URL('compose.yaml',root),'utf8')

test('staging is a standalone private Docker network with no published ports, production volumes or socket',async()=>{
 const source=await compose()
 const [stageSource,tunnelSource]=source.split(/^  cloudflared-staging:$/m)
 assert.ok(stageSource&&tunnelSource,'both staging and tunnel blocks must exist')
 assert.match(stageSource,/^    restart: unless-stopped$/m)
 assert.match(tunnelSource,/^    restart: unless-stopped$/m)
 assert.match(source,/FRIDAY_MODE:\s*live/)
 assert.match(source,/FRIDAY_ACCESS_TEAM_DOMAIN:\s*https:\/\/mytechtactics\.cloudflareaccess\.com/)
 assert.match(source,/FRIDAY_ACCESS_AUD:.*FRIDAY_STAGE_CF_ACCESS_AUD/)
 assert.match(source,/FRIDAY_ACCESS_OPERATOR_EMAILS:\s*['"]{2}/)
 assert.match(source,/FRIDAY_MONITORING_ENABLED:\s*['"]?false['"]?/)
 assert.match(source,/FRIDAY_AI_ENABLED:\s*['"]?false['"]?/)
 assert.match(source,/FRIDAY_AGENT_REGISTRY_ENABLED:\s*['"]?false['"]?/)
 assert.match(source,/FRIDAY_DOCKER_ENABLED:\s*['"]?false['"]?/)
 assert.match(source,/FRIDAY_PROXMOX_ENABLED:\s*['"]?false['"]?/)
 assert.match(source,/FRIDAY_VM100_OBSERVER_ENABLED:\s*['"]?false['"]?/)
 assert.match(source,/profiles:\s*\[tunnel\]/)
 assert.match(source,/--token-file/)
 assert.match(source,/secrets:/)
 assert.doesNotMatch(source,/\bports:\s*\n|\/var\/run\/docker\.sock|friday_data|FRIDAY_SUPABASE_SERVICE_KEY/)
 assert.match(source,/cloudflare\/cloudflared@sha256:[a-f0-9]{64}/)
})
test('staging compose validator rejects host-published ports, prod data, wrong auth and absent sidecar profile',()=>{
 const good={services:{
  'friday-staging':{
   image:'friday-staging:candidate',
   environment:{FRIDAY_MODE:'live',
    FRIDAY_ACCESS_TEAM_DOMAIN:'https://mytechtactics.cloudflareaccess.com',
    FRIDAY_ACCESS_AUD:'a'.repeat(64),FRIDAY_ACCESS_OPERATOR_EMAILS:'',
    FRIDAY_MONITORING_ENABLED:'false',FRIDAY_AI_ENABLED:'false',FRIDAY_DOCKER_ENABLED:'false',
    FRIDAY_PROXMOX_ENABLED:'false',FRIDAY_VM100_OBSERVER_ENABLED:'false',FRIDAY_AGENT_REGISTRY_ENABLED:'false'},
   restart:'unless-stopped',
   networks:{friday_staging:{}},tmpfs:['/data:rw,nosuid,nodev,uid=10001,gid=10001,size=16m'],ports:[],read_only:true,cap_drop:['ALL'],
  },
  'cloudflared-staging':{
   image:'cloudflare/cloudflared@sha256:'+'a'.repeat(64),
   restart:'unless-stopped',
   profiles:['tunnel'],networks:{friday_staging:{}},ports:[],read_only:true,cap_drop:['ALL'],
   command:['tunnel','run','--token-file','/run/secrets/staging_tunnel_token'],
   secrets:[{source:'staging_tunnel_token',target:'/run/secrets/staging_tunnel_token'}],
  }
 },volumes:{},networks:{friday_staging:{driver:'bridge'}},secrets:{staging_tunnel_token:{file:'/tmp/fixture-token'}}}
 assert.deepEqual(validateStagingCompose(good),[])
 for(const [path,alter] of [
  ['staging does not auto-recover',j=>{j.services['friday-staging'].restart='no'}],
  ['staging restart always ignores intentional stops',j=>{j.services['friday-staging'].restart='always'}],
  ['tunnel does not auto-recover',j=>{j.services['cloudflared-staging'].restart='no'}],
  ['host port',j=>{j.services['friday-staging'].ports=[{published:'13101',target:3010}]}],
  ['prod volume',j=>{j.services['friday-staging'].volumes=[{source:'friday_data',target:'/data'}]}],
  ['no team domain',j=>{j.services['friday-staging'].environment.FRIDAY_ACCESS_TEAM_DOMAIN=''}],
  ['no stage aud',j=>{j.services['friday-staging'].environment.FRIDAY_ACCESS_AUD=''}],
  ['same as production aud',j=>{j.services['friday-staging'].environment.FRIDAY_ACCESS_AUD='f566316cef0d66e796fc90eeb68fbddb2f08926d9a4f14599fed509046c1c564'}],
  ['tunnel auto',j=>{j.services['cloudflared-staging'].profiles=[]}],
  ['raw tunnel token env',j=>{j.services['cloudflared-staging'].environment={TUNNEL_TOKEN:'SECRET'} }],
  ['prod observer enabled',j=>{j.services['friday-staging'].environment.FRIDAY_VM100_OBSERVER_ENABLED='true'}],
 ]){
  const value=structuredClone(good);alter(value)
  assert.ok(validateStagingCompose(value).length>0,path)
 }
})
test('CI performs a synthetic staging compose config validation with no live credentials',async()=>{
 const workflow=await readFile(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8')
 assert.match(workflow,/sh scripts\/verify-friday-staging\.sh/)
})

test('CI builds and smoke-tests the real staging image without starting a tunnel',async()=>{
 const workflow=await readFile(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8')
 assert.match(workflow,/sh scripts\/test-friday-staging-isolation\.sh/)
})
