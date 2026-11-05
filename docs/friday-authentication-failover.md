# Friday authentication: Cloudflare Access, Authentik and break-glass login

Ported from PR #109 (`integration/friday-development-main-20261029`) and
corrected to match `main` as of 2026-11-05.

> **Status: proposal, not current production.** Making Authentik the primary
> human login is the backlog item `authentik-primary-login`, which is
> `needs-approval` (owner decision). Nothing in this document is applied to
> the live Cloudflare Access application, and this runbook does not authorize
> changes to Access applications, DNS/routing, VM120, production environment
> variables or deployment.

## What `main` does today

Friday's human-facing UI and `/api/*` sit behind a Cloudflare Access
self-hosted application. The origin verifies the signed
`Cf-Access-Jwt-Assertion` header itself; it never trusts unsigned identity
headers such as `Cf-Access-Authenticated-User-Email`.

- `server/security/access.mjs` (`createAccessGate`) fetches the team JWKS from
  `<FRIDAY_ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs`, requires RS256, an exact
  issuer equal to the team domain, the configured `FRIDAY_ACCESS_AUD`
  audience, a valid `exp`/`nbf` and a non-empty `sub`. Service-token JWTs
  (empty `sub`) are rejected on the human API.
- `server/config.mjs` turns origin verification on whenever
  `FRIDAY_MODE=live`. There is no separate enable flag. In live mode with a
  missing or malformed team domain or audience, protected APIs return
  **503** `access-verification-unavailable`; a missing or invalid JWT returns
  **403** `access-denied`.
- `server/http.mjs` leaves only `GET /healthz` and `GET /api/health` public.
- **Operator** status is granted only when the signed `email` claim is in
  `FRIDAY_ACCESS_OPERATOR_EMAILS`. The origin does **not** look at which
  identity provider issued the login or at any custom claim, so it cannot tell
  an Authentik login from a One-time PIN login.

Operator-only routes on `main` (`server/http.mjs`):

| Route | Notes |
| --- | --- |
| `POST /api/agents/registry/sync` | Also requires `Content-Type: application/json`. |
| `PUT /api/settings/sites` | Also requires JSON. |
| `POST`/`PUT`/`DELETE` under `/api/settings/endpoints` and `/api/settings/repositories` | JSON required except for `DELETE`. |
| `GET /api/audit/events` | Returns 503 `audit-not-enabled` unless the action audit is configured. |

Any verified identity (Viewer) may read `/api/overview`, `/api/agents` and
the other read routes, ask `POST /api/assistant`, and request
`POST /api/incidents/<id>/diagnostics/rerun`. Diagnostic reruns are **not**
operator-only on `main`; they re-run read-only checks. Every `POST`, `PUT`
or `DELETE` with `Sec-Fetch-Site: cross-site` is rejected with 403.

There is no second operator bearer token on `main`; operator routes rely on
the signed Access email allowlist alone.

The opt-in Authentik code on `main` (`server/security/authentik.mjs`, and the
default-off public login sites in `server/security/public-login-runtime.mjs`)
is **not** wired into this human login path. See `docs/authentik.md` and
`docs/authentik-public-sso.md`.

## Proposed normal login (needs owner approval)

The proposal keeps Cloudflare Access as the edge gate and makes Authentik the
identity provider behind it, using Cloudflare's Generic OIDC connector. No
Friday code change is needed; it is edge configuration only.

1. Create an Authentik OAuth2/OIDC application and provider for Friday.
   Register the exact Cloudflare callback URI
   `https://<team>.cloudflareaccess.com/cdn-cgi/access/callback` as a strict
   redirect URI. Select an asymmetric signing key and serve Authentik's public
   endpoints over HTTPS. Make sure the email claim is an Authentik-verified
   address.
2. In Cloudflare Zero Trust, add Authentik as a Generic OIDC identity provider
   using its discovery-document authorization, token and JWKS endpoints. Keep
   the client secret only in Cloudflare's IdP configuration. Enable PKCE if
   both sides support it.
