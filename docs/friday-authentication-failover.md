# Friday authentication: Authentik login, Cloudflare break-glass

> **Status on `main` (2026-11-05):** this is a runbook for a change the owner
> has not approved yet (`authentik-primary-login` in
> `docs/automation/BACKLOG.md`). Today Cloudflare Access is the only login
> path. Ported from PR #109's branch and checked against `main`; the
> Friday-side behaviour it relies on is already on `main` and covered by
> `server/security/access-staging.test.mjs`.

Friday sits behind a Cloudflare Access application and verifies Access's
signed `Cf-Access-Jwt-Assertion` header at the origin
(`server/security/access.mjs`). The plan is to make Authentik the normal human
login provider *inside* Cloudflare Access (as a Generic OIDC identity
provider), and to keep Cloudflare One-time PIN as an emergency provider that is
enabled for the Friday application only during a confirmed Authentik outage.

Nothing in Friday's code changes for this. Which identity provider a person
used is decided at the Cloudflare edge; the origin only checks the signed
Access JWT. Friday's own Authentik verifier (`server/security/authentik.mjs`,
`docs/authentik.md`) is a separate, opt-in gate for the `friday_control`
scope and is not part of this login path.

Cloudflare Access supports several identity providers per application, but it
does not detect an Authentik outage and switch over by itself. If several
methods are enabled, people can pick any of them. So the normal application
stays restricted to Authentik, an operator enables the emergency method after
confirming an outage, and removes it after recovery.

## Normal login

1. Create an Authentik OAuth2/OIDC application and provider for Friday.
   Register the exact Cloudflare callback
   `https://<team>.cloudflareaccess.com/cdn-cgi/access/callback` as a strict
   redirect URI. Select an asymmetric signing key and serve Authentik's public
   endpoints over HTTPS. Make sure the email claim is an Authentik-verified
   address.
2. In Cloudflare Zero Trust, add Authentik as a Generic OIDC identity provider
   using its discovery document's authorization, token and JWKS endpoints.
   Keep the client secret in Cloudflare's IdP configuration only. Enable PKCE
   if both sides support it.
3. Set the Friday Access application to Authentik only, with instant
   authentication, and attach an explicit least-privilege Allow policy (exact
   emails or verified Authentik groups; never Everyone or Bypass).
4. Optional, for edge auditing only: an Authentik scope mapping named
   `friday_access` that returns `{"friday_auth_source": "authentik"}`,
   requested by Cloudflare's Generic OIDC configuration and added there as a
   custom claim. Friday does not read this claim.

Friday makes a person an operator only when the signed email is in
`FRIDAY_ACCESS_OPERATOR_EMAILS`. It does not look at which identity provider
was used, so **emergency One-time PIN identities must use addresses that are
not in that list**. Keep operator accounts on the Authentik-only policy.

Authentik's recorded address is the private VM120 `10.1.60.10`. That does not
show Cloudflare can reach its discovery, authorization, token and JWKS
endpoints. Confirm a trusted public HTTPS URL and routing before creating the
OIDC connection. Do not put Authentik's own login endpoints behind the Friday
Access application, which would create a login loop.

## Authentik outage procedure

Use only after confirming from an external client that Authentik's discovery
or login endpoint is failing. A password, MFA, group or policy rejection is not
an outage.

1. Record the outage start time and confirm the fallback identity list is
   current.
2. In Cloudflare Zero Trust, enable One-time PIN and add it to Friday's allowed
   login methods. Keep the Authentik policy restricted to the Authentik method.
3. Attach a separate fallback Allow policy: exact non-operator email addresses
   only, requiring the One-time PIN method. No email domains, Everyone, Bypass,
   or any address in `FRIDAY_ACCESS_OPERATOR_EMAILS`.
4. Set the shortest supported session duration on that policy. Test with an
   authorized fallback identity: it can read Friday and gets 403 on
   operator-only routes (listed below).
5. Record who activated the fallback and when. Never add fallback identities
   to `FRIDAY_ACCESS_OPERATOR_EMAILS` or bypass origin JWT validation.

## Recovery

1. Confirm Authentik's HTTPS discovery, token and JWKS endpoints work and
   complete a real Authentik login.
2. Confirm the operator's email is still in `FRIDAY_ACCESS_OPERATOR_EMAILS`
   and an operator-only route works for them.
3. Remove the fallback policy and remove One-time PIN from Friday's login
   methods. Check that a PIN sign-in is denied and Authentik still works.
4. Record the recovery time. Existing fallback sessions can last until their
   Access token expires, so rely on the short fallback session duration and
   Cloudflare's session controls; removing the policy is not instant
   revocation.

## Operator-only routes on `main`

From `server/http.mjs` (the `operatorOnly` check). A signed-in non-operator
gets 403 on:

- `POST /api/agents/registry/sync`
- `PUT /api/settings/sites`
- any non-GET request under `/api/settings/endpoints` and
  `/api/settings/repositories`
- `POST /api/approvals/:incidentId/decision`
- `/api/audit/events`

Every other `/api/` route is open to any valid signed identity, including
`POST /api/incidents/:id/diagnostics/rerun` (a read-only rerun). Earlier drafts
of this runbook said reruns were operator-only; on `main` they are not.

## Evidence to collect before switching

- Normal login goes to Authentik; an unlisted person is denied.
- An Authentik-issued Access identity carries the intended signed email; a
  listed operator can use the operator-only routes.
- With the fallback off, One-time PIN cannot reach Friday.
- During a simulated outage, fallback login works only for exact non-operator
  emails and gets 403 on every operator-only route.
- After recovery, the fallback is off, Authentik works, and a fallback identity
  never got operator access.
- Anonymous direct-origin API calls stay denied (403 without a valid JWT, 503
  in live mode when `FRIDAY_ACCESS_TEAM_DOMAIN`/`FRIDAY_ACCESS_AUD` are
  missing).

This runbook does not authorize changes to the live Access application,
production DNS or routing, VM120, production environment variables, or a
deploy.

References: [Authentik with Cloudflare Access](https://docs.goauthentik.io/integrations/services/cloudflare-access/),
[Authentik scope mappings](https://docs.goauthentik.io/add-secure-apps/providers/property-mappings/),
[Cloudflare Generic OIDC](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/generic-oidc/),
[Cloudflare One-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/),
[Cloudflare Access application tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/).
