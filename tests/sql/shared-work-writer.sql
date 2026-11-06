-- Disposable PostgreSQL check for the friday_work_writer role; never run against production.
insert into public.friday_projects(id, name) values ('writer-project', 'Writer acceptance');

begin;
set local role friday_work_writer;
do $$
declare
  created record;
  again int;
begin
  insert into public.friday_work_items(project_id,title,objective,acceptance_criteria,
    creator_principal,request_id,input_fingerprint)
  values('writer-project','New task','New task','[]'::jsonb,'access:abc','req-1','fp-1')
  returning id, status, version into created;
  if created.status <> 'ready' or created.version <> 1 then
    raise exception 'writer created unexpected row: %', created;
  end if;

  -- A retried request is ignored rather than duplicated.
  insert into public.friday_work_items(project_id,title,objective,acceptance_criteria,
    creator_principal,request_id,input_fingerprint)
  values('writer-project','New task','New task','[]'::jsonb,'access:abc','req-1','fp-1')
  on conflict (creator_principal, request_id) do nothing;
  select count(*) into again from public.friday_work_items
    where creator_principal = 'access:abc' and request_id = 'req-1';
  if again <> 1 then raise exception 'retry duplicated the task'; end if;

  begin
    insert into public.friday_work_items(project_id,title,objective,status,
      creator_principal,request_id,input_fingerprint)
    values('writer-project','Bad','Bad','in_progress','access:abc','req-2','fp');
    raise exception 'writer set a status';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.friday_work_items(project_id,title,objective,
      creator_principal,request_id,input_fingerprint)
    values('writer-project','Bad','Bad','runtime','req-3','fp');
    raise exception 'writer used a non-Access principal';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.friday_work_items set title = 'Changed' where id = created.id;
    raise exception 'writer updated a task';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.friday_work_items where id = created.id;
    raise exception 'writer deleted a task';
  exception when insufficient_privilege then null;
  end;

  begin
    perform 1 from public.friday_work_claims limit 1;
    raise exception 'writer read claims';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

do $$
begin
  if has_table_privilege('friday_work_writer','public.friday_work_items','UPDATE')
    or has_table_privilege('friday_work_writer','public.friday_work_items','DELETE')
    or has_table_privilege('friday_work_writer','public.friday_work_claims','SELECT')
    or has_table_privilege('friday_work_writer','public.friday_memories','INSERT') then
    raise exception 'writer role has more than insert/select on tasks';
  end if;
  if has_function_privilege('friday_work_writer','public.friday_claim_work(uuid,bigint,text,text,text,integer,text)','EXECUTE') then
    raise exception 'writer role can claim work';
  end if;
end $$;
