-- Disposable PostgreSQL check for friday_operator_edit_task; never run against production.
-- Runs after shared-work-mover.sql, whose changes were rolled back.
insert into public.friday_projects(id, name) values ('editor-project', 'Editor acceptance') on conflict do nothing;
insert into public.friday_work_items(id, project_id, title, objective, creator_principal, request_id, input_fingerprint, status)
values ('33333333-3333-4333-8333-333333333333', 'editor-project', 'Edit me', 'Original objective', 'access:seed', 'seed-e1', 'fp', 'ready'),
       ('44444444-4444-4444-8444-444444444444', 'editor-project', 'Agent holds me', 'Held', 'access:seed', 'seed-e2', 'fp', 'ready'),
       ('55555555-5555-4555-8555-555555555555', 'editor-project', 'Done', 'Done', 'access:seed', 'seed-e3', 'fp', 'completed');

select public.friday_claim_work('44444444-4444-4444-8444-444444444444', 1, 'runtime:agent', 'agent-1', 'run-e1', 600, 'agent-req-e1');

begin;
set local role friday_work_writer;
do $$
declare
  me constant text := 'access:' || repeat('a', 64);
  task constant uuid := '33333333-3333-4333-8333-333333333333';
  result jsonb;
begin
  -- Title only keeps the objective; title and objective together change both.
  result := public.friday_operator_edit_task(task, 'editor-project', 1, me, 'Edited title', null);
  if result->>'status' <> 'edited' or result->'task'->>'title' <> 'Edited title'
     or result->'task'->>'status' <> 'ready' or (result->'task'->>'version')::int <> 2 then
    raise exception 'title edit failed: %', result;
  end if;
  result := public.friday_operator_edit_task(task, 'editor-project', 2, me, 'Second title', 'New objective');
  if result->>'status' <> 'edited' or (result->'task'->>'version')::int <> 3 then
    raise exception 'objective edit failed: %', result;
  end if;

  -- Stale version, wrong project, bad text and non-Access principals are refused.
  result := public.friday_operator_edit_task(task, 'editor-project', 1, me, 'Stale', null);
  if result->>'error' <> 'version-conflict' then raise exception 'stale version accepted: %', result; end if;
  result := public.friday_operator_edit_task(task, 'other-project', 3, me, 'Wrong', null);
  if result->>'error' <> 'not-found' then raise exception 'wrong project accepted: %', result; end if;
  result := public.friday_operator_edit_task(task, 'editor-project', 3, me, '', null);
  if result->>'error' <> 'invalid-input' then raise exception 'empty title accepted: %', result; end if;
  result := public.friday_operator_edit_task(task, 'editor-project', 3, me, ' padded', null);
  if result->>'error' <> 'invalid-input' then raise exception 'padded title accepted: %', result; end if;
  result := public.friday_operator_edit_task(task, 'editor-project', 3, me, repeat('x', 161), null);
  if result->>'error' <> 'invalid-input' then raise exception 'long title accepted: %', result; end if;
  result := public.friday_operator_edit_task(task, 'editor-project', 3, me, 'Ok', '');
  if result->>'error' <> 'invalid-input' then raise exception 'empty objective accepted: %', result; end if;
  result := public.friday_operator_edit_task(task, 'editor-project', 3, 'runtime:x', 'Ok', null);
  if result->>'error' <> 'invalid-input' then raise exception 'non-Access principal accepted: %', result; end if;

  -- A task an agent holds, and a completed task, are never edited.
  result := public.friday_operator_edit_task('44444444-4444-4444-8444-444444444444', 'editor-project', 2, me, 'Mine now', null);
  if result->>'error' <> 'lease-conflict' then raise exception 'agent claim overridden: %', result; end if;
  result := public.friday_operator_edit_task('55555555-5555-4555-8555-555555555555', 'editor-project', 1, me, 'Reopen', null);
  if result->>'error' <> 'task-closed' then raise exception 'closed task edited: %', result; end if;

  begin
    update public.friday_work_items set title = 'direct' where id = task;
    raise exception 'writer updated a task directly';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

-- The function changes nothing but title, objective, version and updated_at.
do $$
declare before_row public.friday_work_items%rowtype; after_row public.friday_work_items%rowtype; result jsonb;
begin
  select * into before_row from public.friday_work_items where id = '33333333-3333-4333-8333-333333333333';
  result := public.friday_operator_edit_task(before_row.id, 'editor-project', before_row.version, 'access:' || repeat('c', 64), 'Checked', 'Checked objective');
  select * into after_row from public.friday_work_items where id = before_row.id;
  if after_row.title <> 'Checked' or after_row.objective <> 'Checked objective'
     or after_row.status <> before_row.status or after_row.project_id <> before_row.project_id
     or after_row.acceptance_criteria <> before_row.acceptance_criteria
     or after_row.active_claim_id is distinct from before_row.active_claim_id
     or after_row.creator_principal <> before_row.creator_principal
     or after_row.version <> before_row.version + 1 then
    raise exception 'edit changed more than the text: %', result;
  end if;
end $$;

do $$
begin
  if has_table_privilege('friday_work_writer','public.friday_work_items','UPDATE') then
    raise exception 'editor migration widened table privileges';
  end if;
  if has_function_privilege('anon','public.friday_operator_edit_task(uuid,text,bigint,text,text,text)','EXECUTE')
    or has_function_privilege('authenticated','public.friday_operator_edit_task(uuid,text,bigint,text,text,text)','EXECUTE') then
    raise exception 'browser roles can edit tasks';
  end if;
end $$;
