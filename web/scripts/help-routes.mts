// Gera dist/help-routes.json: caminhos válidos da Central de ajuda (o engine responde 404 para os demais).
import { writeFileSync } from 'node:fs'
import { ALL_ARTICLES, articleKey } from '../src/help/content/index.ts'
import { HELP_ALIASES } from '../src/help/content/nav.ts'
const keys = new Set<string>()
for (const a of ALL_ARTICLES) { keys.add(articleKey(a)); keys.add(a.section) }
for (const k of Object.keys(HELP_ALIASES)) { keys.add(k); keys.add(k.split('/')[0]!) }
keys.add('integrations'); keys.add('legal')
writeFileSync(new URL('../dist/help-routes.json', import.meta.url), JSON.stringify([...keys].sort()))
console.log('help-routes', keys.size)
