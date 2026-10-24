import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {spawnSync} from 'node:child_process'

const fromRepo=x=>readFile(resolve(import.meta.dirname,'..',x),'utf8')
test('live controller Compose never exposes raw Docker socket or enables Docker inventory',async()=>{
 const yaml=await fromRepo('compose.live.yaml')
 assert.doesNotMatch(yaml,/\/var\/run\/docker\.sock/)
 assert.match(yaml,/FRIDAY_DOCKER_ENABLED:\s*false/)
 assert.doesNotMatch(yaml,/FRIDAY_DOCKER_ENABLED:\s*\$\{/)
})
test('live Compose requires team/audience/operator config variables for Access verifier',async()=>{
 const yaml=await fromRepo('compose.live.yaml')
 for(const name of ['FRIDAY_ACCESS_TEAM_DOMAIN','FRIDAY_ACCESS_AUD','FRIDAY_ACCESS_OPERATOR_EMAILS'])
  assert.ok(yaml.includes(name+': ${'+name+':-}'),name)
})
test('client application never contains server-side Access credentials',async()=>{
 const yaml=await fromRepo('compose.yaml')
 assert.doesNotMatch(yaml,/VITE_.*FRIDAY_ACCESS_/)
 const env=await fromRepo('.env.example')
 for(const name of ['FRIDAY_ACCESS_TEAM_DOMAIN','FRIDAY_ACCESS_AUD','FRIDAY_ACCESS_OPERATOR_EMAILS'])
  assert.match(env,new RegExp('^'+name+'=','m'))
})
test('base Compose passes server-only Access configuration into the controller',()=>{
 const result=spawnSync('docker',['compose','config','--format','json'],{
  cwd:resolve(import.meta.dirname,'..'),
  env:{
   ...process.env,
   FRIDAY_ACCESS_TEAM_DOMAIN:'https://team.cloudflareaccess.com',
   FRIDAY_ACCESS_AUD:'aud-123',
   FRIDAY_ACCESS_OPERATOR_EMAILS:'',
  },
  encoding:'utf8',
 })
 assert.equal(result.status,0,result.stderr)
 const config=JSON.parse(result.stdout)
 assert.equal(config.services.friday.environment.FRIDAY_ACCESS_TEAM_DOMAIN,'https://team.cloudflareaccess.com')
 assert.equal(config.services.friday.environment.FRIDAY_ACCESS_AUD,'aud-123')
 assert.equal(config.services.friday.environment.FRIDAY_ACCESS_OPERATOR_EMAILS,'')
})
test('base Compose passes structured endpoint checks only to the controller',()=>{
 const checks='[{"id":"site-a","name":"Site A","site":"Site A","url":"https://site-a.example.test/healthz","expectedStatuses":[200]}]'
 const result=spawnSync('docker',['compose','config','--format','json'],{
  cwd:resolve(import.meta.dirname,'..'),
  env:{...process.env,FRIDAY_ENDPOINT_CHECKS_JSON:checks},
  encoding:'utf8',
 })
 assert.equal(result.status,0,result.stderr)
 const config=JSON.parse(result.stdout)
 assert.equal(config.services.friday.environment.FRIDAY_ENDPOINT_CHECKS_JSON,checks)
})
test('base Compose passes AdGuard Home settings only as server-side controller variables',async()=>{
 const result=spawnSync('docker',['compose','config','--format','json'],{
  cwd:resolve(import.meta.dirname,'..'),
  env:{
   ...process.env,
   FRIDAY_ADGUARD_ENABLED:'true',
   FRIDAY_ADGUARD_URL:'https://dns.example.test/',
   FRIDAY_ADGUARD_USERNAME:'friday',
   FRIDAY_ADGUARD_PASSWORD:'synthetic-password',
   FRIDAY_ADGUARD_SITE:'Site B',
  },
  encoding:'utf8',
 })
 assert.equal(result.status,0,result.stderr)
 const environment=JSON.parse(result.stdout).services.friday.environment
 assert.equal(environment.FRIDAY_ADGUARD_ENABLED,'true')
 assert.equal(environment.FRIDAY_ADGUARD_URL,'https://dns.example.test/')
 assert.equal(environment.FRIDAY_ADGUARD_USERNAME,'friday')
 assert.equal(environment.FRIDAY_ADGUARD_PASSWORD,'synthetic-password')
 assert.equal(environment.FRIDAY_ADGUARD_SITE,'Site B')
 const yaml=await fromRepo('compose.yaml')
 assert.match(yaml,/FRIDAY_ADGUARD_ENABLED: \$\{FRIDAY_ADGUARD_ENABLED:-false\}/)
 assert.match(yaml,/FRIDAY_ADGUARD_PASSWORD: \$\{FRIDAY_ADGUARD_PASSWORD:-\}/)
 const env=await fromRepo('.env.example')
 assert.match(env,/^FRIDAY_ADGUARD_ENABLED=false$/m)
 assert.match(env,/^FRIDAY_ADGUARD_PASSWORD=$/m)
 for(const source of [yaml,env])assert.doesNotMatch(source,/VITE_[A-Z_]*ADGUARD/)
})
