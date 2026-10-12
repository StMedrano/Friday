import { pathToFileURL } from 'node:url'

const expected={
 FRIDAY_MODE:'live',
 FRIDAY_CF_ACCESS_ENABLED:'true',
 FRIDAY_CF_ACCESS_TEAM_DOMAIN:'https://mytechtactics.cloudflareaccess.com',
 FRIDAY_PUBLIC_ORIGIN:'https://friday-staging.mytechtactics.com',
 FRIDAY_MONITORING_ENABLED:'false',
 FRIDAY_AI_ENABLED:'false',
 FRIDAY_AGENT_REGISTRY_ENABLED:'false',
 FRIDAY_DOCKER_ENABLED:'false',
 FRIDAY_PROXMOX_ENABLED:'false',
 FRIDAY_VM100_OBSERVER_ENABLED:'false',
}
const productionAud='f566316cef0d66e796fc90eeb68fbddb2f08926d9a4f14599fed509046c1c564'
export function validateStagingCompose(c){
 const errors=[]
 if(!c||typeof c!=='object')return ['missing compose config']
 const service=c.services?.['friday-staging']
 const tunnel=c.services?.['cloudflared-staging']
 if(!service||!tunnel)return ['stage/tunnel service missing']
 if(Object.keys(c.services).length!==2)errors.push('unexpected services')
 for(const [key,value] of Object.entries(expected)){
  if(String(service.environment?.[key])!==value)errors.push('stage environment '+key+' is not restrictive')
 }
 const aud=service.environment?.FRIDAY_CF_ACCESS_AUD
 if(typeof aud!=='string'||!/^[A-Za-z0-9_-]{12,128}$/.test(aud)||aud===productionAud)errors.push('staging AUD missing or equals production')
 if(service.ports?.length||tunnel.ports?.length)errors.push('host ports must not be published')
 for(const [name,s] of Object.entries(c.services)){
  if(s.network_mode==='host'||s.privileged===true||s.read_only!==true||!s.cap_drop?.includes('ALL'))errors.push(name+' privileges too broad')
  if(s.volumes?.length)errors.push(name+' must have no production mounts/volumes')
  if(!('friday_staging' in (s.networks||{})))errors.push(name+' outside staging network')
  if(s.environment&&Object.keys(s.environment).some(k=>/(?:API_KEY|SERVICE_KEY|DOCKER_SOCKET|TUNNEL_TOKEN)/.test(k)))errors.push(name+' has secret/socket environment')
 }
 const tmp=JSON.stringify(service.tmpfs||[])
 if(!tmp.includes('/data:')||!tmp.includes('uid=10001'))errors.push('stage data must be isolated tmpfs')
 if(!Array.isArray(tunnel.profiles)||!tunnel.profiles.includes('tunnel'))errors.push('tunnel must be opt-in only')
 if(!/^cloudflare\/cloudflared@sha256:[a-f0-9]{64}$/.test(tunnel.image||''))errors.push('tunnel image must be digest pinned')
 if(!JSON.stringify(tunnel.command||[]).includes('--token-file'))errors.push('tunnel token-file required')
 if(!JSON.stringify(tunnel.secrets||[]).includes('staging_tunnel_token'))errors.push('staging token must use Docker secret')
 if(c.volumes&&Object.keys(c.volumes).length)errors.push('staging must not declare persistent volumes')
 if(c.networks?.friday_staging?.driver!=='bridge')errors.push('isolated bridge required')
 return errors
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  let input=''
  for await(const chunk of process.stdin)input+=chunk
  const result=validateStagingCompose(JSON.parse(input))
  if(result.length){process.stderr.write('BLOCKED: '+result.join('; ')+'\n');process.exitCode=2}
  else process.stdout.write('PASS: isolated Friday staging/tunnel Compose is private and fail-closed\n')
 }catch(e){process.stderr.write('BLOCKED: could not validate staging Compose ('+e.name+')\n');process.exitCode=2}
}
