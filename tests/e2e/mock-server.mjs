// Loopback-only Friday server in mock mode for the e2e smoke test. No
// credentials, no external integrations, and no write paths are exercised.
import { createFridayServer } from '../../server/http.mjs'
import { getConfig } from '../../server/config.mjs'

const config = getConfig({ FRIDAY_MODE: 'mock' })
const server = createFridayServer({ config })
server.listen(8772, '127.0.0.1', () => console.log('Friday mock e2e server on http://127.0.0.1:8772'))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)))
