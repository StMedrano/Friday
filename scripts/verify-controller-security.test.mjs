import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'

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
