#!/bin/sh
# Disposable staging runtime integration test. Starts only a synthetic-identity
# Friday container; NEVER launches cloudflared or publishes any host ports.
set -eu
root="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
name="friday-stage-ci-$$"
token="$(mktemp)"
aud=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
printf '%s\n' 'SYNTHETIC-NOT-A-REAL-TUNNEL-TOKEN' > "$token"
compose() {
 FRIDAY_STAGE_CF_ACCESS_AUD="$aud" FRIDAY_STAGE_TUNNEL_TOKEN_FILE="$token" \
 docker compose -p "$name" -f "$root/deploy/staging/compose.yaml" "$@"
}
cleanup() {
 compose down --remove-orphans >/dev/null 2>&1 || true
 rm -f "$token"
}
trap cleanup EXIT HUP INT TERM
compose up -d --build friday-staging >/dev/null
id="$(compose ps -q friday-staging)"
[ -n "$id" ]
[ "$(docker inspect "$id" --format '{{.Config.User}}')" = '10001:10001' ]
[ "$(docker inspect "$id" --format '{{.HostConfig.ReadonlyRootfs}}')" = true ]
[ "$(docker inspect "$id" --format '{{len .HostConfig.PortBindings}}')" = 0 ]
[ "$(docker inspect "$id" --format '{{len .Mounts}}')" = 0 ]
[ -z "$(compose ps -q cloudflared-staging)" ]
i=0
until docker exec "$id" wget -qO- http://127.0.0.1:3010/healthz >/dev/null 2>&1; do
 i=$((i+1))
 [ "$i" -lt 25 ] || { echo 'Staging image failed health check' >&2; exit 1; }
 sleep 1
done
docker exec "$id" node -e '
const base="http://127.0.0.1:3010";
(async()=>{
 for(const path of ["/","/index.html","/api/overview","/api/agents"]){
  const response=await fetch(base+path)
  if(response.status!==401)throw Error(path+": expected 401 received "+response.status)
 }
 const ok=await fetch(base+"/healthz")
 if(ok.status!==200)throw Error("Local-only health unavailable")
 console.log("PASS: staging is rootless, isolated, no host ports, no tunnel, and denies anonymous UI/data")
})().catch(e=>{console.error(e.message);process.exitCode=1})
'
