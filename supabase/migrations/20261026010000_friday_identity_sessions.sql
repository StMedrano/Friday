-- Friday public Authentik website sessions; SOURCE-ONLY, NEVER AUTO-DEPLOY.
-- Separate PostgreSQL NOLOGIN roles for Family vs TechTactics. A production
-- DBA must bind each portal's separate LOGIN principal to only its
-- matching NOLOGIN group, with secrets provisioned outside this repository.
-- Never attach these roles to anon, authenticated, service_role or agents.
begin;

do $roles$
begin
 if not exists(select 1 from pg_roles where rolname='friday_family_login') then
  create role friday_family_login nologin;
 end if;
 if not exists(select 1 from pg_roles where rolname='friday_techtactics_login') then
  create role friday_techtactics_login nologin;
 end if;
end
$roles$;

create schema if not exists friday_identity;
revoke all on schema friday_identity from public,anon,authenticated,service_role;
grant usage on schema friday_identity to friday_family_login,friday_techtactics_login;

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
revoke all on friday_identity.web_sessions from friday_family_login,friday_techtactics_login;
grant select,insert,delete on friday_identity.web_sessions
 to friday_family_login,friday_techtactics_login;
-- RLS is defense in depth beyond each server's immutable application ID.
-- There is no UPDATE, TRUNCATE, wildcard site policy or HomeLab capability.
create policy friday_family_select on friday_identity.web_sessions
 for select to friday_family_login using (application_id='family');
create policy friday_family_insert on friday_identity.web_sessions
 for insert to friday_family_login with check (application_id='family');
create policy friday_family_delete on friday_identity.web_sessions
 for delete to friday_family_login using (application_id='family');
create policy friday_techtactics_select on friday_identity.web_sessions
 for select to friday_techtactics_login using (application_id='techtactics');
create policy friday_techtactics_insert on friday_identity.web_sessions
 for insert to friday_techtactics_login with check (application_id='techtactics');
create policy friday_techtactics_delete on friday_identity.web_sessions
 for delete to friday_techtactics_login using (application_id='techtactics');

commit;
