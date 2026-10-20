import assert from 'node:assert/strict'
import test from 'node:test'
import { routes, resolveRoute, inspectFailure, generatedDemoDestination } from '../scripts/smoke-contract.mjs'

test('the original 71 route templates remain represented exactly once', () => {
  assert.equal(routes.length, 71)
  assert.equal(new Set(routes.map(row => row.template)).size, 71)
  assert.equal(routes.filter(row => row.group === 'pub').length, 33)
  assert.equal(routes.filter(row => row.group === 'app').length, 38)
})
test('engine routes need real identifiers and cannot fall back to demo identifiers', () => {
  assert.throws(() => resolveRoute('/app/agents/agt_roberta/general', 'engine', {}), /missing_route_data/)
  assert.throws(() => resolveRoute('/app/agents/agt_maria/general', 'engine', { agentIds: ['first'] }), /missing_route_data/)
  assert.equal(resolveRoute('/app/agents/agt_roberta/general', 'engine', { agentIds: ['server-agent'] }).path, '/app/agents/server-agent/general')
  assert.throws(() => resolveRoute('/c/clinica-bem-viver/avaliacao', 'engine', {}), /public_route_mapping_required/)
  assert.throws(() => resolveRoute('/r/clinica-bem-viver', 'engine', {}), /public_route_mapping_required/)
  assert.equal(resolveRoute('/app/agents/agt_roberta/general', 'reference', {}).path, '/app/agents/agt_roberta/general')
})
test('expected destinations follow shell aliases and inbox canonical URL only', () => {
  assert.deepEqual(resolveRoute('/agents', 'engine', { agentIds: ['a'] }).expectedPaths, ['/app/agents/a/general'])
  assert.deepEqual(resolveRoute('/app/inbox/cnv_001', 'engine', { conversationIds: ['c'] }).expectedPaths, ['/app/inbox?id=c'])
  assert.deepEqual(resolveRoute('/inbox', 'engine', { conversationIds: ['c'] }).expectedPaths, ['/app/inbox', '/app/inbox?id=c'])
  const route = resolveRoute('/billing', 'engine', {})
  assert.deepEqual(route.expectedPaths, ['/app/billing'])
})
test('explicit mappings cannot navigate to a different origin', () => {
  for (const value of ['https://outside.test', '//outside.test', '/\\outside.test', '/ok\n']) {
    assert.throws(() => resolveRoute('/r/clinica-bem-viver', 'engine', {}, { '/r/clinica-bem-viver': { path: value, expectedPaths: ['/r/valid'] } }), /invalid_route_map/)
  }
})
test('nonempty error/loading/login/demo pages and unexpected destinations all fail', () => {
  const good = { url: '/app/billing', textLen: 100, pending: false, notFound: false, demoBadge: false, loading: false, errorState: false }
  const row = { template: '/billing', route: resolveRoute('/billing', 'engine', {}), info: good, errors: [], mode: 'engine' }
  assert.deepEqual(inspectFailure(row), [])
  for (const [patch, failure] of [[{ url: '/login' }, 'unexpected_destination'], [{ textLen: 0 }, 'empty_body'], [{ errorState: true }, 'application_error'], [{ loading: true }, 'loading_unresolved'], [{ pending: true }, 'placeholder'], [{ demoBadge: true }, 'demo_visible_in_engine'], [{ notFound: true }, 'unexpected_404']]) {
    assert.ok(inspectFailure({ ...row, info: { ...good, ...patch } }).includes(failure))
  }
  assert.ok(inspectFailure({ ...row, errors: ['console_error'] }).includes('console_error'))
  assert.deepEqual(inspectFailure({ ...row, template: '/rota-inexistente', route: { expectedPaths: ['/rota-inexistente'] }, info: { ...good, url: '/rota-inexistente', notFound: true } }), [])
})

test('scheduling index accepts only the oldest current-tenant event destination, and no event stays at the index', () => {
  assert.deepEqual(resolveRoute('/app/scheduling', 'engine', {}).expectedPaths, ['/app/scheduling'])
  const route = resolveRoute('/app/scheduling', 'engine', { eventTypeIds: ['first', 'second'] })
  assert.deepEqual(route.expectedPaths, ['/app/scheduling/first/general'])
  const good = { textLen: 100, pending: false, notFound: false, demoBadge: false, loading: false, errorState: false }
  for (const url of ['/app/scheduling', '/app/scheduling/second/general', '/app/scheduling/foreign/general', '/login']) assert.ok(inspectFailure({ template: '/app/scheduling', route, info: { ...good, url }, errors: [], mode: 'engine' }).includes('unexpected_destination'))
})
test('website demo may append exactly one fresh generated ID and nothing else', () => {
  const route = resolveRoute('/demo-ia?website=bemviver.example', 'reference', {}), now = Date.now(), id = `${now.toString(36)}abc`
  assert.equal(generatedDemoDestination(route, `/demo-ia?website=bemviver.example&id=${id}`, now), true)
  for (const url of [`/demo-ia?website=other.example&id=${id}`, `/demo-ia?website=bemviver.example&id=${id}&id=${id}`, `/demo-ia?website=bemviver.example&id=${id}&extra=1`, `/demo-ia?website=bemviver.example&id=${id}#unexpected`, '/demo-ia?website=bemviver.example&id=script%3Afoo', '/login', '/demo-ia?website=bemviver.example&id=oldinvalidid']) assert.equal(generatedDemoDestination(route, url, now), false, url)
  assert.equal(generatedDemoDestination(route, `/demo-ia?website=bemviver.example&id=${id}`, now + 61000), false)
  assert.equal(generatedDemoDestination(resolveRoute('/login', 'reference', {}), `/demo-ia?website=bemviver.example&id=${id}`, now), false)
})
