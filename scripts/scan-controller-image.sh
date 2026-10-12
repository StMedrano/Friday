#!/bin/sh
# CI scan of an already-built controller image. Never hand the scanner a
# Docker daemon socket or access to production secrets/containers.
set -eu
image="${1:-friday-ci}"
# The vulnerability DB can expand to >1 GiB; use disk-backed temporary
# space rather than machines where /tmp is a small RAM-backed tmpfs.
dir="$(mktemp -d "${RUNNER_TEMP:-/var/tmp}/friday-trivy.XXXXXX")"
cleanup(){ rm -rf "$dir"; }
trap cleanup EXIT HUP INT TERM
mkdir -p "$dir/input" "$dir/cache"
docker save -o "$dir/input/controller.tar" "$image"
# Pin the independently runnable scanner image to the reviewed v0.75.0 digest.
# The image tar is mounted read-only; only an isolated cache is writable.
docker run --rm --user "$(id -u):$(id -g)" --read-only \
  --security-opt no-new-privileges --cap-drop ALL \
  --tmpfs /tmp:rw,noexec,nosuid,size=256m \
  --mount "type=bind,src=$dir/input,dst=/scan,readonly" \
  --mount "type=bind,src=$dir/cache,dst=/cache" \
  ghcr.io/aquasecurity/trivy:0.75.0@sha256:af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa \
  image --input /scan/controller.tar --cache-dir /cache \
  --scanners vuln --severity HIGH,CRITICAL --exit-code 1 \
  --format table --timeout 10m
echo 'PASS: candidate runtime image has no scanner-reported HIGH/CRITICAL vulnerabilities'
