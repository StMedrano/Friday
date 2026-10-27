-- Run ONLY inside scripts/test-shared-work-postgres.sh disposable database.
-- Migration should be safe for independently managed public Family and
-- TechTactics browsers without exposing their sessions to Supabase API roles.
do $checks$
declare
 private_oid oid;
begin
 select c.oid into private_oid
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='friday_identity' and c.relname='web_sessions';
 if private_oid is null then raise exception 'missing private web sessions';end if;
 if not (select relrowsecurity and relforcerowsecurity
   from pg_class where oid=private_oid) then
  raise exception 'sessions RLS must be enabled and forced';
 end if;
 foreach private_oid in array array[private_oid] loop
  if has_table_privilege('anon',private_oid,'SELECT') or
     has_table_privilege('authenticated',private_oid,'SELECT') or
     has_table_privilege('service_role',private_oid,'SELECT') or
     has_table_privilege('service_role',private_oid,'INSERT') or
     has_table_privilege('service_role',private_oid,'DELETE') or
     has_table_privilege('friday_sso_server',private_oid,'UPDATE') or
     has_table_privilege('friday_sso_server',private_oid,'TRUNCATE') or
     not has_table_privilege('friday_sso_server',private_oid,'SELECT') or
     not has_table_privilege('friday_sso_server',private_oid,'INSERT') or
     not has_table_privilege('friday_sso_server',private_oid,'DELETE') then
    raise exception 'bad least-privilege session table grants';
  end if;
 end loop;
 if has_schema_privilege('anon','friday_identity','USAGE') or
    has_schema_privilege('authenticated','friday_identity','USAGE') or
    has_schema_privilege('service_role','friday_identity','USAGE') or
    not has_schema_privilege('friday_sso_server','friday_identity','USAGE') then
  raise exception 'public session schema access wrong';
 end if;
 if (select rolcanlogin from pg_roles where rolname='friday_sso_server') then
  raise exception 'dedicated session group role must not log in';
 end if;
end
$checks$;

begin;
set local role friday_sso_server;
do $session_tests$
declare
 t text:='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
 timestamp_ms bigint:=(extract(epoch from clock_timestamp())*1000)::bigint;
 inserted integer;
 family_count integer;
 business_count integer;
begin
 insert into friday_identity.web_sessions(application_id,token_hash,subject,created_at_ms,expires_at_ms)
 values('family',t,'authentik:0123456789abcdef:same-sub',timestamp_ms,timestamp_ms+600000);
 insert into friday_identity.web_sessions(application_id,token_hash,subject,created_at_ms,expires_at_ms)
 values('techtactics',t,'authentik:fedcba9876543210:same-sub',timestamp_ms,timestamp_ms+600000);

 select count(*) into family_count from friday_identity.web_sessions
 where application_id='family' and token_hash=t and expires_at_ms>timestamp_ms;
 select count(*) into business_count from friday_identity.web_sessions
 where application_id='techtactics' and token_hash=t and expires_at_ms>timestamp_ms;
 if family_count<>1 or business_count<>1 then
  raise exception 'cross-website inserts not isolated';
 end if;

 insert into friday_identity.web_sessions(application_id,token_hash,subject,created_at_ms,expires_at_ms)
 values('family',t,'authentik:0123456789abcdef:same-sub',timestamp_ms,timestamp_ms+600000)
 on conflict do nothing;
 get diagnostics inserted=row_count;
 if inserted<>0 then raise exception 'replay insertion accepted';end if;

 delete from friday_identity.web_sessions where application_id='family' and token_hash=t;
 get diagnostics inserted=row_count;
 if inserted<>1 then raise exception 'family revocation not atomic';end if;
 select count(*) into business_count from friday_identity.web_sessions
 where application_id='techtactics' and token_hash=t;
 if business_count<>1 then raise exception 'family logout revoked business';end if;

 begin
  insert into friday_identity.web_sessions(application_id,token_hash,subject,created_at_ms,expires_at_ms)
  values('family','BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    'authentik:0123456789abcdef:same-sub',timestamp_ms,timestamp_ms+7200000);
  raise exception 'overlong session was accepted';
 exception when check_violation then null;
 end;
 begin
  insert into friday_identity.web_sessions(application_id,token_hash,subject,created_at_ms,expires_at_ms)
  values('third-site','CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
    'authentik:0123456789abcdef:same-sub',timestamp_ms,timestamp_ms+100000);
  raise exception 'unknown website session accepted';
 exception when check_violation then null;
 end;
 begin
  insert into friday_identity.web_sessions(application_id,token_hash,subject,created_at_ms,expires_at_ms)
  values('family','DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
    'authentik:0123456789abcdef:same-sub',timestamp_ms,timestamp_ms+100000);
  raise exception 'browser raw token accepted';
 exception when check_violation then null;
 end;
end
$session_tests$;
rollback;
