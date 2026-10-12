#!/bin/sh
# Isolated contract test: Docker daemon is READ-ONLY input for the proxy.
# Neither test container has published ports or a path to production configs.
set -eu
proxy_image="${1:-friday-observer-proxy-ci}"
observer_image="${2:-friday-observer-ci}"
suffix="$$"
volume="friday-observer-isolation-test-$suffix"
proxy="friday-proxy-test-$suffix"
observer="friday-observer-test-$suffix"
cleanup() {
  docker rm -f "$observer" "$proxy" >/dev/null 2>&1 || true
  if [ "${created:-0}" = 1 ]; then docker volume rm "$volume" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT HUP INT TERM
if docker volume inspect "$volume" >/dev/null 2>&1; then
  echo 'Refusing pre-existing isolation volume' >&2
  exit 1
fi
docker volume create "$volume" >/dev/null
created=1
gid="$(stat -c %g /var/run/docker.sock)"
docker run -d --name "$proxy" --network none --read-only --user 10001:10001 \
 --group-add "$gid" --cap-drop ALL --security-opt no-new-privileges \
 --mount 'type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock,readonly' \
 --mount "type=volume,source=$volume,target=/proxy" "$proxy_image" >/dev/null
i=0
until docker exec "$proxy" test -S /proxy/docker.sock >/dev/null 2>&1; do
 i=$((i+1))
 [ "$i" -lt 20 ] || { docker logs "$proxy" | tail -15; exit 1; }
 sleep 1
done
[ "$(docker exec "$proxy" id -u)" = 10001 ]
docker run -d --name "$observer" --network none --read-only --user 10001:10001 \
 --cap-drop ALL --security-opt no-new-privileges \
 --mount "type=volume,source=$volume,target=/proxy,readonly" \
 -e FRIDAY_OBSERVER_TOKEN=fixture-only-isolation-token \
 -e FRIDAY_OBSERVER_DOCKER_SOCKET=/proxy/docker.sock \
 -e FRIDAY_OBSERVER_BIND_ADDRESS=127.0.0.1 \
 "$observer_image" >/dev/null
i=0
until docker exec "$observer" wget -qO- http://127.0.0.1:3199/health >/dev/null 2>&1; do
 i=$((i+1))
 [ "$i" -lt 20 ] || { docker logs "$observer" | tail -15; exit 1; }
 sleep 1
done
docker exec "$observer" sh -c 'test ! -S /var/run/docker.sock && test -S /proxy/docker.sock'
docker exec "$observer" node -e '
 const http=require("http");
 const req=http.request({socketPath:"/proxy/docker.sock",path:"/containers/json?all=1",method:"GET"},res=>{
  if(res.statusCode!==200)process.exitCode=1;
  console.log("Read-only Docker GET: HTTP",res.statusCode);
  res.resume();
 });
 req.on("error",()=>process.exitCode=1);req.end();
'
docker exec "$observer" node -e '
 const http=require("http");
 const req=http.request({socketPath:"/proxy/docker.sock",path:"/containers/json?all=1",method:"POST"},res=>{
  if(res.statusCode!==403)process.exitCode=1;
  console.log("Docker POST forbidden: HTTP",res.statusCode);
  res.resume();
 });
 req.on("error",()=>process.exitCode=1);req.end();
'
docker exec "$observer" node -e '
 fetch("http://127.0.0.1:3199/api/v1/containers",{headers:{authorization:"Bearer fixture-only-isolation-token"}})
 .then(async response=>{
  if(response.status!==200){console.error((await response.text()).slice(0,120));process.exitCode=1;}
  console.log("Authenticated observer inventory: HTTP",response.status);
 }).catch(()=>{process.exitCode=1})
'
# Even a compromised observer cannot fetch raw inspect environment,
# host bind mounts, untrusted labels, or arbitrary unstructured log output.
self_id="$(docker inspect "$observer" --format '{{.Id}}')"
docker exec -e TEST_CONTAINER_ID="$self_id" "$observer" node -e '
 const http=require("http")
 const id=process.env.TEST_CONTAINER_ID
 async function query(path){
  return await new Promise((resolve,reject)=>{
   const req=http.request({socketPath:"/proxy/docker.sock",path,method:"GET"},res=>{
    const chunks=[]
    res.on("data",x=>chunks.push(x))
    res.on("end",()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString("utf8")}))
   })
   req.on("error",reject)
   req.end()
  })
 }
 (async()=>{
  const inspect=await query("/containers/"+id+"/json")
  if(inspect.status!==200)throw Error("inspection request failed")
  const data=JSON.parse(inspect.body)
  if(data.Config.Env!==undefined||data.Config.Cmd!==undefined||data.Mounts!==undefined||
    data.HostConfig.Binds!==undefined)throw Error("unredacted Docker metadata escaped broker")
  const logs=await query("/containers/"+id+"/logs?stdout=1&stderr=1&timestamps=1&tail=100")
  if(logs.status!==403)throw Error("raw Docker logs were not blocked")
  console.log("Sanitized inspect HTTP 200; raw log request HTTP 403")
 })().catch(e=>{console.error(e.message);process.exitCode=1})
'
echo 'PASS: isolated observer can read projected Docker inventory/inspection only, never Docker writes, raw metadata or logs'
