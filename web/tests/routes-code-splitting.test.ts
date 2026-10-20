import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

// Divisão de código por rota (src/routes.tsx): o bundle inicial que "/" baixa é o grafo de imports ESTÁTICOS a partir de src/main.tsx.
// O app logado (/app/**) e a Central de ajuda (/ajuda/**) só podem entrar por import() dinâmico; o site público continua no bundle inicial.
// Um import estático novo (em routes.tsx ou em qualquer módulo do grafo) que traga uma dessas páginas de volta faz este teste falhar.
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src')
const CODE = ['.ts', '.tsx', '.js', '.jsx', '.mjs']
const rel = (file: string) => path.relative(SRC, file).split(path.sep).join('/')

function resolve(from: string, spec: string): string | undefined {
  const bare = spec.split('?')[0]
  const base = bare.startsWith('@/') ? path.join(SRC, bare.slice(2)) : bare.startsWith('.') ? path.resolve(path.dirname(from), bare) : undefined
  if (!base) return undefined // pacote de node_modules
  for (const candidate of [base, ...CODE.map((ext) => base + ext), ...CODE.map((ext) => path.join(base, `index${ext}`))]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  throw new Error(`import não resolvido: '${spec}' em ${rel(from)}`)
}

/** Imports e re-exports estáticos que geram código (import type / export type somem na compilação; import() dinâmico vira chunk). */
function staticImports(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const specs: string[] = []
  for (const st of source.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const clause = st.importClause
      const typeOnly = !!clause && (clause.isTypeOnly || (!clause.name && !!clause.namedBindings && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every((e) => e.isTypeOnly)))
      if (!typeOnly) specs.push(st.moduleSpecifier.text)
    } else if (ts.isExportDeclaration(st) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
      const typeOnly = st.isTypeOnly || (!!st.exportClause && ts.isNamedExports(st.exportClause) && st.exportClause.elements.length > 0 && st.exportClause.elements.every((e) => e.isTypeOnly))
      if (!typeOnly) specs.push(st.moduleSpecifier.text)
    }
  }
  return specs
}

function initialBundle(entry: string): Set<string> {
  const seen = new Set<string>(), queue = [entry]
  while (queue.length) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    if (!CODE.includes(path.extname(file))) continue // css/svg/json: sem imports a seguir
    for (const spec of staticImports(file)) { const target = resolve(file, spec); if (target && !seen.has(target)) queue.push(target) }
  }
  return new Set([...seen].map(rel))
}

const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)])

test('the initial bundle (static imports from src/main.tsx) holds no /app page and no help center module', () => {
  const bundle = initialBundle(path.join(SRC, 'main.tsx'))
  assert.ok(bundle.has('routes.tsx') && bundle.has('app/layout/AppShell.tsx'), 'o grafo estático precisa alcançar routes.tsx e a casca do app')
  const appPages = walk(path.join(SRC, 'app/pages')).filter((f) => f.endsWith('Page.tsx')).map(rel)
  for (const page of ['app/pages/inbox/InboxPage.tsx', 'app/pages/overview/OverviewPage.tsx', 'app/pages/onboarding/OnboardingPage.tsx', 'app/pages/billing/CheckoutPage.tsx']) assert.ok(appPages.includes(page), `${page} sumiu: atualize este teste`)
  // /c/:orgSlug (reserva pública, sem login) é site público e fica no bundle inicial de propósito.
  const PUBLIC_IN_APP_PAGES = new Set(['app/pages/scheduling/BookingPublicPage.tsx'])
  assert.deepEqual(appPages.filter((page) => bundle.has(page) && !PUBLIC_IN_APP_PAGES.has(page)), [], 'páginas do app logado no bundle inicial: carregue-as com import() em src/routes.tsx')
  assert.deepEqual([...bundle].filter((file) => file.startsWith('help/')), [], 'módulos da Central de ajuda no bundle inicial: carregue-os com import() em src/routes.tsx')
})

test('public site pages stay in the initial bundle (no extra round trip on first visit)', () => {
  const bundle = initialBundle(path.join(SRC, 'main.tsx'))
  const eager = ['site/pages/home/HomePage.tsx', 'site/pages/products/WhatsAppProductPage.tsx', 'site/pages/pricing/PricingPage.tsx', 'site/pages/auth/LoginPage.tsx', 'site/pages/auth/SignupPage.tsx', 'site/pages/landing/CampaignLandingPage.tsx', 'app/pages/scheduling/BookingPublicPage.tsx']
  assert.deepEqual(eager.filter((page) => !bundle.has(page)), [])
})
