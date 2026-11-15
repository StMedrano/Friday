-- Friday "Edit" on the Tasks screen. Applied by hand on VM132 by the owner,
-- after 202611060001_friday_work_writer.sql (and independent of the mover).
--
-- Adds ONE function the insert-only friday_work_writer role may call. The role
-- still cannot UPDATE or DELETE any table directly: the function runs as its
-- owner, checks every input and changes exactly one task's title, optionally
-- its objective, and its version. Status, claims, project and acceptance
-- criteria never change here. Friday checks the operator and the project
-- grant before calling it; the function re-checks the project.
--
-- Not editable: completed or cancelled tasks (final), and a task held by a
-- live claim from someone else (lease-conflict). A stale version is a
-- version-conflict, so an edit never overwrites a newer change.
create or replace function public.friday_operator_edit_task(
 work_id uuid, project_id text, expected_version bigint,
 principal_id text, new_title text, new_objective text
) returns jsonb language plpgsql security definer
set search_path = pg_catalog
as $$
declare w public.friday_work_items%rowtype;
        c public.friday_work_claims%rowtype;
begin
 if work_id is null or project_id is null or length(project_id) not between 1 and 128
    or expected_version is null or expected_version < 1
    or principal_id is null or principal_id !~ '^access:[a-f0-9]{64}$'
    or new_title is null or length(new_title) not between 1 and 160 or new_title <> btrim(new_title)
    or (new_objective is not null and (length(new_objective) not between 1 and 4000
        or new_objective <> btrim(new_objective))) then
   return jsonb_build_object('error','invalid-input');
 end if;
 select * into w from public.friday_work_items as item
   where item.id = friday_operator_edit_task.work_id for update;
 if not found or w.project_id <> friday_operator_edit_task.project_id then
   return jsonb_build_object('error','not-found');
 end if;
 if w.version <> expected_version then return jsonb_build_object('error','version-conflict'); end if;
 if w.status in ('completed','cancelled') then return jsonb_build_object('error','task-closed'); end if;
 if w.active_claim_id is not null then
   select * into c from public.friday_work_claims as claim where claim.id = w.active_claim_id;
   if found and c.released_at is null and c.expires_at > now()
      and c.principal_id <> friday_operator_edit_task.principal_id then
     return jsonb_build_object('error','lease-conflict');
   end if;
 end if;
 update public.friday_work_items
   set title = new_title, objective = coalesce(new_objective, objective),
       version = version + 1, updated_at = now()
   where id = w.id;
 return jsonb_build_object('status','edited','task',jsonb_build_object(
   'id', w.id, 'project_id', w.project_id, 'title', new_title,
   'status', w.status, 'version', w.version + 1));
end $$;

revoke all on function public.friday_operator_edit_task(uuid,text,bigint,text,text,text) from public, anon, authenticated;
grant execute on function public.friday_operator_edit_task(uuid,text,bigint,text,text,text) to friday_work_writer;
