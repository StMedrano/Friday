# Friday — scoped API and Docker socket remediation

Status: **review branch only**. No operator authorization for a production deployment is implied.

## High findings fixed in this branch

- The live-mode HTTP server requires Cloudflare Access **signed** JWT assertions for all operational `/api/` endpoints except `/api/health`; `/healthz` remains public for health checks. Browser static assets remain served as before.
- Tokens are validated *at the origin*, using the Cloudflare team-specific JWKS, verified RS256 signature, exact issuer, expected app audience and expiry. A missing or mismatched team URL/AUD/operator email configuration denies API access (HTTP 503), not an implicit allow.
- `POST /api/agents/registry/sync` additionally requires a verified operator email, and an `application/json` request body. Cross-site browser fetches with `Sec-Fetch-Site: cross-site` are denied for operational POSTs.
- The proposed live controller Compose file no longer mounts `/var/run/docker.sock` and forcibly disables `FRIDAY_DOCKER_ENABLED`. The existing VM100 observer remains a separate read-only service, unchanged by this branch.
- npm lockfile is committed, CI and Docker use `npm ci`, the pinned Vite/React plugin/Vitest toolchain is upgraded and CI gates on `npm audit`.

## Cloudflare Access configuration (required before image deployment)

1. In Cloudflare Zero Trust, create or verify a **Self-hosted** Access application protecting `friday.mytechtactics.com` including all subpaths. Limit entry to approved identities with MFA; do not add public Bypass policies.
2. Obtain the team's URL, such as `https://YOUR-TEAM.cloudflareaccess.com`, and the application **Audience (AUD) tag** from Access controls > Applications. Do not guess either. Ensure the reverse proxy forwards `Cf-Access-Jwt-Assertion` unchanged *from Access*; the backend verifies the signed token, so headers supplied directly by clients are not trusted.
3. Configure in the approved server-only deployment environment: `FRIDAY_ACCESS_TEAM_DOMAIN`, `FRIDAY_ACCESS_AUD`, `FRIDAY_ACCESS_OPERATOR_EMAILS` (comma-separated approved Access-authenticated addresses). These must **never** use a `VITE_` prefix or be embedded in the frontend. Do not place credentials in Git.
4. Validate edge sign-in, browser same-origin API calls, operator sync permissions, denial of unauthenticated direct-origin requests, JWKS rotation and restart behavior in an isolated staging environment. The public static shell can load even when APIs fail closed with 503; that is not a successful rollout.
5. Keep network-layer backend allowlists and the existing healthy production image until an operator separately approves a version-pinned candidate deployment with a tested rollback. Do not enable Phase 2C plugin/agent execution or alter Supabase grants as part of the authentication change.

The service **will fail closed** for operational APIs in live mode if these Access values are absent. Merely merging this branch is **not** permission to deploy it.

## Other remaining review items

- The current running image still runs as root with a writable root filesystem. Plan a separate, tested non-root migration that preserves the `/data` volume ownership.
- Confirm reverse-proxy HTTPS and Access policy restrictions on the actual domain, not just unit tests.
- Request independent security review, verify exact-head CI and dependency audit, and ensure there is no public fallback route to the backend.
- Apply a rate limit to the login-protected model-inference API and operator endpoints in an approved follow-on change.

References: Cloudflare Access JWT validation documentation at https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
