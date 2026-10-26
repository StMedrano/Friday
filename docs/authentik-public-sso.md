# Public Authentik identity hub for Friday and future sites

**Design plus source-only OIDC login contract, not a deployed login service.**
Draft PR #60 adds a reusable, server-only authorization-code + PKCE flow
for multiple public applications. It is not yet mounted as a route or used
to authenticate Friday's production UI.

## Public architecture

Public browsers should access a stable HTTPS Authentik hostname, e.g.
**proposed** `https://login.mytechtactics.com` (final host to be confirmed).
Public website hosts (e.g. Friday `https://friday.mytechtactics.com`
and future TechTactics/customer domains) redirect users to Authentik,
which authenticates them with MFA/policy and redirects to each site's
**exact HTTPS callback**. All registered apps can share an Authentik
account/session at the identity host, but each website retains independent
client credentials, issuer/slug, cookie session and permission rules.
A successful public login does **not** authorize VM102 administration,
Docker, HomeLab actions, Friday agent tools or other websites.

The Authentik identity node planned on VM120 should be a separately secured
service, reached from the internet via a reviewed HTTPS ingress path (e.g.
a Cloudflare Tunnel to an HTTPS reverse proxy), **not** by publishing its
database, Redis, admin SSH, Docker socket or host network ports. VM120's
actual running Authentik deployment, FQDN, ingress, certificates and backups
have not been checked by this pull request. Do not change VLANs or
provision tunneling/ports by merging this source alone.

### Routes and security boundaries

- **Public identity host**: browser-facing Authentik login and OIDC
  authorize/token/discovery/JWKS endpoints. Do not put a mandatory
  Cloudflare Access application challenge *in front of* the Authentik
  identity origin; doing so can break redirects for customers without
  Cloudflare accounts. Instead use Authentik's login MFA and enrollment
  controls, reverse-proxy/WAF rate limiting and scoped bot rules.
  Discovery/JWKS/token server-to-server traffic must not be interrupted
  by interactive challenges.
- **Friday**: a confidential OIDC client, per-provider Authentik issuer
  `<identity-origin>/application/o/friday/`, exact callback
  `https://friday.mytechtactics.com/auth/oidc/callback` (proposed and
  not currently mounted). Keep the existing Cloudflare Access production
  gate until native Authentik sessions are reviewed and explicitly
  cut over. For private Admin/HomeLab functions, use a stricter and
  independent authorization policy, signed identity, audits, approvals
  and the kill switch.
- **TechTactics and future customer websites**: register a **new**
  Authentik application/provider for each site, unique client ID and
  secret, exact callback, intended group/access policy, and separate
  per-site sessions. No customer role may default to Friday Admin.
  Cross-domain sites are supported: an OIDC redirect can return to
  a different permitted HTTPS domain while the user signs into the same
  central Authentik identity service.
- **Legacy applications** without OIDC: use Authentik's *single-application*
  proxy/forward-auth provider through a trusted reverse proxy or outpost,
  with individual application access policies. Avoid broad domain-level
  forward auth where individual sites need separate authorization rules.

## Reusable source contract

`createPublicOidcFlow` under `server/security/public-oidc.mjs`
accepts **trusted server-only** configuration:
```js
{
  enabled: true, // NOT wired to runtime or environment; no production bootstrap
  identityOrigin: 'https://login.example.test',
  applications: [
    {
      id: 'friday',
      slug: 'friday',
      clientId: 'friday-web',
      clientSecret: '<server-managed secret>',
      redirectUri: 'https://friday.example.test/auth/oidc/callback',
    },
    {
      id: 'site',
      slug: 'other-app',
      clientId: 'other-site-web',
      clientSecret: '<different server-managed secret>',
      redirectUri: 'https://site.example.test/auth/oidc/callback',
    },
  ],
}
```
This configuration is illustrative. **Do not commit real secrets.**
Disable by default. Each application uses a unique Authentik
per-provider issuer based on the slug. The module creates a random
PKCE verifier/S256 challenge, state, nonce and *five-minute* login
transaction, then builds an authorize redirect with exact app-registered
redirect URI and `openid profile email` scopes.

A caller must implement an **atomic one-use shared transaction store**
with `reserve(record)` and `consume(state)` methods. The store must
protect secrets at rest, enforce TTL, reject collisions, and atomically
consume state across all app replicas. No in-memory production store
is supplied, to avoid suggesting that process-local state is durable.
The callback first consumes state, rejects cross-app/mismatched/expired
transactions, checks exact provider discovery, exchanges the code
server-to-server with confidential client credentials and PKCE, then
verifies the **RS256 signed ID token**, `iss`, `aud`, `azp`, `sub`,
`nonce`, `iat`, `nbf`, and `exp` against the per-app public JWKS.
Only a normalized issuer-scoped subject and expiry are returned.
No ID/access/refresh tokens, raw claims, authorization codes, secret,
login state or verifier are returned from this module.

**The normal website-login scopes never grant `friday_control`.**
That high-trust HomeLab scope and separately maintained exact-role policy
belong exclusively to the internal authorization boundary.

## Before a real public Friday / multi-site login is ready

1. Deploy and test a reachable, patched, backed-up Authentik service.
   Verify TLS, DNS, Cloudflare Tunnel/proxy headers/trusted proxy CIDRs,
   Host, forwarded HTTPS scheme, CSRF origins and WebSocket upgrades.
   Restrict the admin console and enforce strong MFA, recovery and
   account lifecycle workflows. Define public signup versus invitation
   policies separately per application.
2. Register each application's **strict literal redirect URI** in the
   Authentik OAuth2/OIDC provider; leave no blank/learn-first URI,
   unsafe wildcard or catch-all redirect, and use confidential
   server-side clients with a real RS256 signing key.
3. Provide the confidential secrets **only to the corresponding
   application backend** via managed secrets, never `VITE_*`,
   source files, query strings, logs, localStorage or the browser.
4. Implement HTTPS routes `/auth/login` and `/auth/oidc/callback`
   **per site**, with HttpOnly + Secure + SameSite cookies,
   rotation and revocation of site-local sessions, CSRF/origin
   protections, callback method validation, browser-safe error responses,
   state cookie binding, session storage, and no-store/no-referrer
   policies. This PR intentionally adds no route or cookie/session.
5. Complete a provider interoperability exercise using real **test**
   discovery, authorize, token and ID token payloads, testing
   OAuth error callbacks, browser privacy and mobile logins,
   remote networks, logout, account disable, session timeout,
   phishing-resistant MFA and break-glass recovery.
6. Review whether Friday should remain behind Cloudflare Access as
   an **additional** enforcement layer for privileged paths while
   allowing public Authentik login for normal users. Avoid a recursive
   login loop or accidental unauthenticated bypass.
7. Deploy one low-risk public pilot, run owner/security acceptance,
   then add further sites using isolated providers and policies.

### References
- Authentik OAuth2/OIDC:
  https://docs.goauthentik.io/add-secure-apps/providers/oauth2/
- Authentik reverse-proxy headers:
  https://docs.goauthentik.io/install-config/reverse-proxy/
- Authentik forward auth:
  https://docs.goauthentik.io/add-secure-apps/providers/proxy/forward_auth/
