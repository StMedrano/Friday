# Two public-facing Authentik login sites: Family HomeLab and TechTactics

**Current status: proposed DNS/brands and tested source adapter only.**
No login hostname, public DNS record, Authentik Brand, OAuth provider,
real account or live controller configuration has been provisioned.
This source is default-disabled and is **not mounted** in Friday's
existing production `server/http.mjs` or `server/index.mjs`.

## Requested sign-in experience

| Separate experience | Family HomeLab | TechTactics |
|---|---|---|
| Identity purpose | Private family HomeLab, Friday, future family services | Staff, clients, business apps, future TechTactics websites |
| Login portal origin **(proposed)** | `https://family.mytechtactics.com` | `https://portal.mytechtactics.com` |
| Authentik-hosted branded sign-in **(proposed)** | `https://family-login.mytechtactics.com` | `https://login.mytechtactics.com` |
| Brand title | Family HomeLab | TechTactics |
| Authentik OAuth provider slug | `family` | `techtactics` |
| Example OIDC issuer | `https://family-login.mytechtactics.com/application/o/family/` | `https://login.mytechtactics.com/application/o/techtactics/` |
| Portal OIDC callback **(proposed)** | `https://family.mytechtactics.com/auth/oidc/callback` | `https://portal.mytechtactics.com/auth/oidc/callback` |
| Minimum admission policy | Owner-invited family members only | Explicitly provisioned business staff/clients |
| MFA policy | Strong MFA mandatory for adults and all admin functions | MFA mandatory for staff; role-specific policy for clients |
| Application permissions | Family/member/operator permissions **separately reviewed** | Independent employee/customer/admin business roles |
| HomeLab control authority | No authority from public login alone: separate audited P8 authorization | **None** |

These URLs are **proposals only**. Confirm actual ownership and intended
DNS names before setting records, TLS, tunnels or redirect registrations.
Neither login site's public page is an interface to Docker, Proxmox,
Friday's private automation API, Omada or any infrastructure mutation.

## Architecture

```text
                           Internet / mobile users
                                    |
                 +------------------+------------------+
                 |                                     |
     Family HomeLab portal                    TechTactics portal
     family.mytechtactics.com                 portal.mytechtactics.com
                 |                                     |
        OIDC authorization                    OIDC authorization
                 |                                     |
     family-login.mytechtactics.com           login.mytechtactics.com
        Authentik Family Brand                  Authentik Business Brand
              (HTTPS)                                (HTTPS)
                 |                                     |
       family OAuth provider                    techtactics OAuth provider
       family-only membership                     business-only policy
                 |                                     |
       Family session / roles                   Business session / roles
                 |                                     |
           Friday family UI                    TechTactics / future sites
```

authentik **Brands** allow independent logo/title/favicon/flow based
on login hostname, as documented at
https://docs.goauthentik.io/customize/branding/ .
A Brand is **not a tenant boundary**. In one Authentik deployment,
users, providers, applications and administrative control may remain
shared. Separate application access policies, groups, exact OIDC
clients/issuers/callbacks, and per-site sessions are mandatory. If
stronger legal/administrative separation is required, plan **separate
identity deployments** rather than assuming brand isolation.

## Test-first application source

`server/security/login-sites.mjs` implements exactly two explicit
`family` and `techtactics` login entry sites, only when a trusted
server injects a matching Site + Browser configuration. Both render
distinct accessible, responsive HTML/CSS experiences:

- `GET /login` — display the selected site's branding and login link.
- `GET /auth/start` — call that site's own OIDC/PKCE browser adapter,
  issue only that site's `__Host-` login-state cookie, and redirect
  strictly to the **registered** Authentik identity hostname.
- `GET /auth/oidc/callback` — verify exact code/state inputs with the
  initiating browser cookie via that site's browser adapter, then issue
  the site's own session cookie and redirect to `/account`.
- `GET /account` — require only that site's opaque verified session;
  render a signed-in state with an exact-site CSRF synchronizer.
- `POST /auth/logout` — require exact Origin, session and CSRF token;
  revoke only that site's session and clear its two cookies.
- `GET /auth/portal.css` — static responsive CSS; no browser scripts,
  trackers, tokens, dynamic URLs or credential-filled HTML.

The module uses an exact application/origin registry and rejects
unrecognized hosts, cross-site callbacks/cookies, unexpected redirects,
malformed callback parameters, GET logout, and invalid or disabled
configuration. It does **not** accept tenant choice via spoofable role,
user-email or forwarded headers. Its input `origin` must come from
trusted server configuration and validated HTTPS ingress, **not**
untrusted request Host or arbitrary X-Forwarded-* headers.

It composes with existing `createPublicOidcFlow` and
`createPublicOidcBrowser` using **separately configured Authentik
issuers per portal**. Synthetic integration tests sign separate
RS256-backed ID tokens, proving that the *same raw Authentik sub* on
different issuers has different issuer-scoped subjects and never
grants a session to the other portal. Family sessions must never
grant business roles, and business sessions never HomeLab access.

## Real Authentik configuration required before deployment

1. Decide whether both sign-in hostnames use one hardened, patched
   Authentik instance with two Brands and strict policies, or two
   independent Authentik instances for stronger administrative
   isolation. The current source can support two distinct issuers; it
   does **not** create or secure either deployment.
2. Configure Authentik Admin → **System → Brands** with exact family
   and business login domains, separate title/logos/favicon and
   appropriate MFA/recovery flows. Review brand default application.
3. Create a different **OAuth2/OIDC provider and application** for
   Family and TechTactics: separate confidential Client IDs/secrets,
   provider slugs, RS256 signing key, exact **strict** callback URIs,
   per-app scope and application permission policy. Do not permit
   wildcard or learn-first redirect values.
4. Add distinct Family and Business groups and explicit per-app
   access policies. Never infer authorization from Brand/domain
   alone. No public signup into Family Admin, no client self-service
   elevation into TechTactics Admin, no cross-realm role defaults.
5. Apply TLS, reviewed public Cloudflare routing/reverse-proxy
   headers, login rate limits, MFA, recovery and backups. Browser
   redirect, authorize/token/JWKS paths must be available without
   requiring an unrelated Cloudflare Access identity; keep higher
   safeguards for sensitive Friday/HomeLab endpoints.
6. Build/approve independently **atomic shared login-state and
   session backends** with cleanup, then explicitly mount separate
   HTTPS site handlers. Do not use ephemeral test fixture Map stores.
7. Validate external/mobile sign-in, family invitation, business
   employee/client sign-in, cross-site denial, signing-key rotation,
   revoked account/session, logout, MFA and service failure.
   Preserve the existing Friday production login until reviewed
   external-site acceptance is completed.

### Security and release limits

This slice **does not deploy** public websites, enable Authentik,
create users/groups, grant HomeLab tools, merge branches, or contact
VM120, VM102, network appliances or Cloudflare. No real credential
or signing key is committed. Its pure route module is intentionally
not wired into an actual HTTP listener. A separate release PR and
staging cutover review are required.
