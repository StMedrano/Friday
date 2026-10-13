import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'

const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..')

test('PostgreSQL probe does not execute SQL until official-image init completion',async(t)=>{
 const fixture=await mkdtemp(join(tmpdir(),'friday-pg-init-race-'))
 t.after(()=>rm(fixture,{recursive:true,force:true}))
 const bin=join(fixture,'bin')
 await mkdir(bin)
 await writeFile(join(bin,'docker'),`#!/bin/sh
set -u
case "$1" in
 run) echo disposable-container; exit 0 ;;
 logs)
  count=0
  if [ -f "$FRIDAY_TEST_STUB_DIR/probe_count" ]; then count=$(cat "$FRIDAY_TEST_STUB_DIR/probe_count"); fi
  count=$((count + 1))
  echo "$count" > "$FRIDAY_TEST_STUB_DIR/probe_count"
  if [ "$count" -ge 2 ]; then echo "PostgreSQL init process complete; ready for start up."; fi
  exit 0 ;;
 exec)
  case "$*" in
   *pg_isready*) exit 0 ;;
   *psql*)
    count=0
    if [ -f "$FRIDAY_TEST_STUB_DIR/probe_count" ]; then count=$(cat "$FRIDAY_TEST_STUB_DIR/probe_count"); fi
    if [ "$count" -lt 2 ]; then echo "EARLY_PSQL_INIT_RACE" >&2; fi
    exit 42 ;;
  esac ;;
 rm) exit 0 ;;
esac
exit 3
`,{mode:0o755})
 const env={...process.env,PATH:bin+':'+process.env.PATH,FRIDAY_TEST_STUB_DIR:fixture,DATABASE_URL:'',SUPABASE_DB_URL:'',FRIDAY_SUPABASE_URL:''}
 const run=spawnSync('sh',['scripts/test-shared-work-postgres.sh'],{cwd:projectRoot,env,timeout:15000,encoding:'utf8'})
 const count=Number(await readFile(join(fixture,'probe_count'),'utf8').catch(()=>0))
 assert.ok(count>=2,'must wait for final PostgreSQL initialization completion before issuing SQL')
 assert.doesNotMatch(run.stderr||'',/EARLY_PSQL_INIT_RACE/)
 assert.equal(run.status,42,'mock terminates intentionally at the first permitted SQL call')
})
