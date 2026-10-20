import { PUBLIC, APP } from './smoke-routes.mjs'

export const routes = [...PUBLIC.map(template => ({ template, group: 'pub' })), ...APP.map(template => ({ template, group: 'app' }))]
export function localPath(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !/[\r\n\\]/.test(value)
}
export function resolveRoute(template, mode, inventory, mappings = {}) {
  const override = mappings[template]
  if (override !== undefined) {
    if (!override || !localPath(override.path) || !Array.isArray(override.expectedPaths) || !override.expectedPaths.length || !override.expectedPaths.every(localPath)) throw new Error('invalid_route_map')
    return override
  }
  let route = template
  if (mode === 'engine') {
    for (const [seed, replacement] of [['agt_roberta', inventory.agentIds?.[0]], ['agt_maria', inventory.agentIds?.[1]], ['cnv_001', inventory.conversationIds?.[0]], ['cnt_1', inventory.contactIds?.[0]]]) {
      if (!route.includes(seed)) continue
      if (!replacement || !/^[A-Za-z0-9_-]{1,128}$/.test(replacement)) throw new Error('missing_route_data')
      route = route.replace(seed, replacement)
    }
    if (route.startsWith('/r/clinica-bem-viver') || route.startsWith('/c/clinica-bem-viver')) throw new Error('public_route_mapping_required')
  }
  const dest = ['/agents', '/inbox', '/billing'].includes(route) ? `/app${route}` : route
  let expectedPaths = [dest]
  if (dest === '/app/agents' && inventory.agentIds?.length) expectedPaths = [`/app/agents/${inventory.agentIds[0]}/general`]
  if (dest === '/app/scheduling' && inventory.eventTypeIds?.length) expectedPaths = [`/app/scheduling/${inventory.eventTypeIds[0]}/general`]
  if (dest.startsWith('/app/inbox/')) expectedPaths = [`/app/inbox?id=${encodeURIComponent(dest.slice('/app/inbox/'.length))}`]
  if (dest === '/app/inbox' && inventory.conversationIds?.length) expectedPaths.push(...inventory.conversationIds.map(id => `/app/inbox?id=${encodeURIComponent(id)}`))
  return { path: route, expectedPaths, ...(route === '/demo-ia?website=bemviver.example' ? { generatedDemoId: true } : {}) }
}
/** This shell flow only appends its generated ID, preserving the original website and all other URL fields. */
export function generatedDemoDestination(route, destination, now = Date.now()) {
  if (!route.generatedDemoId || route.path !== '/demo-ia?website=bemviver.example' || !localPath(destination)) return false
  const source = new URL(route.path, 'https://local.invalid'), actual = new URL(destination, 'https://local.invalid')
  if (actual.pathname !== source.pathname || actual.hash || actual.searchParams.getAll('id').length !== 1) return false
  const id = actual.searchParams.get('id')
  if (!/^[a-z0-9]{9,12}$/.test(id)) return false
  const created = parseInt(id.slice(0, 8), 36), randomPart = parseInt(id.slice(8), 36)
  if (Math.abs(now - created) > 60000 || randomPart >= 1000000) return false
  actual.searchParams.delete('id')
  return actual.searchParams.toString() === source.searchParams.toString()
}
export function inspectFailure({ template, route, info, errors, mode }) {
  const failures = [...errors]
  if (!info) failures.push('missing_inspection')
  else {
    if (!route.expectedPaths.includes(info.url) && !generatedDemoDestination(route, info.url)) failures.push('unexpected_destination')
    if (info.textLen < 40) failures.push('empty_body')
    if (info.pending) failures.push('placeholder')
    if (info.notFound && template !== '/rota-inexistente') failures.push('unexpected_404')
    if (info.loading) failures.push('loading_unresolved')
    if (info.errorState) failures.push('application_error')
    if (mode === 'engine' && info.demoBadge) failures.push('demo_visible_in_engine')
  }
  return failures
}
