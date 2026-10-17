import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=p=>readFileSync(p,'utf8')
test('full test suite includes new server/work modules and isolated DB test scripts',()=>{
 const pkg=JSON.parse(read('package.json'))
 assert.ok(pkg.scripts.test.includes('server/work/*.test.mjs'))
 assert.ok(pkg.scripts['test:server'].includes('server/work/*.test.mjs'))
 assert.ok(pkg.scripts['validate:shared-work-schema'].includes('validate-shared-work-schema.mjs'))
 assert.ok(pkg.scripts['test:shared-work-db'].includes('test-shared-work-postgres.sh'))
})
test('CI verifies real disposable Postgres concurrency and respects advisory boundary',()=>{
 const ci=read('.github/workflows/ci.yml')
 assert.ok(ci.includes('npm run validate:shared-work-schema'))
 assert.ok(ci.includes('npm run test:shared-work-db'))
 assert.ok(ci.includes('Verify shared-work security boundary'))
 const http=read('server/http.mjs')
 assert.equal(/url\.pathname\s*===\s*['"]\/api\/(work|memory|decisions)/.test(http),false)
 const s=read('server/work/continuation.mjs')
 assert.equal(/child_process|execFile\(|spawn\(|ssh\s/.test(s),false)
})