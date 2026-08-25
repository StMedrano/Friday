create extension if not exists pgcrypto;

create table if not exists public.agents (
  id text primary key,
  name text not null,
  description text,
  enabled boolean not null default true,
  definition jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_versions (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null references public.agents(id) on delete cascade,
  version integer not null,
  definition jsonb not null,
  created_at timestamptz not null default now(),
  unique(agent_id, version)
);

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null references public.agents(id) on delete restrict,
  status text not null,
  request jsonb,
  result jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.agent_audit_events (
  id uuid primary key default gen_random_uuid(),
  agent_id text references public.agents(id) on delete set null,
  run_id uuid references public.agent_runs(id) on delete set null,
  event_type text not null,
  tool_name text,
  permission_mode text,
  payload jsonb,
  created_at timestamptz not null default now()
);

alter table public.agents enable row level security;
alter table public.agent_versions enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_audit_events enable row level security;

comment on table public.agents is 'Friday authoritative agent registry. Server-side access only until explicit user-facing RLS policies are designed.';
comment on column public.agents.definition is 'Portable Friday Agent Specification JSON document.';
