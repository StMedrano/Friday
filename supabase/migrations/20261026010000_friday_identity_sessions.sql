-- Friday public Authentik website-session storage; SOURCE-ONLY, NOT DEPLOYED.
-- Owner review required before applying to Supabase or another PostgreSQL DB.
-- Completely independent of HomeLab action audit, AI agents and admin rights.
-- A dedicated non-login role is intentional; provision a separate LOGIN role
-- and restricted membership via a secret manager only after security review.
-- DO NOT grant this role to anon, authenticated, service_role or a browser.
begin;

do $roles$
begin
 if not exists(select 1 from pg_roles where rolname='friday_sso_server') then
  create role friday_sso_server nologin;
 end if;
end
$roles$;

create schema if not exists friday_identity;
revoke all on schema friday_identity from public;
-- Supabase default roles are expected; migrations are reviewed as a unit.
revoke all on schema friday_identity from anon,authenticated,service_role;
grant usage on schema friday_identity to friday_sso_server;

create table if not exists friday_identity.web_sessions (
 application_id text not null
  check (application_id in ('family','techtactics')),
 token_hash text not null
  check (token_hash ~ '^[A-Za-z0-9_-]{43}$'),
 subject text not null
  check (subject ~ '^authentik:[a-f0-9]{16}:[A-Za-z0-9][A-Za-z0-9._:@/-]{0,190}$'),
 created_at_ms bigint not null check (created_at_ms>=0),
 expires_at_ms bigint not null
  check (expires_at_ms>created_at_ms
    and expires_at_ms-created_at_ms<=3600000),
 primary key (application_id,token_hash)
);
create index if not exists friday_web_sessions_expiry
 on friday_identity.web_sessions(application_id,expires_at_ms);
create index if not exists friday_web_sessions_account_revoke
 on friday_identity.web_sessions(application_id,subject);

alter table friday_identity.web_sessions enable row level security;
alter table friday_identity.web_sessions force row level security;
revoke all on friday_identity.web_sessions from public,anon,authenticated,service_role;
revoke all on friday_identity.web_sessions from friday_sso_server;
grant select,insert,delete on friday_identity.web_sessions to friday_sso_server;
-- Intentionally NO update/grants for any browser or general service role.
create policy friday_sso_select on friday_identity.web_sessions
 for select to friday_sso_server using (true);
create policy friday_sso_insert on friday_identity.web_sessions
 for insert to friday_sso_server with check (true);
create policy friday_sso_delete on friday_identity.web_sessions
 for delete to friday_sso_server using (true);

commit;
