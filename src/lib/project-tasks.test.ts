import {expect,it} from 'vitest'
import {projectsFrom,tasksFrom} from './project-tasks'
it('rejects malformed catalogs and task fields instead of displaying empty or invalid records',()=>{
 for(const projects of [{},[{id:'',name:'A'}],[{id:'a',name:''}],[{id:'*',name:'All'}]])expect(()=>projectsFrom({projects})).toThrow()
 const row={id:'task-a',projectId:'project-a',title:'Task',objective:'Goal',acceptanceCriteria:[],status:'ready',version:1}
 expect(tasksFrom({tasks:[row]},'project-a')).toHaveLength(1)
 for(const patch of [{title:''},{objective:''},{title:'x'.repeat(161)},{acceptanceCriteria:['x'.repeat(501)]},{projectId:'private'}])expect(()=>tasksFrom({tasks:[{...row,...patch}]},'project-a')).toThrow()
})
