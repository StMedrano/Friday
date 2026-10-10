insert into public.friday_work_items(project_id,title,objective,creator_principal,request_id,input_fingerprint)
values ('friday-test','Decision review','Ensure acceptance is deliberate','tester','decision-item','decision-fp');
insert into public.friday_decisions(work_item_id,summary,provenance,principal_id,request_id,input_fingerprint)
select id,'Keep all models free','operator proposal','worker','decision-req','decision-hash'
from public.friday_work_items where request_id='decision-item';
do $$
declare did uuid; r jsonb;
begin
 select id into did from public.friday_decisions where request_id='decision-req';
 r:=public.friday_review_decision(did,1,'reviewer-1','accepted');
 if r->>'status' is distinct from 'accepted' or (r->>'version')::int is distinct from 2 then raise exception 'decision review failed: %',r; end if;
 r:=public.friday_review_decision(did,1,'reviewer-2','rejected');
 if r->>'error' is distinct from 'version-conflict' then raise exception 'stale decision reviewer overrode result: %',r; end if;
 r:=public.friday_review_decision(did,2,'reviewer-2','rejected');
 if r->>'error' is distinct from 'invalid-input' then raise exception 'reviewed decision was overwritten: %',r; end if;
 if (select state from public.friday_decisions where id=did) is distinct from 'accepted' then raise exception 'accepted state lost'; end if;
end $$;