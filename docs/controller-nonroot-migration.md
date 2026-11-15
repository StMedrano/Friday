# Running the Friday controller without root

Status (2026-11-15): **ready for a maintenance window, not deployed.** The default image (`runtime` stage) still runs as root. The `runtime-nonroot` stage (UID/GID 10001) is built, smoke-tested and rehearsed in CI. `compose.nonroot.yaml` selects it, and `scripts/update-controller.sh` adds that overlay only when `.env` has `FRIDAY_CONTROLLER_NONROOT=true` and the copied volume `friday_data_nonroot` exists. `make env-check` lists `FRIDAY_CONTROLLER_NONROOT` as not passed through by Compose; that is expected, the updater reads it.

## Why production cannot just switch

On VM102 the `friday_data` volume and its files (for example `monitoring-state.json`, mode 600) are owned by `0:0`. The host timer `friday-renew-work-grants` also rewrites `work-grants.json` as root. A UID 10001 process cannot write the first or read the second, so switching the image alone would break monitoring state and Tasks.

## What CI proves on every change

- `scripts/test-controller-container-hardening.sh friday-ci-nonroot`: the candidate runs as 10001 with a read-only root, no capabilities, no npm/Yarn, writes only to `/data` and `/tmp`, and its monitoring state file is owned by 10001.
- `scripts/test-friday-volume-migration.sh friday-ci-nonroot`: on disposable fixture volumes only, root-owned data is copied from a **read-only** source to a new volume, chowned to 10001, read and written by the candidate, and compared byte for byte; the source stays root-owned and unchanged. It never touches `friday_data`.
- `scripts/scan-controller-image.sh`: a digest-pinned Trivy scan of the controller, observer and proxy images fails CI on any HIGH or CRITICAL finding. The scanner gets the saved image tar read only, never the Docker socket.

## Before a maintenance window (read only)

On VM102, `sh scripts/check-friday-volume-readiness.sh` inspects the running container and `friday_data` and prints ownership and modes. It copies, changes and restarts nothing.

## Cutover runbook (needs the owner's approval and a window)

All commands run on VM102 in `/srv/infrastructure/apps/friday`, as `stalin` with sudo where shown. Expect about 10 minutes of Friday downtime.

1. **Before the window.** `git pull --ff-only` to a `main` that includes this runbook, then `sh scripts/check-friday-volume-readiness.sh` and keep its output.
2. **Record rollback.** `docker container inspect --format '{{.Image}}' friday` and note the image id. Back up the data: `sudo tar -C /var/lib/docker/volumes/friday_data/_data -czf ~/friday_data-$(date +%Y%m%d).tgz .`
3. **Stop writes.** `docker compose stop friday`. Also stop the grants timer so it does not write mid-copy: `sudo systemctl stop friday-renew-work-grants.timer`.
4. **Copy.** `sh scripts/migrate-friday-data-nonroot.sh --confirm`. It creates `friday_data_nonroot`, copies `friday_data` into it with the source mounted read only, chowns only the copy to 10001:10001, and checks names, sizes, modes and contents match. `friday_data` is not changed. If it fails, inspect and `docker volume rm friday_data_nonroot` before retrying.
5. **Grants timer.** Edit `/usr/local/sbin/friday-renew-work-grants` so it writes `work-grants.json` into `/var/lib/docker/volumes/friday_data_nonroot/_data/` and then runs `chown 10001:10001` and `chmod 600` on the file (write to a temp file in the same directory, chown and chmod it, then `mv` over the old one). Run it once by hand and check `stat -c '%u:%g %a'` shows `10001:10001 600`. Then `sudo systemctl start friday-renew-work-grants.timer`.
6. **Switch.** Add `FRIDAY_CONTROLLER_NONROOT=true` to `.env` (one command, check the file ends with a newline first), then `make update` and `make health`.
7. **Check.** `docker exec friday id` shows `uid=10001`; sign in; the Overview and Incidents keep their history (monitoring state persisted); Tasks lists projects (grants readable); Settings, Audit log shows earlier events.
8. **Rollback** (any failure): set `FRIDAY_CONTROLLER_NONROOT=false`, point the grants timer back at `friday_data`, `make update`. Friday returns to root on the untouched `friday_data`. Anything written after step 6 stays only in `friday_data_nonroot`.
9. **Later cleanup** (a separate, approved step, after some days on non-root): remove `friday_data` only once nobody needs the rollback.

## Cutover outline (needs the owner's approval and a window)

1. Record the running image digest and Compose files for rollback; take a backup of `friday_data`.
2. Stop Friday's writes. Create a **new** volume (for example `friday_data_nonroot`), copy `friday_data` into it with the old volume mounted read only, and chown only the new volume to 10001:10001 (the same steps the rehearsal runs). Never chown or delete `friday_data`.
3. Update the grants timer so it writes `work-grants.json` owned by 10001 (or readable by it) in the new volume.
4. In a reviewed PR, point Compose at `build.target: runtime-nonroot` and the new volume, then deploy.
5. Check health, sign-in, monitoring persistence and Tasks. On any failure, restore the recorded image with the untouched `friday_data`.
