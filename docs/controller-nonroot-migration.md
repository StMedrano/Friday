# Running the Friday controller without root

Status (2026-11-02): **prepared, not deployed.** The default image (`runtime` stage) still runs as root. A separate `runtime-nonroot` stage (UID/GID 10001) is built, smoke-tested and rehearsed in CI only. No Compose file selects it.

## Why production cannot just switch

On VM102 the `friday_data` volume and its files (for example `monitoring-state.json`, mode 600) are owned by `0:0`. The host timer `friday-renew-work-grants` also rewrites `work-grants.json` as root. A UID 10001 process cannot write the first or read the second, so switching the image alone would break monitoring state and Tasks.

## What CI proves on every change

- `scripts/test-controller-container-hardening.sh friday-ci-nonroot`: the candidate runs as 10001 with a read-only root, no capabilities, no npm/Yarn, writes only to `/data` and `/tmp`, and its monitoring state file is owned by 10001.
- `scripts/test-friday-volume-migration.sh friday-ci-nonroot`: on disposable fixture volumes only, root-owned data is copied from a **read-only** source to a new volume, chowned to 10001, read and written by the candidate, and compared byte for byte; the source stays root-owned and unchanged. It never touches `friday_data`.
- `scripts/scan-controller-image.sh`: a digest-pinned Trivy scan of the controller, observer and proxy images fails CI on any HIGH or CRITICAL finding. The scanner gets the saved image tar read only, never the Docker socket.

## Before a maintenance window (read only)

On VM102, `sh scripts/check-friday-volume-readiness.sh` inspects the running container and `friday_data` and prints ownership and modes. It copies, changes and restarts nothing.

## Cutover outline (needs the owner's approval and a window)

1. Record the running image digest and Compose files for rollback; take a backup of `friday_data`.
2. Stop Friday's writes. Create a **new** volume (for example `friday_data_nonroot`), copy `friday_data` into it with the old volume mounted read only, and chown only the new volume to 10001:10001 (the same steps the rehearsal runs). Never chown or delete `friday_data`.
3. Update the grants timer so it writes `work-grants.json` owned by 10001 (or readable by it) in the new volume.
4. In a reviewed PR, point Compose at `build.target: runtime-nonroot` and the new volume, then deploy.
5. Check health, sign-in, monitoring persistence and Tasks. On any failure, restore the recorded image with the untouched `friday_data`.
