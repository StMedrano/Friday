-- Disposable PostgreSQL schema validation; must never run against homelab production.
do $$
declare t text;
begin
 foreach t in array array['friday_projects','friday_work_items','friday_work_claims','friday_agent_runs','friday_checkpoints','friday_handoffs','friday_decisions','friday_artifacts','friday_memories'] loop
  if not exists(select 1 from pg_tables where schemaname='public' and tablename=t and rowsecurity) then raise exception 'missing RLS for %',t; end if;
  if has_table_privilege('anon','public.'||t,'SELECT') or has_table_privilege('authenticated','public.'||t,'SELECT') then raise exception 'unexpected public access for %',t; end if;
  if not has_table_privilege('service_role','public.'||t,'SELECT') then raise exception 'missing service role access for %',t; end if;
 end loop;
end $$;

do $$
declare signature text;
begin
 foreach signature in array array[
  'public.friday_claim_work(uuid,bigint,text,text,text,integer,text)',
  'public.friday_renew_claim(uuid,text,bigint,integer)',
  'public.friday_release_claim(uuid,text,bigint,text)',
  'public.friday_append_checkpoint(uuid,text,bigint,text,jsonb)',
  'public.friday_append_handoff(uuid,text,bigint,text,jsonb)',
  'public.friday_review_decision(uuid,bigint,text,text)'
 ] loop
  if has_function_privilege('anon',signature,'EXECUTE') or has_function_privilege('authenticated',signature,'EXECUTE') then
    raise exception 'public role can run mutation RPC: %',signature;
  end if;
  if not has_function_privilege('service_role',signature,'EXECUTE') then
    raise exception 'service role missing RPC privilege: %',signature;
  end if;
 end loop;
end $$;

do $$
begin
 if has_schema_privilege('anon','friday_internal','USAGE') or has_schema_privilege('authenticated','friday_internal','USAGE') then
  raise exception 'private helper schema exposed';
 end if;
 if not has_schema_privilege('service_role','friday_internal','USAGE') then
  raise exception 'service role cannot call private helper';
 end if;
end $$;

-- Immutable accepted history: service role may append but never rewrite or erase it.
do $$
declare t text;
begin
 foreach t in array array['friday_checkpoints','friday_handoffs','friday_memories','friday_artifacts'] loop
  if has_table_privilege('service_role','public.'||t,'UPDATE')
     or has_table_privilege('service_role','public.'||t,'DELETE') then
    raise exception 'service role unexpectedly can rewrite or delete %',t;
  end if;
  if not has_table_privilege('service_role','public.'||t,'INSERT')
    or not has_table_privilege('service_role','public.'||t,'SELECT') then
    raise exception 'service role missing append/read on %',t;
  end if;
 end loop;
 if has_table_privilege('service_role','public.friday_decisions','DELETE') then
    raise exception 'review history deletable by service role';
 end if;
end $$;