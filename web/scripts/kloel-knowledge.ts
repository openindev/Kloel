import { writeFileSync } from 'node:fs'
import { VOICES } from '../src/data/catalogs/voices'
import { LANGUAGES } from '../src/data/catalogs/languages'
import { PRODUCTS, ADDONS } from '../src/data/catalogs/plans'
import { INTEGRATIONS, INTEGRATION_STATUS_LABEL } from '../src/data/catalogs/integrations'
import { ALL_ARTICLES } from '../src/help/content/index'

const j = (v: unknown) => JSON.stringify(v)
let md = '# Tudo que a Kloel faz (catálogo oficial gerado do produto)\n\n'
md += `## Vozes\nA Kloel oferece ${VOICES.length} vozes. Exemplos: ${VOICES.slice(0, 40).map((v: any) => `${v.name} (${v.language ?? v.lang ?? ''}${v.gender ? ', ' + v.gender : ''})`).join('; ')}.\n\n`
md += `## Idiomas dos assistentes (${LANGUAGES.length})\n${LANGUAGES.map(l => l.label).join(', ')}.\n\n`
md += '## Produtos e planos\n'
for (const p of PRODUCTS as any[]) {
  md += `### ${p.name}\n`
  for (const pl of p.plans ?? []) md += `- Plano ${pl.name ?? pl.tier} — ${pl.publicTagline ?? ''}: ${pl.monthly === null ? 'preço sob consulta' : `R$ ${pl.monthly}/mês no plano mensal`}${pl.annual ? `; R$ ${pl.publicAnnual ?? pl.annual}/mês no plano anual` : ''}${pl.fromPrice ? `; a partir de R$ ${pl.fromPrice.monthly}/mês` : ''}; ${pl.limits ? 'limites ' + j(pl.limits) + '; ' : ''}${pl.features ? 'recursos: ' + (pl.features as any[]).map(f => typeof f === 'string' ? f : f.label ?? j(f)).join(', ') : ''}\n`
}
md += `\n### Complementos\n${(ADDONS as any[]).map(a => `- ${a.label}: R$ ${a.unitPrice} por pacote de ${a.unit}${a.info ? ' — ' + a.info : ''}`).join('\n')}\n\n`
md += `## Integrações (${INTEGRATIONS.length})\n${(INTEGRATIONS as any[]).map(i => `- ${i.name} [${i.category}] — ${INTEGRATION_STATUS_LABEL[i.status as keyof typeof INTEGRATION_STATUS_LABEL]}${i.description ? ': ' + i.description : ''}`).join('\n')}\n\n`
md += '## Central de ajuda (todas as funcionalidades, passo a passo)\n'
const strip = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/[*_`#>]+/g, '').replace(/\n{3,}/g, '\n\n').trim()
for (const a of ALL_ARTICLES as any[]) {
  const body = typeof a.body === 'string' ? a.body : typeof a.content === 'string' ? a.content : Array.isArray(a.blocks) ? a.blocks.map((b: any) => b.text ?? b.content ?? (b.items ? b.items.join('\n') : '')).join('\n') : j(a.body ?? a.content ?? '')
  md += `\n### ${a.title}\n${strip(String(body)).slice(0, 2500)}\n`
}
writeFileSync(process.argv[2] ?? 'kloel-tudo.md', md)
console.log(md.length, VOICES.length, LANGUAGES.length, INTEGRATIONS.length, ALL_ARTICLES.length)
