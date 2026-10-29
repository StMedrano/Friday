#!/bin/sh
# Test the candidate image's *real entrypoint*, not a mocked HTTP handler.
# No network access, published ports, shared secrets or production volumes.
set -eu
image="${1:-friday-ci}"
name="friday-access-failclosed-$$"
created=0
cleanup() {
  if [ "$created" -eq 1 ]; then docker rm -f "$name" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT HUP INT TERM
if docker container inspect "$name" >/dev/null 2>&1; then
  echo "Refusing existing named test container" >&2
  exit 1
fi
docker run -d --rm --name "$name" --network none \
  --read-only --user 10001:10001 --cap-drop ALL \
  --security-opt no-new-privileges --pids-limit 128 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,uid=10001,gid=10001,size=16m \
  -e FRIDAY_MODE=live \
  -e FRIDAY_MONITORING_ENABLED=false \
  -e FRIDAY_AGENT_REGISTRY_ENABLED=false \
  "$image" >/dev/null
created=1
i=0
until docker exec "$name" wget -qO- http://127.0.0.1:3010/healthz >/dev/null 2>&1; do
  i=$((i+1))
  [ "$i" -lt 25 ] || { echo 'Live-mode test controller failed to start' >&2; exit 1; }
  sleep 1
done
# Missing Cloudflare team/AUD MUST fail closed in live mode.
docker exec "$name" node -e '
const root="http://127.0.0.1:3010";
async function run(){
 for(const path of ["/","/index.html","/api/overview","/api/agents","/api/repositories","/api/repositories/friday/status"]){
  const result=await fetch(root+path);
  if(result.status!==503)throw Error(path+" expected 503; got "+result.status);
 }
 const denied=await fetch(root+"/api/assistant",{
  method:"POST",headers:{"content-type":"application/json"},
  body:JSON.stringify({prompt:"staging only"})
 });
 if(denied.status!==503)throw Error("assistant accepted unauthenticated live request");
 for(const path of ["/healthz","/api/health"]){
  const result=await fetch(root+path);
  if(result.status!==200)throw Error(path+" unavailable");
 }
 console.log("PASS: unconfigured live image denies UI/agent/AI/API and allows health only");
}
run().catch(e=>{console.error(e.message);process.exitCode=1});
'