3. Restrict the Friday Access application to the Authentik login method and
   attach an explicit least-privilege Allow policy (exact emails or verified
   Authentik groups). Never use Everyone or Bypass.
4. Optional, for edge auditing only: an Authentik scope mapping named
   `friday_access` returning `{"friday_auth_source": "authentik"}`, requested
   by the Cloudflare OIDC connector and added as a Cloudflare custom claim.
   Friday's origin ignores this claim; it is not used for roles.
   (`server/security/access-staging.test.mjs` only carries it in a synthetic
   token.)

Because the origin cannot tell identity providers apart, **break-glass
identities must use email addresses that are not in
`FRIDAY_ACCESS_OPERATOR_EMAILS`**. Keep operator accounts on the
Authentik-only policy.

Authentik's VM120 address is recorded as `10.1.60.10`. That does not prove
Cloudflare can reach its OIDC discovery, authorization, token and JWKS
endpoints; verify a trusted public HTTPS issuer first. Do not put Authentik's
own login endpoints behind the Friday Access application, which would create a
login loop.

Cloudflare Access does not detect an IdP outage and switch providers by
itself. If several login methods are enabled, users simply choose. That is why
the fallback below is enabled by hand only during a confirmed outage.

## Authentik outage procedure (proposal)

Use only after confirming from an external client that Authentik's OIDC
discovery or login endpoint is failing. A password, MFA, group or policy
rejection is not an outage.

1. Record the outage start time and confirm the fallback identity list.
2. In Cloudflare Zero Trust, enable One-time PIN and add it to Friday's
   allowed login methods. Keep the primary policy restricted to Authentik.
3. Attach a separate fallback Allow policy that includes only exact
   non-operator email addresses and requires the One-time PIN login method. No
   email domains, Everyone, Bypass, or any address from
   `FRIDAY_ACCESS_OPERATOR_EMAILS`.
4. Use the shortest supported session duration. Test with a staging fallback
   identity: it can read Friday but receives 403 on the operator-only routes
   listed above.
5. Record who activated the fallback and when. Never add fallback identities
   to `FRIDAY_ACCESS_OPERATOR_EMAILS` or bypass origin JWT validation.

## Recovery (proposal)

1. Confirm Authentik's HTTPS discovery, token and JWKS endpoints and complete
   a real Authentik login to staging.
2. Confirm the operator email is still in `FRIDAY_ACCESS_OPERATOR_EMAILS` and
   an operator-only route (for example `POST /api/agents/registry/sync`)
   succeeds.
3. Remove the fallback Allow policy and the One-time PIN method. Verify an OTP
   sign-in is denied and Authentik sign-in still works.
4. Record the recovery time. Existing fallback sessions can last until their
   application token expires; removing the policy is not instant revocation.

## Staging evidence still required

Automated, credential-free coverage on `main` lives in
`server/security/access-staging.test.mjs` (synthetic RSA keys, mocked JWKS):
anonymous and spoofed-header denial, wrong issuer/audience/expired/forged
tokens, Viewer reads and reruns, operator-only registry sync with JSON and
same-site requirements, a non-operator fallback email staying Viewer-only,
and 503 when live mode has no Access configuration.

Not yet proven, and needed before any rollout on the staging stack
(`deploy/staging/`, see `docs/cloudflare-friday-staging-vm100.md`):

- Normal login redirects to Authentik; an unlisted user is denied.
- With the fallback disabled, One-time PIN cannot reach Friday.
- During a simulated outage, the fallback works only for exact non-operator
  emails and gets 403 on every operator-only route.
- After recovery the fallback is disabled and Authentik works again.
- Anonymous direct-origin API requests stay denied.

References: [Authentik with Cloudflare Access](https://docs.goauthentik.io/integrations/services/cloudflare-access/),
[Authentik scope mappings](https://docs.goauthentik.io/add-secure-apps/providers/property-mappings/),
[Cloudflare Generic OIDC](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/generic-oidc/),
[Cloudflare One-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/),
[Cloudflare Access application tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/).
