-- Phase 2B shared work is additive and server-only. Never grant these tables to browser roles.
create table public.friday_projects (
 id text primary key check(length(id) between 1 and 128),
 name text not null check(length(name) between 1 and 160),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table public.friday_work_items (
 id uuid primary key default gen_random_uuid(),
 project_id text not null references public.friday_projects(id),
 title text not null check(length(title) between 1 and 160),
 objective text not null check(length(objective) between 1 and 4000),
 acceptance_criteria jsonb not null default '[]'::jsonb check(jsonb_typeof(acceptance_criteria)='array'),
 status text not null default 'ready' check(status in ('ready','in_progress','blocked','review','completed','cancelled')),
 version bigint not null default 1 check(version >= 1),
 active_claim_id uuid,
 creator_principal text not null,
 request_id text not null,
 input_fingerprint text not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(creator_principal,request_id)
);
create table public.friday_work_claims (
 id uuid primary key default gen_random_uuid(),
 work_item_id uuid not null references public.friday_work_items(id),
 agent_id text not null check(length(agent_id) between 1 and 128),
 run_id text not null check(length(run_id) between 1 and 128),
 principal_id text not null check(length(principal_id) between 1 and 128),
 claimed_at timestamptz not null default now(),
 expires_at timestamptz not null check(expires_at > claimed_at),
 released_at timestamptz,
 request_id text not null,
 input_fingerprint text not null,
 work_version bigint not null check(work_version>=1),
 unique(principal_id,request_id)
);
alter table public.friday_work_items add constraint friday_work_active_claim_fk foreign key(active_claim_id) references public.friday_work_claims(id);
create table public.friday_agent_runs (
 id uuid primary key default gen_random_uuid(),
 work_item_id uuid not null references public.friday_work_items(id),
 claim_id uuid references public.friday_work_claims(id),
 run_id text not null,
 agent_id text not null,
 principal_id text not null,
 state text not null default 'started' check(state in ('started','completed','failed','cancelled')),
 started_at timestamptz not null default now(),
 finished_at timestamptz,
 unique(work_item_id,run_id)
);
create table public.friday_checkpoints (
 id uuid primary key default gen_random_uuid(),
 work_item_id uuid not null references public.friday_work_items(id),
 claim_id uuid not null references public.friday_work_claims(id),
 run_id text not null,
 principal_id text not null,
 payload jsonb not null check(jsonb_typeof(payload)='object'),
 work_version bigint not null check(work_version>=1),
 request_id text not null,
 input_fingerprint text not null,
 created_at timestamptz not null default now(),
 unique(principal_id,request_id)
);
create table public.friday_handoffs (
 id uuid primary key default gen_random_uuid(),
 work_item_id uuid not null references public.friday_work_items(id),
 claim_id uuid not null references public.friday_work_claims(id),
 run_id text not null,
 principal_id text not null,
 payload jsonb not null check(jsonb_typeof(payload)='object'),
 work_version bigint not null check(work_version>=1),
 request_id text not null,
 input_fingerprint text not null,
 created_at timestamptz not null default now(),
 unique(principal_id,request_id)
);
create table public.friday_decisions (
 id uuid primary key default gen_random_uuid(),
 work_item_id uuid not null references public.friday_work_items(id),
 summary text not null check(length(summary) between 1 and 2000),
 provenance text not null,
 state text not null default 'proposed' check(state in ('proposed','accepted','rejected')),
 version bigint not null default 1 check(version>=1),
 reviewer_principal text,
 reviewed_at timestamptz,
 principal_id text not null,
 request_id text not null,
 input_fingerprint text not null,
 created_at timestamptz not null default now(),
 unique(principal_id,request_id)
);
create table public.friday_artifacts (
 id uuid primary key default gen_random_uuid(),
 work_item_id uuid not null references public.friday_work_items(id),
 ref_kind text not null check(ref_kind in ('git','artifact')),
 reference text not null check(length(reference) between 1 and 500),
 artifact_ref text not null check(length(artifact_ref) between 1 and 500),
 principal_id text not null,
 request_id text not null,
 input_fingerprint text not null,
 created_at timestamptz not null default now(),
 unique(principal_id,request_id)
);
create table public.friday_memories (
 id uuid primary key default gen_random_uuid(),
 scope text not null check(scope in ('global','organization','project','group','agent','task') and scope <> 'session'),
 owner_id text not null check(length(owner_id) between 1 and 128),
 project_id text references public.friday_projects(id),
 content text not null check(length(content) between 1 and 4000),
 provenance text not null,
 principal_id text not null,
 request_id text not null,
 input_fingerprint text not null,
 created_at timestamptz not null default now(),
 expires_at timestamptz,
 unique(principal_id,request_id)
);
create index friday_work_items_project_idx on public.friday_work_items(project_id,status);
create index friday_work_claims_item_idx on public.friday_work_claims(work_item_id,claimed_at desc);
create index friday_checkpoints_work_idx on public.friday_checkpoints(work_item_id,created_at desc);
create index friday_handoffs_work_idx on public.friday_handoffs(work_item_id,created_at desc,id);
create index friday_memories_scope_idx on public.friday_memories(scope,owner_id,project_id);
-- Explicit table-level RLS is required for every table in an exposed public schema.
alter table public.friday_projects enable row level security;
alter table public.friday_work_items enable row level security;
alter table public.friday_work_claims enable row level security;
alter table public.friday_agent_runs enable row level security;
alter table public.friday_checkpoints enable row level security;
alter table public.friday_handoffs enable row level security;
alter table public.friday_decisions enable row level security;
alter table public.friday_artifacts enable row level security;
alter table public.friday_memories enable row level security;
revoke all on public.friday_projects from public, anon, authenticated;
revoke all on public.friday_work_items from public, anon, authenticated;
revoke all on public.friday_work_claims from public, anon, authenticated;
revoke all on public.friday_agent_runs from public, anon, authenticated;
revoke all on public.friday_checkpoints from public, anon, authenticated;
revoke all on public.friday_handoffs from public, anon, authenticated;
revoke all on public.friday_decisions from public, anon, authenticated;
revoke all on public.friday_artifacts from public, anon, authenticated;
revoke all on public.friday_memories from public, anon, authenticated;
grant select, insert, update on public.friday_projects, public.friday_work_items, public.friday_work_claims, public.friday_agent_runs, public.friday_decisions to service_role;
grant select, insert on public.friday_checkpoints, public.friday_handoffs, public.friday_artifacts, public.friday_memories to service_role;

-- The transaction functions run with caller privileges and are callable only
-- by the trusted server role. Caller-to-agent authorization happens in Friday.
create function public.friday_claim_work(
 work_id uuid, expected_version bigint, principal_id text,
 agent_id text, run_id text, lease_seconds integer, request_id text
) returns jsonb language plpgsql security invoker set search_path=pg_catalog
as $$
declare w public.friday_work_items%rowtype;
        existing public.friday_work_claims%rowtype;
        new_id uuid;
begin
 if principal_id is null or length(principal_id) not between 1 and 128
    or agent_id is null or length(agent_id) not between 1 and 128
    or run_id is null or length(run_id) not between 1 and 128
    or request_id is null or length(request_id) not between 1 and 128
    or lease_seconds is null or lease_seconds not between 60 and 900
    or expected_version is null or expected_version < 1 then
   return jsonb_build_object('error','invalid-input');
 end if;
 select * into w from public.friday_work_items where id=work_id for update;
 if not found then return jsonb_build_object('error','not-found'); end if;
 select * into existing from public.friday_work_claims as prior
    where prior.principal_id=friday_claim_work.principal_id
      and prior.request_id=friday_claim_work.request_id;
 if found then
   if existing.work_item_id=w.id and existing.agent_id=friday_claim_work.agent_id
      and existing.run_id=friday_claim_work.run_id
      and existing.input_fingerprint=md5(w.id::text || ':' || friday_claim_work.agent_id || ':' || friday_claim_work.run_id || ':' || lease_seconds::text) then
     return jsonb_build_object('status','claimed','claimId',existing.id,
       'workVersion',existing.work_version,'leaseExpiresAt',existing.expires_at);
   end if;
   return jsonb_build_object('error','idempotency-conflict');
 end if;
 if w.version<>expected_version then return jsonb_build_object('error','version-conflict'); end if;
 if w.status in ('completed','cancelled') then return jsonb_build_object('error','invalid-input'); end if;
 if w.active_claim_id is not null then
   select * into existing from public.friday_work_claims where id=w.active_claim_id;
   if found and existing.released_at is null and existing.expires_at>now() then
      return jsonb_build_object('error','lease-conflict');
   end if;
 end if;
 insert into public.friday_work_claims(work_item_id,agent_id,run_id,principal_id,
   expires_at,request_id,input_fingerprint,work_version)
 values(w.id,friday_claim_work.agent_id,friday_claim_work.run_id,
   friday_claim_work.principal_id, now()+make_interval(secs=>lease_seconds),
   friday_claim_work.request_id,
   md5(friday_claim_work.work_id::text || ':' || friday_claim_work.agent_id || ':' || friday_claim_work.run_id || ':' || lease_seconds::text),
   w.version+1)
 returning id into new_id;
 update public.friday_work_items
   set active_claim_id=new_id,status='in_progress',version=version+1,updated_at=now()
 where id=w.id;
 return jsonb_build_object('status','claimed','claimId',new_id,
   'workVersion',w.version+1,'leaseExpiresAt',now()+make_interval(secs=>lease_seconds));
end $$;

create function public.friday_renew_claim(
 claim_id uuid, run_id text, expected_version bigint, lease_seconds integer
) returns jsonb language plpgsql security invoker set search_path=pg_catalog
as $$
declare c public.friday_work_claims%rowtype;
        w public.friday_work_items%rowtype;
        new_expiry timestamptz;
begin
 if lease_seconds is null or lease_seconds not between 60 and 900
    or expected_version is null or expected_version<1
    or run_id is null or length(run_id) not between 1 and 128
 then return jsonb_build_object('error','invalid-input'); end if;
 select * into c from public.friday_work_claims where id=claim_id;
 if not found then return jsonb_build_object('error','not-found'); end if;
 select * into w from public.friday_work_items where id=c.work_item_id for update;
 if w.version<>expected_version then return jsonb_build_object('error','version-conflict'); end if;
 if w.active_claim_id is distinct from c.id or c.run_id<>friday_renew_claim.run_id or c.released_at is not null
 then return jsonb_build_object('error','lease-conflict'); end if;
 if c.expires_at<=now() then return jsonb_build_object('error','lease-expired'); end if;
 new_expiry:=now()+make_interval(secs=>lease_seconds);
 update public.friday_work_claims set expires_at=new_expiry where id=c.id;
 update public.friday_work_items set version=version+1,updated_at=now() where id=w.id;
 return jsonb_build_object('status','renewed','claimId',c.id,'workVersion',w.version+1,'leaseExpiresAt',new_expiry);
end $$;

create function public.friday_release_claim(
 claim_id uuid, run_id text, expected_version bigint, next_status text
) returns jsonb language plpgsql security invoker set search_path=pg_catalog
as $$
declare c public.friday_work_claims%rowtype;
        w public.friday_work_items%rowtype;
begin
 if expected_version is null or expected_version<1
    or run_id is null or length(run_id) not between 1 and 128
    or next_status not in ('ready','blocked','review','completed','cancelled')
 then return jsonb_build_object('error','invalid-input'); end if;
 select * into c from public.friday_work_claims where id=claim_id;
 if not found then return jsonb_build_object('error','not-found'); end if;
 select * into w from public.friday_work_items where id=c.work_item_id for update;
 if w.version<>expected_version then return jsonb_build_object('error','version-conflict'); end if;
 if w.active_claim_id is distinct from c.id or c.run_id<>friday_release_claim.run_id or c.released_at is not null
 then return jsonb_build_object('error','lease-conflict'); end if;
 if c.expires_at<=now() then return jsonb_build_object('error','lease-expired'); end if;
 update public.friday_work_claims set released_at=now() where id=c.id;
 update public.friday_work_items
   set active_claim_id=null,status=next_status,version=version+1,updated_at=now()
   where id=w.id;
 return jsonb_build_object('status','released','workVersion',w.version+1);
end $$;

revoke all on function public.friday_claim_work(uuid,bigint,text,text,text,integer,text) from public,anon,authenticated;
revoke all on function public.friday_renew_claim(uuid,text,bigint,integer) from public,anon,authenticated;
revoke all on function public.friday_release_claim(uuid,text,bigint,text) from public,anon,authenticated;
grant execute on function public.friday_claim_work(uuid,bigint,text,text,text,integer,text) to service_role;
grant execute on function public.friday_renew_claim(uuid,text,bigint,integer) to service_role;
grant execute on function public.friday_release_claim(uuid,text,bigint,text) to service_role;

-- All append operations lock the work row and read back current claim state.
-- The private helper cannot be reached through the exposed public Data API.
create schema if not exists friday_internal;
revoke all on schema friday_internal from public, anon, authenticated;
grant usage on schema friday_internal to service_role;

create function friday_internal.append_record(
 record_kind text, claim_id uuid, run_id text,
 expected_version bigint, request_id text, payload_json jsonb
) returns jsonb language plpgsql security invoker set search_path=pg_catalog
as $$
declare c public.friday_work_claims%rowtype;
        w public.friday_work_items%rowtype;
        existing record;
        record_id uuid;
        payload_hash text;
        table_name text;
begin
 if record_kind not in ('checkpoint','handoff') or claim_id is null or run_id is null
   or length(run_id) not between 1 and 128 or request_id is null
   or length(request_id) not between 1 and 128 or expected_version is null
   or expected_version<1 or payload_json is null or jsonb_typeof(payload_json)<>'object'
   or octet_length(payload_json::text)>12000 then
   return jsonb_build_object('error','invalid-input');
 end if;
 table_name:=case record_kind when 'checkpoint' then 'friday_checkpoints' else 'friday_handoffs' end;
 select * into c from public.friday_work_claims as claim where claim.id=claim_id;
 if not found then return jsonb_build_object('error','not-found'); end if;
 select * into w from public.friday_work_items as item where item.id=c.work_item_id for update;
 if not found then return jsonb_build_object('error','not-found'); end if;
 select * into c from public.friday_work_claims as claim where claim.id=claim_id;
 payload_hash:=md5(payload_json::text);
 execute format('select id, work_item_id, claim_id, run_id, input_fingerprint, work_version from public.%I where principal_id=$1 and request_id=$2',table_name)
 into existing using c.principal_id, append_record.request_id;
 if existing.id is not null then
   if existing.work_item_id=w.id and existing.claim_id=c.id
     and existing.run_id=append_record.run_id and existing.input_fingerprint=payload_hash then
     return jsonb_build_object('status','appended','recordId',existing.id,
       'workVersion',existing.work_version);
   end if;
   return jsonb_build_object('error','idempotency-conflict');
 end if;
 if w.version<>expected_version then return jsonb_build_object('error','version-conflict'); end if;
 if w.active_claim_id is distinct from c.id or c.run_id<>append_record.run_id or c.released_at is not null then
   return jsonb_build_object('error','lease-conflict');
 end if;
 if c.expires_at<=now() then return jsonb_build_object('error','lease-expired'); end if;
 execute format('insert into public.%I(work_item_id,claim_id,run_id,principal_id,payload,work_version,request_id,input_fingerprint) values($1,$2,$3,$4,$5,$6,$7,$8) returning id',table_name)
 into record_id using w.id,c.id,append_record.run_id,c.principal_id,payload_json,w.version+1,append_record.request_id,payload_hash;
 update public.friday_work_items set version=version+1,updated_at=now() where id=w.id;
 return jsonb_build_object('status','appended','recordId',record_id,'workVersion',w.version+1);
end $$;

create function public.friday_append_checkpoint(
 claim_id uuid, run_id text, expected_version bigint, request_id text, payload_json jsonb
) returns jsonb language sql security invoker set search_path=pg_catalog
as $$ select friday_internal.append_record('checkpoint',$1,$2,$3,$4,$5); $$;
create function public.friday_append_handoff(
 claim_id uuid, run_id text, expected_version bigint, request_id text, payload_json jsonb
) returns jsonb language sql security invoker set search_path=pg_catalog
as $$ select friday_internal.append_record('handoff',$1,$2,$3,$4,$5); $$;

revoke all on function friday_internal.append_record(text,uuid,text,bigint,text,jsonb) from public,anon,authenticated;
revoke all on function public.friday_append_checkpoint(uuid,text,bigint,text,jsonb) from public,anon,authenticated;
revoke all on function public.friday_append_handoff(uuid,text,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function friday_internal.append_record(text,uuid,text,bigint,text,jsonb) to service_role;
grant execute on function public.friday_append_checkpoint(uuid,text,bigint,text,jsonb) to service_role;
grant execute on function public.friday_append_handoff(uuid,text,bigint,text,jsonb) to service_role;


-- Trusted server authorizes the reviewer; the database atomically seals review.
create function public.friday_review_decision(
 decision_id uuid, expected_version bigint, reviewer_id text, verdict text
) returns jsonb language plpgsql security invoker set search_path=pg_catalog
as $$
declare d public.friday_decisions%rowtype;
begin
 if expected_version is null or expected_version<1 or reviewer_id is null
    or length(reviewer_id) not between 1 and 128
    or verdict is null or verdict not in ('accepted','rejected') then
   return jsonb_build_object('error','invalid-input');
 end if;
 select * into d from public.friday_decisions where id=decision_id for update;
 if not found then return jsonb_build_object('error','not-found'); end if;
 if d.version<>expected_version then return jsonb_build_object('error','version-conflict'); end if;
 if d.state<>'proposed' then return jsonb_build_object('error','invalid-input'); end if;
 update public.friday_decisions set state=verdict,reviewer_principal=reviewer_id,
  reviewed_at=now(),version=version+1 where id=d.id;
 return jsonb_build_object('status',verdict,'version',d.version+1);
end $$;
revoke all on function public.friday_review_decision(uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.friday_review_decision(uuid,bigint,text,text) to service_role;