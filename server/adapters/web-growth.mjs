import {validateWebGrowthSnapshot} from './web-growth-schema.mjs'
const MAX_BYTES=1024*1024
export async function readWebGrowth(config,{fetchImpl=fetch}={}) {
 try {
  if(config?.enabled!==true||typeof config.token!=='string'||config.token.length<32||/\s/.test(config.token)) throw Error()
  const origin=new URL(config.baseUrl)
  if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash) throw Error()
  const response=await fetchImpl(new URL('/v1/friday/web-growth',origin).href,{method:'GET',redirect:'error',headers:{authorization:'Bearer '+config.token,accept:'application/json'},signal:AbortSignal.timeout(8000)})
  if(!response.ok||Number(response.headers.get('content-length'))>MAX_BYTES) throw Error()
  const reader=response.body?.getReader()
  if(!reader)throw Error()
  const chunks=[];let size=0
  try {
   for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES)throw Error();chunks.push(value)}
  } finally {await reader.cancel().catch(()=>{})}
  return validateWebGrowthSnapshot(JSON.parse(Buffer.concat(chunks).toString('utf8')))
 }catch{throw Error('Web Growth unavailable')}
}
