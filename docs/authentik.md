# Authentik identity integration — source-only P8 foundation

**Not a production login or deployment guide.** Draft PR #58 implements a
strict, default-disabled **server-owned**, internally injected Authentik
JWT verification gate for Friday's dormant HomeLab approval fixtures. It does
not change the existing Cloudflare Access identity for the running Friday UI
or create a cookie, callback route, public API, provider client, secret,
registration endpoint or infrastructure executor.

## Authentik architecture

1. Create an Authentik **OAuth2/OpenID Connect provider**, associate it with
   a Friday application slug (example: `friday`), and use the default
   **per-provider issuer** mode. The expected issuer has the shape
   `https://identity.example.test/application/o/friday/`. Do not use
   Authentik's optional global issuer mode for this adapter.
2. Select an **asymmetric RS256 certificate signing key**. An Authentik
   provider without a signing key may use **HS256**, deliberately unsupported
   by Friday's JWKS verifier. Rotate keys using the issuer's JWKS endpoint.
3. Create a restricted **`friday_control` scope mapping** for access tokens
   that Friday's future internal gateway will accept. This scope alone is
   **not authorization**: actual Viewer/Operator/Administrator/Friday Agent
   rights remain in Friday's independent owner-private exact-role policy.
   Scope, issuer, audience and verified token signature must all match.
4. Register a distinct confidential client ID intended for Friday. The
   adapter pins `clientId` to the JWT audience (and `azp` when supplied).
   Provision no real secrets to these fixtures. Never pass a client secret,
   signing private key, refresh token or live JWT to GitHub, a model, a
   browser-side `VITE_*` variable or a source file.
5. Exact OIDC discovery and signing-key URLs:
   - `<issuer>.well-known/openid-configuration`
   - `<issuer>jwks/`

   The server reads discovery from the configured HTTPS issuer and rejects
   metadata whose `issuer` or `jwks_uri` does not match the pinned URLs.
   It does not fetch redirects or arbitrary JWKS addresses.
6. Configure Authentik user MFA, lifecycle, enrollment and offboarding
   independently, and restrict the Friday application to intended users.
   Group/email claims do **not** directly grant Friday actions.

Source: Authentik official OAuth2 provider documentation:
https://docs.goauthentik.io/add-secure-apps/providers/oauth2/

## Internal adapter usage (not a production bootstrap)

`createAuthentikAccessGate({enabled:true,issuer,clientId})` verifies a
dedicated short-lived RSA-signed bearer JWT, requiring:
- expected exact per-application issuer, client audience, stable `sub`;
- signed `friday_control` scope, expiration, valid `iat` and `nbf`;
- a bounded 15-minute maximum signed token lifetime, and an exact pinned JWKS;
- a **human** subject, not a service JWT. No unsigned, HS256 or ID-token
  key-binding bypass.

The result uses a stable issuer-specific subject namespace:
`authentik:<issuer-hash>:<sub>`. An owner must deliberately map that exact
subject through the **owner-private file role policy** using
`authentikRoleSubject({issuer,sub})`. Identical emails or `sub` strings
from another identity provider never inherit Cloudflare roles.

`createDormantHomeLabRuntime` accepts server-supplied
`identityProvider:'authentik'` and an Authentik config **only when explicitly
enabled in internal tests**. This is exclusive with Cloudflare Access:
there is no automatic login fallback and no request-selectable provider.
It still requires an unexpired owner-private role file, audit store and
five-minute arm file. It only references **unbound `staging-canary`**,
persists non-executing human approval decisions and returns
`execution.performed:false`. A verified JWT expiring during an async
operation aborts before status/report or model output.

## Required before real Authentik SSO

- Implement and separately review a **server-side OAuth2 authorization
  code + PKCE** flow with exact redirect URI, state, nonce, token exchange,
  session rotation, CSRF defenses, HttpOnly + Secure + SameSite cookies and
  redirect allowlisting. A signed access token verifier is **not a web login**.
- Select the trusted Cloudflare/Authentik layering and external URL.
  Avoid letting either header or browser-supplied identity override the
  chosen verification path.
- Integrate authorized UI/HTTP access only after identity/session, least
  privilege, revocation, audit, request/action policy and kill switch are
  independently reviewed. Avoid access-token storage in localStorage.
- Validate Authentik's actual `scope`, `aud`, `iss`, `sub` and
  signing-key behavior against the configured **test provider**, since
  no live Authentik instance was contacted for this source-only work.
- Publish a separate operator runbook for key rotation, account disable,
  emergency disarm, trust-chain failover, backups, TLS and recovery.
  No real HomeLab mutation is authorized here.
