import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const root = process.cwd(), require = createRequire(path.join(root, 'package.json')), ts = require('typescript')
const tests = fs.readdirSync(path.join(root, 'tests')).filter(x => x.endsWith('.test.ts')).map(x => path.join(root, 'tests', x))
const queue = [...tests], seen = new Set(), edges = [], violations = []
const opts = { moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ES2022, baseUrl: root, paths: { '@/*': ['src/*'] } }
while (queue.length) {
  const file = queue.shift()
  if (seen.has(file)) continue
  seen.add(file)
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const add = (specifier, kind) => {
    const resolved = ts.resolveModuleName(specifier, file, opts, ts.sys).resolvedModule?.resolvedFileName
    if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return
    edges.push({ from: path.relative(root, file), specifier, resolved: resolved ? path.relative(root, resolved) : null, kind })
    if (!resolved) { violations.push({ file: path.relative(root, file), specifier, reason: 'unresolved_runtime_import' }); return }
    if (!resolved.startsWith(root + path.sep)) return
    const rel = path.relative(root, resolved)
    if (rel.startsWith('src/') && !rel.startsWith('src/services/engine/')) violations.push({ file: rel, reason: 'unexpected_app_source' })
    if (/\b(?:Engine[A-Za-z]*(?:Page|Panel)|SheetsQueryEditor|ChannelTab|PromoBar|DemoTag|WhatsAppLiveTest)\b/.test(rel)) violations.push({ file: rel, reason: 'forbidden_ui' })
    if (/\.[cm]?[jt]sx?$/.test(resolved)) queue.push(resolved)
  }
  const visit = node => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause, binding = clause?.namedBindings
      const typeOnly = clause?.isTypeOnly || (!clause?.name && binding && ts.isNamedImports(binding) && binding.elements.length && binding.elements.every(e => e.isTypeOnly))
      if (!typeOnly) add(node.moduleSpecifier.text, 'import')
    }
    if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) add(node.moduleSpecifier.text, 'export')
    if (ts.isCallExpression(node) && node.arguments.length && ts.isStringLiteral(node.arguments[0]) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) add(node.arguments[0].text, 'dynamic')
    ts.forEachChild(node, visit)
  }
  visit(source)
}
const report = { createdAt: new Date().toISOString(), tests: tests.length, visitedFiles: seen.size, method: 'TypeScript AST imports/exports/dynamic import/require; type-only edges excluded; app runtime closure must stay in services/engine or test fixtures; sibling backend recorded separately and isolated', edges, violations, passed: violations.length === 0 }
fs.writeFileSync('../../test-portability-runtime-audit.json', JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ tests: tests.length, visitedFiles: seen.size, violations, passed: report.passed }))
process.exitCode = report.passed ? 0 : 1
