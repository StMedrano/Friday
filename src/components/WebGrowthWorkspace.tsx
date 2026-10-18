import {useEffect,useState} from 'react'
import {fetchWebGrowthSnapshot,type WebGrowthSnapshot} from '../lib/api'
const formatDate=(value:string|null)=>value?new Date(value).toLocaleString():'Not reported'
export default function WebGrowthWorkspace(){
 const [snapshot,setSnapshot]=useState<WebGrowthSnapshot|null>(null)
 const [loading,setLoading]=useState(true)
 const [error,setError]=useState('')
 const [refresh,setRefresh]=useState(0)
 const [selected,setSelected]=useState('')
 useEffect(()=>{
  const controller=new AbortController()
  setLoading(true);setError('');setSnapshot(null);setSelected('')
  fetchWebGrowthSnapshot(controller.signal).then(value=>{if(!controller.signal.aborted)setSnapshot(value)})
   .catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error&&/^(Reader permission|Sign in)/.test(error.message)?error.message:'Web Growth connection unavailable. The authenticated reader may not be configured.')})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false)})
  return ()=>controller.abort()
 },[refresh])
 const lead=snapshot?.leads.find(item=>item.id===selected)
 const stages=snapshot?Object.entries(snapshot.leads.reduce<Record<string,number>>((counts,item)=>({...counts,[item.stage]:(counts[item.stage]||0)+1}),{})):[]
 return <section className="v3-agent-detail v3-web-growth" aria-label="Web Growth pipeline" aria-busy={loading}>
  <div className="v3-agent-detail-head"><div><span className="v3-kicker">PRIVATE PROJECT · READ ONLY</span><h3>Web Growth pipeline</h3></div><button type="button" className="v3-agent-primary" disabled={loading} onClick={()=>setRefresh(value=>value+1)}>Refresh pipeline</button></div>
  {loading?<p role="status">Loading pipeline…</p>:error?<p role="status">{error}</p>:snapshot?<>
   <p>{snapshot.leads.length} leads · Read at {formatDate(snapshot.generatedAt)}</p>
   <div className="v3-web-growth-stages" aria-label="Pipeline stage counts">{stages.map(([stage,count])=><span key={stage}>{stage.replaceAll('_',' ')} <strong>{count}</strong></span>)}</div>
   <div className="v3-web-growth-body"><div className="v3-group-evidence-list" role="region" aria-label="Lead records" tabIndex={0}>
    {snapshot.leads.length?snapshot.leads.map(item=><button type="button" className="v3-web-growth-lead" key={item.id} aria-pressed={selected===item.id} aria-label={item.businessName+' · '+item.stage} onClick={()=>setSelected(item.id)}><strong>{item.businessName}</strong><span>{item.stage.replaceAll('_',' ')}</span></button>):<p>No leads reported by this reader response.</p>}
   </div><div className="v3-web-growth-detail" aria-live="polite">{lead?<><h4>{lead.businessName}</h4><dl>
    <dt>Score</dt><dd>{lead.score===null?'Not reported':lead.score+' / 100'}</dd>
    <dt>Outreach approval</dt><dd>{lead.approvedForOutreach?'Approved in source':'Not approved'}</dd>
    <dt>Approval generated</dt><dd>{formatDate(lead.approvedOutreachGeneratedAt)}</dd>
    <dt>Outreach status</dt><dd>{lead.outreachStatus?.replaceAll('_',' ')||'Not reported'}</dd>
    <dt>Sent</dt><dd>{formatDate(lead.outreachSentAt)}</dd>
    <dt>Last update</dt><dd>{formatDate(lead.updatedAt)}</dd>
    <dt>Audit checked</dt><dd>{formatDate(lead.auditCheckedAt)}</dd>
    <dt>Proposal artifact</dt><dd>{lead.proposalAvailable?'Available':'Not reported'}</dd>
    <dt>Demo artifact</dt><dd>{lead.demoAvailable?'Available':'Not reported'}</dd>
   </dl><small>Record: {lead.id}</small></>:<p>Select a lead to inspect its recorded status.</p>}</div></div>
   <details><summary>Source evidence</summary><p>Reported source revision: {snapshot.sourceRevision}</p><p className="v3-web-growth-checksum">Store checksum: {snapshot.sourceChecksum}</p><p>The reader reports file evidence; this does not verify the deployed service revision or approval validity.</p></details>
  </>:null}
  <p className="v3-group-tools-note">Explicit project reader permission required. No sending, approval or stage changes. Private records are not sent to group advice.</p>
 </section>
}
