-- Only for the offline ephemeral PostgreSQL runner (not live database).
do $checks$
declare role_name text;
begin
 if not (select relrowsecurity and relforcerowsecurity
   from pg_class where oid='friday_identity.oidc_transactions'::regclass)
  then raise exception 'OIDC state RLS not forced'; end if;
 foreach role_name in array array['anon','authenticated','service_role'] loop
  if has_schema_privilege(role_name,'friday_identity','USAGE') or
     has_table_privilege(role_name,'friday_identity.oidc_transactions','SELECT') or
     has_table_privilege(role_name,'friday_identity.oidc_transactions','INSERT') or
     has_table_privilege(role_name,'friday_identity.oidc_transactions','DELETE')
  then raise exception 'public role granted PKCE access: %', role_name; end if;
 end loop;
 foreach role_name in array array['friday_family_login','friday_techtactics_login'] loop
  if not has_table_privilege(role_name,'friday_identity.oidc_transactions','SELECT') or
     not has_table_privilege(role_name,'friday_identity.oidc_transactions','INSERT') or
     not has_table_privilege(role_name,'friday_identity.oidc_transactions','DELETE') or
     has_table_privilege(role_name,'friday_identity.oidc_transactions','UPDATE') or
     has_table_privilege(role_name,'friday_identity.oidc_transactions','TRUNCATE')
  then raise exception 'wrong OIDC role permissions: %',role_name; end if;
 end loop;
end
$checks$;

begin;
set local role friday_family_login;
insert into friday_identity.oidc_transactions(
 application_id,state_hash,iv,tag,ciphertext,issued_at_ms,expires_at_ms)
values ('family',repeat('a',64),repeat('A',16),repeat('B',22),repeat('C',64),1000,301000);
do $family$
declare count_rows integer;
begin
 begin
  insert into friday_identity.oidc_transactions(
   application_id,state_hash,iv,tag,ciphertext,issued_at_ms,expires_at_ms)
  values ('techtactics',repeat('b',64),repeat('A',16),repeat('B',22),repeat('C',64),1000,301000);
  raise exception 'family inserted business OIDC transaction';
 exception when insufficient_privilege then null;
 end;
 begin
  insert into friday_identity.oidc_transactions(
   application_id,state_hash,iv,tag,ciphertext,issued_at_ms,expires_at_ms)
  values ('family',repeat('c',64),repeat('A',16),repeat('B',22),repeat('C',64),1000,601000);
  raise exception 'overlong PKCE state lifetime';
 exception when check_violation then null;
 end;
 select count(*) into count_rows from friday_identity.oidc_transactions;
 if count_rows<>1 then raise exception 'family missing own OIDC state';end if;
end
$family$;
set local role friday_techtactics_login;
insert into friday_identity.oidc_transactions(
 application_id,state_hash,iv,tag,ciphertext,issued_at_ms,expires_at_ms)
values ('techtactics',repeat('a',64),repeat('A',16),repeat('B',22),repeat('C',64),1000,301000);
do $business$
declare count_rows integer;
begin
 select count(*) into count_rows from friday_identity.oidc_transactions;
 if count_rows<>1 then raise exception 'business can read family OIDC states';end if;
 delete from friday_identity.oidc_transactions
  where application_id='family' and state_hash=repeat('a',64);
 get diagnostics count_rows=row_count;
 if count_rows<>0 then raise exception 'business removed family state';end if;
end
$business$;
set local role friday_family_login;
do $family_end$
declare count_rows integer;
begin
 select count(*) into count_rows from friday_identity.oidc_transactions;
 if count_rows<>1 then raise exception 'family can read business state';end if;
 delete from friday_identity.oidc_transactions
  where application_id='family' and state_hash=repeat('a',64)
  returning 1 into count_rows;
 if count_rows<>1 then raise exception 'first consumed state failed';end if;
 delete from friday_identity.oidc_transactions
  where application_id='family' and state_hash=repeat('a',64)
  returning 1 into count_rows;
 if found then raise exception 'state replay succeeded';end if;
end
$family_end$;
set local role friday_techtactics_login;
do $business_end$
declare count_rows integer;
begin
 select count(*) into count_rows from friday_identity.oidc_transactions;
 if count_rows<>1 then raise exception 'family consume removed business state';end if;
end
$business_end$;
rollback;
