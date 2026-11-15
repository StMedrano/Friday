-- Friday "Claim" and "Move" on the Tasks screen. Applied by hand on VM132 by
-- the owner, after 202611060001_friday_work_writer.sql.
--
-- Adds ONE function the insert-only friday_work_writer role may call. The role
-- still cannot UPDATE or DELETE any table directly: the function runs as its
-- owner, checks every input and changes exactly one task's status and version
-- (plus, for a claim, one operator claim row). Friday checks the operator and
-- the project grant before calling it; the function re-checks the project.
--
-- Allowed moves (anything else returns invalid-transition):
--   ready       -> in_progress (claim), blocked, cancelled
--   in_progress -> ready (release), blocked, review, completed
--   blocked     -> ready, in_progress (claim), cancelled
--   review      -> in_progress (claim), ready, completed
--   completed, cancelled: final.
-- A task held by a live claim from someone else (an agent or another person)
-- is never moved: lease-conflict. Claiming runs nothing.
create or replace function public.friday_operator_move_task(
 work_id uuid, project_id text, expected_version bigint,
 principal_id text, next_status text, request_id text
) returns jsonb language plpgsql security definer
set search_path = pg_catalog
as $$
declare w public.friday_work_items%rowtype;
        c public.friday_work_claims%rowtype;
        new_claim uuid := null;
        allowed text[];
begin
 if work_id is null or project_id is null or length(project_id) not between 1 and 128
    or expected_version is null or expected_version < 1
    or principal_id is null or principal_id !~ '^access:[a-f0-9]{64}$'
    or request_id is null or length(request_id) not between 1 and 128
    or next_status is null
    or next_status not in ('ready','in_progress','blocked','review','completed','cancelled') then
   return jsonb_build_object('error','invalid-input');
 end if;
 select * into w from public.friday_work_items as item
   where item.id = friday_operator_move_task.work_id for update;
 if not found or w.project_id <> friday_operator_move_task.project_id then
   return jsonb_build_object('error','not-found');
 end if;
 if w.version <> expected_version then return jsonb_build_object('error','version-conflict'); end if;
 allowed := case w.status
   when 'ready' then array['in_progress','blocked','cancelled']
   when 'in_progress' then array['ready','blocked','review','completed']
   when 'blocked' then array['ready','in_progress','cancelled']
   when 'review' then array['in_progress','ready','completed']
   else array[]::text[] end;
 if not (next_status = any(allowed)) then
   return jsonb_build_object('error','invalid-transition');
 end if;
 if w.active_claim_id is not null then
   select * into c from public.friday_work_claims as claim where claim.id = w.active_claim_id;
   if found and c.released_at is null then
     if c.expires_at > now() and c.principal_id <> friday_operator_move_task.principal_id then
       return jsonb_build_object('error','lease-conflict');
     end if;
     update public.friday_work_claims set released_at = now() where id = c.id;
   end if;
 end if;
 if next_status = 'in_progress' then
   -- An operator claim lasts 8 hours; agents cannot take the task meanwhile.
   insert into public.friday_work_claims(work_item_id, agent_id, run_id, principal_id,
     expires_at, request_id, input_fingerprint, work_version)
   values (w.id, 'friday-operator', friday_operator_move_task.request_id,
     friday_operator_move_task.principal_id, now() + interval '8 hours',
     friday_operator_move_task.request_id,
     md5(w.id::text || ':friday-operator:' || friday_operator_move_task.request_id),
     w.version + 1)
   returning id into new_claim;
 end if;
 update public.friday_work_items
   set status = next_status, active_claim_id = new_claim, version = version + 1, updated_at = now()
   where id = w.id;
 return jsonb_build_object('status','moved','task',jsonb_build_object(
   'id', w.id, 'project_id', w.project_id, 'title', w.title,
   'status', next_status, 'version', w.version + 1));
exception when unique_violation then
 -- The same person reused a request id for a second claim.
 return jsonb_build_object('error','idempotency-conflict');
end $$;

revoke all on function public.friday_operator_move_task(uuid,text,bigint,text,text,text) from public, anon, authenticated;
grant execute on function public.friday_operator_move_task(uuid,text,bigint,text,text,text) to friday_work_writer;
