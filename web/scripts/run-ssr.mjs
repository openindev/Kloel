import { createServer } from 'vite'
const s = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
process.argv.splice(2, 0)
await s.ssrLoadModule('/scripts/kloel-knowledge.ts')
await s.close()
