#!/bin/sh
# Starts an isolated ephemeral PostgreSQL 16 container with no volumes or exposed ports.
# Never accepts a production connection string or an existing database container.
set -eu
cd "$(dirname "$0")/.."
if [ -n "${DATABASE_URL:-}" ] || [ -n "${SUPABASE_DB_URL:-}" ] || [ -n "${FRIDAY_SUPABASE_URL:-}" ]; then
 echo 'Refusing test runner with configured database service URLs' >&2
 exit 2
fi
container="friday-phase2b-isolated-$$"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT HUP INT TERM
docker run --rm -d --name "$container" --network none --tmpfs /var/lib/postgresql/data:rw,noexec,nosuid,size=128m -e POSTGRES_PASSWORD=temporary-test-only postgres:16-alpine >/dev/null
i=0
until docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; do
 i=$((i+1)); [ "$i" -lt 45 ] || { echo 'Temporary database did not start' >&2; exit 1; }
 sleep 1
done
docker exec "$container" psql -U postgres -v ON_ERROR_STOP=1 -c 'create role anon; create role authenticated; create role service_role bypassrls;' >/dev/null
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 < supabase/migrations/202610090001_friday_shared_work.sql >/dev/null
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 < tests/sql/shared-work.sql >/dev/null
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 < tests/sql/shared-work-claims.sql >/dev/null
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 < tests/sql/shared-work-handoffs.sql >/dev/null
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 < tests/sql/shared-work-decisions.sql >/dev/null
FRIDAY_TEST_PG_CONTAINER="$container" sh tests/sql/shared-work-concurrency.sh
printf 'PASS: additive shared-work migration, private grants and lease tests on disposable Postgres\n'