-- Disposable PostgreSQL check for friday_operator_move_task; never run against production.
insert into public.friday_projects(id, name) values ('mover-project', 'Mover acceptance'), ('other-project', 'Other');
insert into public.friday_work_items(id, project_id, title, objective, creator_principal, request_id, input_fingerprint)
values ('11111111-1111-4111-8111-111111111111', 'mover-project', 'Move me', 'Move me', 'access:seed', 'seed-1', 'fp'),
       ('22222222-2222-4222-8222-222222222222', 'mover-project', 'Agent holds me', 'Agent holds me', 'access:seed', 'seed-2', 'fp');

-- An agent holds the second task through the service-role claim function.
select public.friday_claim_work('22222222-2222-4222-8222-222222222222', 1, 'runtime:agent', 'agent-1', 'run-1', 600, 'agent-req-1');

begin;
set local role friday_work_writer;
do $$
declare
  me constant text := 'access:' || repeat('a', 64);
  other constant text := 'access:' || repeat('b', 64);
  task constant uuid := '11111111-1111-4111-8111-111111111111';
  result jsonb;
begin
  result := public.friday_operator_move_task(task, 'mover-project', 1, me, 'in_progress', 'claim-1');
  if result->>'status' <> 'moved' or result->'task'->>'status' <> 'in_progress'
     or (result->'task'->>'version')::int <> 2 then
    raise exception 'claim failed: %', result;
  end if;

  -- Stale version, another person's live claim, wrong project and bad moves are refused.
  result := public.friday_operator_move_task(task, 'mover-project', 1, me, 'review', 'm-2');
  if result->>'error' <> 'version-conflict' then raise exception 'stale version accepted: %', result; end if;
  result := public.friday_operator_move_task(task, 'mover-project', 2, other, 'ready', 'm-3');
  if result->>'error' <> 'lease-conflict' then raise exception 'other person moved a claimed task: %', result; end if;
  result := public.friday_operator_move_task(task, 'other-project', 2, me, 'ready', 'm-4');
  if result->>'error' <> 'not-found' then raise exception 'wrong project accepted: %', result; end if;
  result := public.friday_operator_move_task(task, 'mover-project', 2, me, 'in_progress', 'm-5');
  if result->>'error' <> 'invalid-transition' then raise exception 'in_progress to in_progress accepted: %', result; end if;
  result := public.friday_operator_move_task(task, 'mover-project', 2, 'runtime:x', 'ready', 'm-6');
  if result->>'error' <> 'invalid-input' then raise exception 'non-Access principal accepted: %', result; end if;

  -- The claimer sends it to review, then completes it; completed is final.
  result := public.friday_operator_move_task(task, 'mover-project', 2, me, 'review', 'm-7');
  if result->'task'->>'status' <> 'review' then raise exception 'review failed: %', result; end if;
  result := public.friday_operator_move_task(task, 'mover-project', 3, other, 'completed', 'm-8');
  if result->'task'->>'status' <> 'completed' then raise exception 'complete failed: %', result; end if;
  result := public.friday_operator_move_task(task, 'mover-project', 4, me, 'ready', 'm-9');
  if result->>'error' <> 'invalid-transition' then raise exception 'completed task reopened: %', result; end if;

  -- A task an agent holds is never moved by a person.
  result := public.friday_operator_move_task('22222222-2222-4222-8222-222222222222', 'mover-project', 2, me, 'blocked', 'm-10');
  if result->>'error' <> 'lease-conflict' then raise exception 'agent claim overridden: %', result; end if;

  begin
    update public.friday_work_items set status = 'ready' where id = task;
    raise exception 'writer updated a task directly';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

do $$
begin
  if has_table_privilege('friday_work_writer','public.friday_work_items','UPDATE')
    or has_table_privilege('friday_work_writer','public.friday_work_claims','INSERT')
    or has_table_privilege('friday_work_writer','public.friday_work_claims','UPDATE') then
    raise exception 'mover migration widened table privileges';
  end if;
  if has_function_privilege('anon','public.friday_operator_move_task(uuid,text,bigint,text,text,text)','EXECUTE')
    or has_function_privilege('authenticated','public.friday_operator_move_task(uuid,text,bigint,text,text,text)','EXECUTE') then
    raise exception 'browser roles can move tasks';
  end if;
end $$;
