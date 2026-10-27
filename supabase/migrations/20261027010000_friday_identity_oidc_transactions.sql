-- Source-only; DO NOT apply to live Supabase without a separate reviewed rollout.
-- Requires 20261026010000_friday_identity_sessions.sql first.
-- Encrypted five-minute PKCE transactions for two wholly separate web logins.
begin;

create table if not exists friday_identity.oidc_transactions (
 application_id text not null check (application_id in ('family','techtactics')),
 state_hash text not null check (state_hash ~ '^[a-f0-9]{64}$'),
 iv text not null check (iv ~ '^[A-Za-z0-9_-]{16}$'),
 tag text not null check (tag ~ '^[A-Za-z0-9_-]{22}$'),
 ciphertext text not null check (
  char_length(ciphertext) between 43 and 4096 and
  ciphertext ~ '^[A-Za-z0-9_-]+$'),
 issued_at_ms bigint not null check (issued_at_ms>=0),
 expires_at_ms bigint not null check (
  expires_at_ms-issued_at_ms=300000
 ),
 primary key (application_id,state_hash)
);
create index if not exists friday_oidc_transactions_expiry
 on friday_identity.oidc_transactions(application_id,expires_at_ms);

alter table friday_identity.oidc_transactions enable row level security;
alter table friday_identity.oidc_transactions force row level security;

revoke all on friday_identity.oidc_transactions
 from public,anon,authenticated,service_role,
      friday_family_login,friday_techtactics_login;
grant select,insert,delete on friday_identity.oidc_transactions
 to friday_family_login,friday_techtactics_login;
-- Row access is explicitly scoped to the receiving site's DB principal.
-- Authentication state is never exposed to browser/API default DB roles.
create policy friday_family_oidc_select on friday_identity.oidc_transactions
 for select to friday_family_login using (application_id='family');
create policy friday_family_oidc_insert on friday_identity.oidc_transactions
 for insert to friday_family_login with check (application_id='family');
create policy friday_family_oidc_delete on friday_identity.oidc_transactions
 for delete to friday_family_login using (application_id='family');

create policy friday_techtactics_oidc_select on friday_identity.oidc_transactions
 for select to friday_techtactics_login using (application_id='techtactics');
create policy friday_techtactics_oidc_insert on friday_identity.oidc_transactions
 for insert to friday_techtactics_login with check (application_id='techtactics');
create policy friday_techtactics_oidc_delete on friday_identity.oidc_transactions
 for delete to friday_techtactics_login using (application_id='techtactics');

commit;
