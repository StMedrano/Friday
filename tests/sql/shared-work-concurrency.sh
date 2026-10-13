#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
container="${FRIDAY_TEST_PG_CONTAINER:-friday-phase2b-postgres-test}"
for trial in 1 2 3 4 5; do
  id="$(docker exec "$container" psql -U postgres -At -v ON_ERROR_STOP=1 -c "insert into public.friday_work_items(project_id,title,objective,creator_principal,request_id,input_fingerprint) values ('friday-test','race','two claimants','tester','race-$trial','fp') returning id;" | head -1)"
  [ -n "$id" ]
  docker exec "$container" psql -U postgres -At -v ON_ERROR_STOP=1 -c "select public.friday_claim_work('$id'::uuid,1,'tester','coder','run-a',120,'race-a-$trial');" >"/tmp/friday-race-a-$trial" &
  a=$!
  docker exec "$container" psql -U postgres -At -v ON_ERROR_STOP=1 -c "select public.friday_claim_work('$id'::uuid,1,'tester2','reviewer','run-b',120,'race-b-$trial');" >"/tmp/friday-race-b-$trial" &
  b=$!
  wait "$a"; wait "$b"
  wins="$(grep -l '"status": "claimed"' "/tmp/friday-race-a-$trial" "/tmp/friday-race-b-$trial" | wc -l)"
  conflicts="$(grep -l '"error": "version-conflict"' "/tmp/friday-race-a-$trial" "/tmp/friday-race-b-$trial" | wc -l)"
  [ "$wins" -eq 1 ] && [ "$conflicts" -eq 1 ] || { echo "Concurrent claim failed in trial $trial"; cat "/tmp/friday-race-a-$trial" "/tmp/friday-race-b-$trial"; exit 1; }
  num="$(docker exec "$container" psql -U postgres -At -c "select count(*) from public.friday_work_claims where work_item_id='$id'::uuid;")"
  [ "$num" -eq 1 ] || { echo 'Orphan duplicate claim'; exit 1; }
done
echo 'PASS: 5 concurrent dual-claim trials produced exactly one winner per work item'