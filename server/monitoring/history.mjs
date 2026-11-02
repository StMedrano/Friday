export const MAX_EVENTS=5000
const text=value=>typeof value==='string'&&value.length<=2000

function projectEvent(event){
 if(!event||typeof event!=='object'||Array.isArray(event))return null
 if(!text(event.id)||!event.id||!text(event.type)||!event.type||!text(event.at)||!Number.isFinite(Date.parse(event.at))||!text(event.source)||!event.source||!text(event.detail))return null
 const projected={id:event.id,type:event.type,at:event.at,source:event.source,detail:event.detail}
 for(const key of ['host','serviceId','serviceName']){
  if(event[key]===undefined||event[key]===null)continue
  if(!text(event[key]))return null
  projected[key]=event[key]
 }
 return projected
}

// Project the public monitoring contract: only listed fields leave the server.
// A history that is not a list is an error, never an empty timeline. Single
// malformed events are dropped and repeated IDs (two writes in the same
// millisecond) keep their first, newest entry, so one bad record cannot hide
// the whole timeline. The runtime lists newest first; the window is bounded
// so a large FRIDAY_MONITORING_HISTORY_LIMIT never turns into an error.
export function projectMonitoringHistory(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||!Array.isArray(value.events))throw Error('Invalid monitoring history')
 const ids=new Set(),events=[]
 for(const raw of value.events){
  if(events.length>=MAX_EVENTS)break
  const event=projectEvent(raw)
  if(!event||ids.has(event.id))continue
  ids.add(event.id)
  events.push(event)
 }
 return {events}
}
