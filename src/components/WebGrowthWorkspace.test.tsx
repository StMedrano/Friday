import {fireEvent,render,screen} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import WebGrowthWorkspace from './WebGrowthWorkspace'
const lead={id:'lead-1',businessName:'Fixture Bakery',stage:'qualified',discoveredAt:'2026-10-13T12:00:00Z',updatedAt:'2026-10-14T12:00:00Z',approvedForOutreach:false,approvedOutreachGeneratedAt:null,outreachStatus:null,outreachSentAt:null,score:82,auditCheckedAt:null,proposalAvailable:true,demoAvailable:false}
const snapshot={schemaVersion:'1',projectId:'techtactics-web-growth',generatedAt:'2026-10-14T12:00:00Z',sourceRevision:'abcdef0',sourceChecksum:'a'.repeat(64),leads:[lead]}
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status})
const designsOff=()=>json({error:'aidesigner-disabled'},503)
// The Website designs panel reads /api/aidesigner/sessions; these tests are about the pipeline.
const route=(pipeline:()=>Promise<Response>|Response)=>vi.fn(async (url:RequestInfo|URL)=>url==='/api/web-growth'?pipeline():designsOff())
afterEach(()=>vi.unstubAllGlobals())
it('reads fixed project data and exposes evidence details without write controls',async()=>{
 const fetchMock=route(()=>json(snapshot));vi.stubGlobal('fetch',fetchMock);render(<WebGrowthWorkspace/> )
 expect(await screen.findByRole('button',{name:'Fixture Bakery · qualified'})).toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:'Fixture Bakery · qualified'}))
 expect(screen.getByText('82 / 100')).toBeInTheDocument();expect(screen.getByText('Not approved')).toBeInTheDocument()
 expect(screen.getByText('Available')).toBeInTheDocument()
 expect(screen.queryByRole('button',{name:/send|approve|restart|execute/i})).not.toBeInTheDocument()
 expect(fetchMock.mock.calls.map(([url])=>url).sort()).toEqual(['/api/aidesigner/sessions','/api/web-growth'])
})
it('denied connection is explicit and refresh replaces stale evidence',async()=>{
 const pipeline=vi.fn().mockResolvedValueOnce(json(snapshot)).mockResolvedValueOnce(json({},403));vi.stubGlobal('fetch',route(pipeline))
 render(<WebGrowthWorkspace/>);await screen.findByRole('button',{name:'Fixture Bakery · qualified'})
 fireEvent.click(screen.getByRole('button',{name:'Refresh pipeline'}))
 expect(await screen.findByText(/Reader permission required/)).toBeInTheDocument()
 expect(screen.queryByText('Fixture Bakery')).not.toBeInTheDocument()
})
it('malformed response never becomes an empty healthy pipeline',async()=>{
 vi.stubGlobal('fetch',route(()=>json({...snapshot,leads:[{...lead,score:'bad'}]})))
 render(<WebGrowthWorkspace/>);expect(await screen.findByText(/Web Growth connection unavailable/)).toBeInTheDocument()
 expect(screen.queryByText('No leads reported')).not.toBeInTheDocument()
})
it('website designs sit in Web Growth and can start from the selected lead',async()=>{
 vi.stubGlobal('fetch',vi.fn(async (url:RequestInfo|URL)=>url==='/api/web-growth'?json(snapshot):json({sessions:[],generate:true})))
 render(<WebGrowthWorkspace/>)
 fireEvent.click(await screen.findByRole('button',{name:'Fixture Bakery · qualified'}))
 expect(await screen.findByRole('region',{name:'Website designs'})).toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:'Start from Fixture Bakery'}))
 expect((screen.getByLabelText('Describe the website design') as HTMLTextAreaElement).value).toContain('Fixture Bakery')
})
