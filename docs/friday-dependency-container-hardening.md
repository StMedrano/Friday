# Friday dependency and container hardening

Scope: Draft PR based on `StMedrano/Friday` security PR #29, at exact parent `ab68ef9`. No running production image, volumes, services, firewall rules, or cloud identity policies are changed.

## Dependencies and build-chain policy

- The Git-tracked `package-lock.json` pins the entire npm dependency graph.
- `package.json` pins Vite **8.3.4**, Vitest **5.0.4**, and `@vitejs/plugin-react` **5.2.0**. The other direct dependencies remain at their previously specified versions.
- Both GitHub Actions and the container build use `npm ci`, so lockfile/package mismatch fails rather than being silently resolved.
- GitHub Actions runs `npm audit --audit-level=moderate`. The local audit on 2026-10-12 reported **zero npm vulnerabilities**, including dev tools. This is a snapshot; a future advisory may change the result.
- Build uses a patch-specific Node 22/Alpine image. CI builds and smoke-tests the final image without exposing host ports.
- Only built UI, server code and reviewed catalogs are copied to the runtime image: no `node_modules`, npm cache, Git history, or local `.env` secrets.

## Controller runtime protections

The controller image specifies user **10001:10001**. Compose repeats the user ID and sets `read_only: true`, `cap_drop: [ALL]`, `no-new-privileges`, `pids_limit: 128`, and a bounded `/tmp` tmpfs with `noexec,nosuid,nodev`. Only the named data volume at `/data` is persistent/writable. Friday's existing monitor state continues to be stored there. The code and static UI are read-only. Phase 2C stays disabled.

The disposable image smoke test checks identity, immutable root filesystem, absence of Linux capabilities, local health, writable `/data` and `/tmp`, and a monitoring state owned by UID 10001. It uses `--network none` and a disposable volume, leaving all live Docker resources untouched.

**This hardening applies to the `friday` controller service, not to the separately defined Ollama or VM100 observer containers. Those services need their own threat model and smoke tests.**

## Existing production data needs an approved migration

Read-only inspection on Friday VM102 found the current volume's `/data` directory owned by **0:0** (mode 755) and `/data/monitoring-state.json` owned by **0:0** (mode 600). A non-root controller cannot write this root-owned state. **Do not start this candidate image against the current `friday_data` volume**.

A safe deployment can preserve the old volume as a rollback point, but it requires a separately approved maintenance window:

1. Verify Cloudflare Access team domain, audience, operator identities, ingress enforcement and return-to-service checks. Complete the independent code review. Record the running container's immutable image digest and verify database and volume backups.
2. Pause/stop Friday's writes during the migration window, after ensuring the old container can be restored. Create a consistent backup/snapshot of `friday_data`. **Do not run any migration command until authorized.**
3. Create a **new** named volume `friday_data_hardened`. Copy the entire old volume into it with the old volume attached **read-only**, and chown *only the new volume* to UID:GID 10001:10001 in a one-off disposable migration container. Preserve file contents and modes. Check counts/checksums, permissions, free space and `monitoring-state.json` before cutover. Never chown or delete the original `friday_data`.
4. Select the new volume using host-only environment value `FRIDAY_DATA_VOLUME=friday_data_hardened` and deploy the **explicitly approved immutable image** with approved Cloudflare Access settings. The Compose default still selects the existing `friday_data`; ensure the volume override is present before starting a non-root release.
5. Run smoke checks: UID 10001; read-only root; restricted port 3010; authenticated UI, inventory and operator flows; no anonymous API success; healthy monitoring state persistence. If any check fails, stop the candidate and restore the old **approved image with old `friday_data`** using the recorded rollback config. Retain the new volume for forensic review; never silently merge divergent state.

A staging/test copy may be exercised first using **disposable** data. The pre-existing production volume is not modified by this PR.

## Remaining security gates

- Cloudflare Access application/edge policy + JWT header forwarding are not configured by this work. PR #29's application JWT verification is not a substitute for an edge login policy or staged authorized/anonymous tests.
- The controller may still receive a public connection if an ingress or firewall policy is wrong; verify the VM100-only backend allowlist and add ingress-level shared quotas.
- An npm dependency audit is not an OS/image vulnerability scan. Add a base-image SBOM/CVE scan to the release process and document image digest pinning/renewals.
- Independent security review of authentication and the new non-root deployment process is required. No automatic merge, production deployment, or Phase 2C activation is authorized.

## Image vulnerability scan (October 12, 2026)

A second scanner is now part of the exact-image GitHub CI gate, independent of npm audit:

- A baseline **Trivy v0.75.0** scan of the candidate `node:22.23.2-alpine3.23` runtime found **1 CRITICAL + 13 HIGH** findings in npm's global CLI packages (`/usr/local/lib/node_modules/npm`) and **1 MEDIUM** Alpine zlib advisory. These were not present in Friday's project-level npm dependency tree.
- Friday serves requests through `node server/index.mjs`; neither npm, npx, corepack nor Yarn is needed in the **runtime**. The revised runtime Docker stage runs `apk upgrade --no-cache` to use available Alpine fixes, then removes the global npm, npx, corepack and Yarn tools. The separate build stage retains npm for `npm ci`.
- A rebuilt image scan with a fresh Trivy vulnerability database reported **zero OS and Node.js package vulnerabilities** in its JSON result. A further scan of the final runtime, without Yarn, reported **zero HIGH or CRITICAL findings**. Results apply to this candidate image and the scanner DB at scan time; later advisories may change the result.
- CI now saves the freshly built image to a temporary tar archive and runs a **digest-pinned** Trivy scanner against that archive. The scanner never gets the Docker socket, production environment, or container network; it uses a separate writable cache, has a read-only root filesystem and drops privileges. A failed scan or any HIGH/CRITICAL advisory stops CI (`--exit-code 1`). Both the scan and existing npm-audit checks fail closed.
- Disposable smoke testing also verifies that the final runtime lacks the global npm/Yarn binaries while remaining healthy, unprivileged, and able to write monitoring state under UID 10001.

**Scope limitation:** Container scanners are advisory snapshots, not complete vulnerability guarantees or an independent penetration test. Even with this image scan passing, do not deploy without approved Cloudflare Access identity policy, non-destructive migration of root-owned monitoring data to a separate volume, an independently reviewed release, and explicit production approval. The scanner gate applies to the **Friday controller image only**; the VM100 observer and optional Ollama images require separate evaluation.
