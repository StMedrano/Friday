-- Friday "New task" write path. Applied by hand on VM132 by the owner, after
-- 202610090001_friday_shared_work.sql and 202610110001_friday_shared_work_grants.sql.
--
-- Creates a NOLOGIN role that can only add new tasks to friday_work_items and
-- read them back. It cannot update, delete, claim, or touch any other table.
-- Friday reaches it through PostgREST with a JWT whose role claim is
-- friday_work_writer (FRIDAY_WORK_WRITE_KEY). Never reuse the service key.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'friday_work_writer') then
    create role friday_work_writer nologin noinherit;
  end if;
  -- PostgREST switches to the JWT's role from its authenticator login.
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    grant friday_work_writer to authenticator;
  end if;
end $$;

revoke all on public.friday_work_items from friday_work_writer;
grant usage on schema public to friday_work_writer;

-- New rows only, and only the caller-supplied columns. status, version,
-- active_claim_id and timestamps keep their defaults.
grant insert (project_id, title, objective, acceptance_criteria,
  creator_principal, request_id, input_fingerprint)
  on public.friday_work_items to friday_work_writer;

-- Needed to return the created row and to recognise a retried request.
grant select (id, project_id, title, status, version, creator_principal,
  request_id, input_fingerprint)
  on public.friday_work_items to friday_work_writer;

drop policy if exists friday_work_writer_insert on public.friday_work_items;
create policy friday_work_writer_insert on public.friday_work_items
  for insert to friday_work_writer
  with check (status = 'ready' and version = 1 and active_claim_id is null
    and creator_principal like 'access:%');

drop policy if exists friday_work_writer_select on public.friday_work_items;
create policy friday_work_writer_select on public.friday_work_items
  for select to friday_work_writer
  using (true);
