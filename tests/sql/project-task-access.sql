-- Disposable database only. No migration or production grant change.
begin;
set local role service_role;
insert into public.friday_projects(id,name) values('local-project-slice','Synthetic task project');
insert into public.friday_work_items(project_id,title,objective,creator_principal,request_id,input_fingerprint)
 values('local-project-slice','Persisted slice','Reload after insert','synthetic-owner','slice-request','slice-fingerprint');
do $$
begin
 if (select count(*) from public.friday_work_items where project_id='local-project-slice' and title='Persisted slice' and status='ready' and version=1)<>1 then
  raise exception 'Task insert/reload failed';
 end if;
 begin
  insert into public.friday_work_items(project_id,title,objective,creator_principal,request_id,input_fingerprint)
   values('unprovisioned-project','Denied','Missing catalog FK','synthetic-owner','bad-project','fp');
  raise exception 'Unprovisioned project accepted';
 exception when foreign_key_violation then null;end;
 begin
  insert into public.friday_work_items(project_id,title,objective,creator_principal,request_id,input_fingerprint)
   values('local-project-slice','','Invalid title','synthetic-owner','bad-title','fp');
  raise exception 'Invalid title accepted';
 exception when check_violation then null;end;
 begin
  insert into public.friday_work_items(project_id,title,objective,creator_principal,request_id,input_fingerprint)
   values('local-project-slice','Duplicate','Replay','synthetic-owner','slice-request','slice-fingerprint');
  raise exception 'Duplicate request accepted';
 exception when unique_violation then null;end;
 if (select count(*) from public.friday_work_items where project_id='local-project-slice')<>1 then raise exception 'Failed writes persisted';end if;
end $$;
rollback;
