-- Disposable Postgres only. Never run against live Authentik or Supabase.
do $check_roles$
declare who text;
begin
 if not exists(select 1 from pg_tables where schemaname='friday_identity'
  and tablename='web_sessions' and rowsecurity) then
  raise exception 'private session RLS missing';
 end if;
 if not (select relforcerowsecurity from pg_class
  where oid='friday_identity.web_sessions'::regclass) then
  raise exception 'private session RLS must be forced';
 end if;
 foreach who in array array['anon','authenticated','service_role'] loop
  if has_schema_privilege(who,'friday_identity','USAGE') or
     has_table_privilege(who,'friday_identity.web_sessions','SELECT') or
     has_table_privilege(who,'friday_identity.web_sessions','INSERT') or
     has_table_privilege(who,'friday_identity.web_sessions','DELETE') then
   raise exception 'public/session service has privileges: %',who;
  end if;
 end loop;
 foreach who in array array['friday_family_login','friday_techtactics_login'] loop
  if not has_schema_privilege(who,'friday_identity','USAGE') or
     not has_table_privilege(who,'friday_identity.web_sessions','SELECT') or
     not has_table_privilege(who,'friday_identity.web_sessions','INSERT') or
     not has_table_privilege(who,'friday_identity.web_sessions','DELETE') or
     has_table_privilege(who,'friday_identity.web_sessions','UPDATE') or
     has_table_privilege(who,'friday_identity.web_sessions','TRUNCATE') then
    raise exception 'wrong login role table permissions: %',who;
  end if;
  if (select rolcanlogin from pg_roles where rolname=who) then
   raise exception 'role must require separate DBA-provisioned credentials: %',who;
  end if;
 end loop;
end
$check_roles$;

begin;
set local role friday_family_login;
insert into friday_identity.web_sessions(application_id,token_hash,subject,created_at_ms,expires_at_ms)
values('family',repeat('A',43),'authentik:0123456789abcdef:same-sub',1000,601000);
do $family$
declare count_rows int;
begin
 select count(*) into count_rows from friday_identity.web_sessions where application_id='family';
 if count_rows<>1 then raise exception 'family session missing';end if;
 begin
  insert into friday_identity.web_sessions(application_id,token_hash,subject,created_at_ms,expires_at_ms)
  values('techtactics',repeat('B',43),'authentik:0123456789abcdef:same-sub',1000,601000);
  raise exception 'Family inserted business session';
 exception when insufficient_privilege then null;
 end;
 begin
  insert into friday_identity.web_sessions(application_id,token_hash,subject,created_at_ms,expires_at_ms)
  values('family',repeat('B',43),'authentik:0123456789abcdef:same-sub',1000,7201000);
  raise exception 'overlong session persisted';
 exception when check_violation then null;
 end;
 begin
  insert into friday_identity.web_sessions(application_id,token_hash,subject,created_at_ms,expires_at_ms)
  values('family',repeat('C',43),'email@instead-of-issuer.test',1000,2000);
  raise exception 'unverified user subject persisted';
 exception when check_violation then null;
 end;
end
$family$;
set local role friday_techtactics_login;
insert into friday_identity.web_sessions(application_id,token_hash,subject,created_at_ms,expires_at_ms)
values('techtactics',repeat('A',43),'authentik:fedcba9876543210:same-sub',1000,601000);
do $business$
declare count_rows int;
begin
 select count(*) into count_rows from friday_identity.web_sessions;
 if count_rows<>1 then raise exception 'business role sees family sessions';end if;
 if exists(select 1 from friday_identity.web_sessions where application_id='family') then
  raise exception 'business can read family session';end if;
 delete from friday_identity.web_sessions where application_id='family';
 get diagnostics count_rows=row_count;
 if count_rows<>0 then raise exception 'business revoked family session';end if;
end
$business$;
set local role friday_family_login;
do $family_again$
declare count_rows int;
begin
 select count(*) into count_rows from friday_identity.web_sessions;
 if count_rows<>1 then raise exception 'family role sees business sessions';end if;
 delete from friday_identity.web_sessions where application_id='techtactics';
 get diagnostics count_rows=row_count;
 if count_rows<>0 then raise exception 'family revoked business session';end if;
 delete from friday_identity.web_sessions where application_id='family';
 get diagnostics count_rows=row_count;
 if count_rows<>1 then raise exception 'family could not revoke own session';end if;
end
$family_again$;
set local role friday_techtactics_login;
do $final$
declare count_rows int;
begin
 select count(*) into count_rows from friday_identity.web_sessions;
 if count_rows<>1 then raise exception 'family logout removed business session';end if;
end
$final$;
rollback;
