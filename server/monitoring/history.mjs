// Project the public monitoring contract. Never treat an invalid read as empty.
export function projectMonitoringHistory(value) {
 const fail=()=>{throw Error('Invalid monitoring history')}
 if(!value||typeof value!=='object'||Array.isArray(value)||!Array.isArray(value.events)||value.events.length>5000)fail()
 const text=value=>typeof value==='string'&&value.length<=2000
 const ids=new Set()
 const events=value.events.map(event=>{
  if(!event||typeof event!=='object'||Array.isArray(event)||!text(event.id)||!event.id||ids.has(event.id)||!text(event.type)||!event.type||!text(event.at)||!Number.isFinite(Date.parse(event.at))||!text(event.source)||!event.source||!text(event.detail))fail()
  ids.add(event.id)
  const projected={id:event.id,type:event.type,at:event.at,source:event.source,detail:event.detail}
  for(const key of ['host','serviceId','serviceName'])if(event[key]!==undefined){if(!text(event[key]))fail();projected[key]=event[key]}
  return projected
 })
 return {events}
}
