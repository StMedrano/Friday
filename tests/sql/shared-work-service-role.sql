-- Real authorization integration: invoke approved operations as a restricted
-- service_role, not as superuser. Executed only against ephemeral test database.
begin;
set local role service_role;
do $$
declare
  wid uuid;
  cid uuid;
  answer jsonb;
  did uuid;
begin
  insert into public.friday_projects(id, name) values ('service-integration', 'Service-role acceptance');
  insert into public.friday_work_items(project_id,title,objective,
    creator_principal,request_id,input_fingerprint)
  values('service-integration','Integrate','Verify caller permissions',
    'runtime','service-item','fp')
  returning id into wid;

  answer := public.friday_claim_work(wid,1,'runtime','worker','run-one',120,'service-claim');
  if answer->>'status' is distinct from 'claimed' then
    raise exception 'service role claim: %',answer;
  end if;
  cid := (answer->>'claimId')::uuid;
  answer := public.friday_append_checkpoint(cid,'run-one',2,'service-checkpoint',
    '{"summary":"checkpoint","completed":[],"remaining":[]}'::jsonb);
  if answer->>'status' is distinct from 'appended' then
    raise exception 'service role append: %',answer;
  end if;
  answer := public.friday_append_handoff(cid,'run-one',3,'service-handoff',
    '{"summary":"handoff","status":"review","completed":[],"remaining":[]}'::jsonb);
  if answer->>'status' is distinct from 'appended' then
    raise exception 'service role handoff: %',answer;
  end if;
  answer := public.friday_release_claim(cid,'run-one',4,'review');
  if answer->>'status' is distinct from 'released' then
    raise exception 'service role release: %',answer;
  end if;

  insert into public.friday_decisions(work_item_id,summary,provenance,
    principal_id,request_id,input_fingerprint)
  values(wid,'Approve local staging','reviewer','runtime','decision-1','fingerprint')
  returning id into did;
  answer := public.friday_review_decision(did,1,'reviewer','accepted');
  if answer->>'status' is distinct from 'accepted' then
    raise exception 'service role decision: %',answer;
  end if;
  insert into public.friday_memories(scope,owner_id,project_id,
    content,provenance,principal_id,request_id,input_fingerprint)
  values('project','service-integration','service-integration',
    'Approved architecture','operator','runtime','memory-1','fingerprint');
  if (select count(*) from public.friday_memories where owner_id='service-integration') <> 1 then
    raise exception 'service role memory insert missing';
  end if;
end $$;
rollback;