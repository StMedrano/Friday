insert into public.friday_projects(id,name) values ('friday-test','Friday isolated test');
insert into public.friday_work_items(project_id,title,objective,creator_principal,request_id,input_fingerprint) values ('friday-test','test claim','verify atomic leasing','tester','create-1','hash1');
do $$
declare wid uuid; result jsonb; v bigint; claim uuid;
begin
 select id into wid from public.friday_work_items where project_id='friday-test';
 result := public.friday_claim_work(wid,1,'tester','coder','run-a',120,'claim-1');
 if result->>'status'  is distinct from  'claimed' then raise exception 'first claim failed: %',result; end if;
 claim := (result->>'claimId')::uuid;
 result := public.friday_claim_work(wid,1,'tester','coder','run-a',300,'claim-1');
 if result->>'error' is distinct from 'idempotency-conflict' then raise exception 'altered claim replay accepted: %',result; end if;
 result := public.friday_claim_work(wid,1,'tester','coder','run-a',120,'claim-1');
 if result->>'status' is distinct from 'claimed' or (result->>'workVersion')::int is distinct from 2 then raise exception 'exact claim replay did not return original result: %',result; end if;
 select version into v from public.friday_work_items where id=wid;
 if v is distinct from 2 then raise exception 'version not incremented'; end if;
 result := public.friday_claim_work(wid,1,'other','reviewer','run-b',120,'claim-2');
 if result->>'error'  is distinct from  'version-conflict' then raise exception 'stale version accepted %',result; end if;
 result := public.friday_claim_work(wid,2,'other','reviewer','run-b',120,'claim-3');
 if result->>'error'  is distinct from  'lease-conflict' then raise exception 'active lease stolen %',result; end if;
 result := public.friday_renew_claim(claim,'run-wrong',2,120);
 if result->>'error'  is distinct from  'lease-conflict' then raise exception 'wrong run renewed lease %',result; end if;
 result := public.friday_renew_claim(claim,'run-a',2,120);
 if result->>'status'  is distinct from  'renewed' then raise exception 'owner renewal failed %',result; end if;
 result := public.friday_release_claim(claim,'run-a',3,'review');
 if result->>'status'  is distinct from  'released' then raise exception 'release failed %',result; end if;
 result := public.friday_claim_work(wid,4,'other','reviewer','run-b',120,'claim-4');
 if result->>'status'  is distinct from  'claimed' then raise exception 'released item cannot be reclaimed %',result; end if;
 if (select count(*) from public.friday_work_claims where work_item_id=wid) is distinct from 2 then raise exception 'missing claim history'; end if;
end $$;
-- Simulate expiry in a disposable DB; the SQL functions must rely on DB time.
insert into public.friday_work_items(project_id,title,objective,creator_principal,request_id,input_fingerprint)
values ('friday-test','expire claim','test recovery','tester','expire-item','fp2');
do $$
declare wid uuid; old_claim uuid; r jsonb; active_claim uuid;
begin
 select id into wid from public.friday_work_items where request_id='expire-item';
 r:=public.friday_claim_work(wid,1,'tester','coder','run-old',120,'claim-expired');
 if r->>'status' is distinct from 'claimed' then raise exception 'initial expiry test claim failed: %',r; end if;
 old_claim:=(r->>'claimId')::uuid;
 update public.friday_work_claims set claimed_at=now()-interval '200 seconds',expires_at=now()-interval '1 second' where id=old_claim;
 r:=public.friday_renew_claim(old_claim,'run-old',2,120);
 if r->>'error' is distinct from 'lease-expired' then raise exception 'expired lease renewed: %',r; end if;
 r:=public.friday_claim_work(wid,2,'tester2','reviewer','run-new',120,'reclaim');
 if r->>'status' is distinct from 'claimed' then raise exception 'reclaim failed: %',r; end if;
 active_claim:=(r->>'claimId')::uuid;
 if active_claim=old_claim then raise exception 'reclaim did not preserve old claim'; end if;
 r:=public.friday_release_claim(old_claim,'run-old',3,'review');
 if r->>'error' is distinct from 'lease-conflict' then raise exception 'old worker released active lease: %',r; end if;
 if (select count(*) from public.friday_work_claims where work_item_id=wid) is distinct from 2 then raise exception 'claim history missing'; end if;
end $$;