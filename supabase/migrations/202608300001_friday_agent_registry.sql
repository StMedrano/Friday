create table if not exists public.friday_agents (
  id text primary key,
  name text not null,
  description text not null default '',
  spec_version text not null,
  source_path text not null,
  source_checksum text not null,
  enabled boolean not null default true,
  model_profile text not null,
  scope_json jsonb not null default '{}'::jsonb,
  tools_json jsonb not null default '[]'::jsonb,
  permissions_json jsonb not null default '{}'::jsonb,
  instructions_json jsonb not null default '[]'::jsonb,
  synced_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.friday_agent_registry_state (
  id text primary key,
  last_sync_at timestamptz,
  last_sync_status text not null default 'never',
  source_commit text,
  agents_seen integer not null default 0,
  agents_synced integer not null default 0,
  agents_rejected integer not null default 0,
  error_summary jsonb not null default '[]'::jsonb
);
