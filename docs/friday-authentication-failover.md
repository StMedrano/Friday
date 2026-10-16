# Friday authentication: Authentik primary, Cloudflare break-glass

Friday uses Cloudflare Access as its public edge gate and verifies Access's signed `Cf-Access-Jwt-Assertion` at the origin. Authentik is the normal human login provider through Cloudflare Access Generic OIDC. Cloudflare One-time PIN is an emergency provider and must be enabled for the Friday application only during a confirmed Authentik outage.

Cloudflare Access supports multiple configured identity providers, but it does not automatically detect an Authentik outage and expose a secondary provider only then. If multiple methods are enabled for the application, users can choose among them. Keep the normal application restricted to Authentik. An operator must enable the emergency method after confirming an outage, then remove it after recovery. This preserves the user's outage-only requirement.

## Normal login

1. Create an Authentik OAuth2/OIDC application and provider for Friday. Register the exact Cloudflare callback URI `https://<team>.cloudflareaccess.com/cdn-cgi/access/callback` as a strict redirect URI. Select an asymmetric signing key and use HTTPS for Authentik's public endpoints. Verify the email claim comes from an Authentik-verified address; do not authorize an unverified profile email.
2. In Cloudflare Zero Trust, add Authentik as a Generic OIDC identity provider using its discovery-document values for authorization, token, and JWKS endpoints. Keep the client secret in Cloudflare's IdP configuration only. Enable PKCE if both sides support it.
3. Configure the Friday Access application to use Authentik only and enable instant authentication. Attach an explicit least-privilege Allow policy. Use exact authorized email addresses or verified Authentik groups; never use Everyone or Bypass.
4. Add an Authentik OAuth2 scope mapping with scope name `friday_access`. Its expression returns the constant claim:

   ```python
   return {"friday_auth_source": "authentik"}
   ```

   Assign the scope mapping to Friday's OIDC provider, request the `friday_access` scope in Cloudflare's Generic OIDC configuration, and enable inclusion of its claims in the ID token. In Cloudflare, add `friday_auth_source` as a custom claim. Verify a real staging Access application JWT contains `custom.friday_auth_source == "authentik"`; never copy that JWT into logs, chat, or GitHub.

Friday grants Operator status only when both the signed email is in `FRIDAY_CF_ACCESS_OPERATOR_EMAILS` and the signed Authentik source claim exactly matches `authentik`. A valid Cloudflare fallback token without that claim can read Friday as Viewer but cannot call Operator-only routes. Missing or malformed source claims fail closed to Viewer.

Authentik currently has a private VM120 address recorded as `10.1.60.10`. That does not prove Cloudflare can reach its OIDC discovery, authorization, token, and JWKS endpoints. Verify a trusted HTTPS URL and routing before creating the OIDC connection. Keep Authentik's admin interface separately protected; do not put Authentik's login endpoints behind the Friday Access application, which would create a login loop.

## Authentik outage procedure

Use only after confirming Authentik is unavailable from an external client and its OIDC discovery or login endpoint fails. A user's password, MFA, group, or policy rejection is not an outage.

1. Record outage start time and confirm the fallback identity list is still current.
2. In Cloudflare Zero Trust, enable One-time PIN and add it to Friday's allowed login methods. Keep the primary Authentik policy restricted to the Authentik login method.
3. Attach a separate fallback Allow policy. Restrict Include to exact email addresses and require the One-time PIN login method. Do not use an email domain, Everyone, or Bypass.
4. Set the shortest supported session duration for the fallback policy. Test with an authorized staging identity and verify a signed fallback session can read Friday but receives 403 for operator-only routes, even if its email appears in the operator allowlist.
5. Record who activated fallback and when. Do not change `FRIDAY_CF_ACCESS_OPERATOR_EMAILS` or bypass origin JWT validation.

## Recovery

1. Confirm Authentik's HTTPS discovery, token, and JWKS endpoints work and complete a real Authentik login to staging.
2. Confirm the issued Access JWT carries the Authentik source claim and the intended operator route works with its separate operator token.
3. Remove the fallback Allow policy and remove One-time PIN from Friday's allowed login methods. Verify an OTP sign-in is denied and Authentik sign-in still succeeds.
4. Record recovery time. Existing fallback Access sessions may remain usable until their application token expires; use the configured short fallback duration and Cloudflare's session controls. Do not claim immediate revocation from removing the policy alone.

## Required staging evidence

- Normal login redirects to Authentik; an unlisted user is denied.
- Authentik-issued Access JWT includes the source claim; an authorized operator passes both email and source-claim checks.
- With fallback disabled, Cloudflare One-time PIN cannot reach Friday.
- During a simulated outage window, fallback login works only for exact listed emails, receives Viewer role, and cannot sync agents or rerun diagnostics.
- After recovery, fallback is disabled, Authentik works again, and a fallback token never receives Operator status.
- Anonymous direct-origin requests remain denied. Friday continues to require a valid Cloudflare-signed JWT for UI and protected APIs.

This runbook does not authorize changes to live Access applications, production DNS/routing, VM120, production environment variables, or deployment.

References: [Authentik integration with Cloudflare Access](https://docs.goauthentik.io/integrations/services/cloudflare-access/), [Authentik OAuth2/OIDC scope mappings](https://docs.goauthentik.io/add-secure-apps/providers/property-mappings/), [Cloudflare Generic OIDC](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/generic-oidc/), [Cloudflare One-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/), and [Cloudflare Access application tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/).
