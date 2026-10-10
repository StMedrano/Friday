-- Isolated database only: append-only, exactly-once retry, lease ownership and stale versions.
insert into public.friday_work_items(project_id,title,objective,creator_principal,request_id,input_fingerprint)
values('friday-test','handoff test','verify append-only history','tester','handoff-test-item','handoff-hash');
do $$
declare wid uuid; cid uuid; r jsonb; first_id uuid; second_id uuid;
begin
 select id into wid from public.friday_work_items where request_id='handoff-test-item';
 r:=public.friday_claim_work(wid,1,'worker','coder','run-1',120,'handoff-test-claim');
 cid:=(r->>'claimId')::uuid;
 r:=public.friday_append_checkpoint(cid,'run-1',2,'cp-first','{"summary":"step one","completed":[]}'::jsonb);
 if r->>'status' is distinct from 'appended' or (r->>'workVersion')::int is distinct from 3 then raise exception 'checkpoint append failed: %',r; end if;
 first_id:=(r->>'recordId')::uuid;
 r:=public.friday_append_checkpoint(cid,'run-1',2,'cp-first','{"completed":[],"summary":"step one"}'::jsonb);
 if (r->>'recordId')::uuid is distinct from first_id then raise exception 'checkpoint retry not idempotent: %',r; end if;
 r:=public.friday_append_checkpoint(cid,'run-1',3,'cp-first','{"summary":"different"}'::jsonb);
 if r->>'error' is distinct from 'idempotency-conflict' then raise exception 'changed retry accepted: %',r; end if;
 r:=public.friday_append_handoff(cid,'run-1',3,'ho-first','{"status":"review","summary":"handoff","completed":[]}'::jsonb);
 if r->>'status' is distinct from 'appended' or (r->>'workVersion')::int is distinct from 4 then raise exception 'handoff failed: %',r; end if;
 first_id:=(r->>'recordId')::uuid;
 r:=public.friday_append_handoff(cid,'run-1',3,'ho-first','{"completed":[],"summary":"handoff","status":"review"}'::jsonb);
 if (r->>'recordId')::uuid is distinct from first_id then raise exception 'handoff retry failed: %',r; end if;
 r:=public.friday_append_checkpoint(cid,'other-run',4,'cp-denied','{"summary":"bad"}'::jsonb);
 if r->>'error' is distinct from 'lease-conflict' then raise exception 'cross-run checkpoint allowed: %',r; end if;
 r:=public.friday_append_handoff(cid,'run-1',3,'ho-stale','{"summary":"stale"}'::jsonb);
 if r->>'error' is distinct from 'version-conflict' then raise exception 'stale write accepted: %',r; end if;
 r:=public.friday_append_handoff(cid,'run-1',4,'ho-second','{"status":"blocked","summary":"blocker"}'::jsonb);
 if r->>'status' is distinct from 'appended' then raise exception 'second append failed: %',r; end if;
 second_id:=(r->>'recordId')::uuid;
 if second_id=first_id then raise exception 'history overwritten'; end if;
 if (select count(*) from public.friday_handoffs where work_item_id=wid) is distinct from 2
   or (select count(*) from public.friday_checkpoints where work_item_id=wid) is distinct from 1
 then raise exception 'history count incorrect'; end if;
 if (select id from public.friday_handoffs where work_item_id=wid order by work_version desc,id desc limit 1) is distinct from second_id
 then raise exception 'latest handoff ordering wrong'; end if;
 r:=public.friday_release_claim(cid,'run-1',5,'review');
 if r->>'status' is distinct from 'released' then raise exception 'release failed after append: %',r; end if;
 r:=public.friday_append_checkpoint(cid,'run-1',6,'cp-after','{"summary":"not allowed"}'::jsonb);
 if r->>'error' is distinct from 'lease-conflict' then raise exception 'released owner continued: %',r; end if;
end $$;