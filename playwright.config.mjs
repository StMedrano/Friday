import {defineConfig} from '@playwright/test'
export default defineConfig({
 testDir:'./tests/e2e',workers:1,fullyParallel:false,
 use:{baseURL:'http://127.0.0.1:8772',browserName:'chromium',...(process.env.FRIDAY_E2E_CHANNEL?{channel:process.env.FRIDAY_E2E_CHANNEL}:{})},
 webServer:{command:'node tests/e2e/project-fixture.mjs',url:'http://127.0.0.1:8772/healthz',reuseExistingServer:false,timeout:30000},
})
