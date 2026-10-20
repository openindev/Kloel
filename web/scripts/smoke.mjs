#!/usr/bin/env node
/** 71 route checks in an owned temporary browser. Engine authentication uses the actual login form.
 * KLOEL_URL=http://127.0.0.1:3004 KLOEL_SMOKE_EMAIL=... KLOEL_SMOKE_PASSWORD=... node scripts/smoke.mjs <new-output-dir> [--mobile] [--route-map=file.json]
 * --reference explicitly enables the immutable shell's local demo. It never counts as engine proof.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { routes, resolveRoute, inspectFailure } from './smoke-contract.mjs'

const args = process.argv.slice(2)
const flags = Object.fromEntries(args.filter(value => value.startsWith('--')).map(value => { const [key, ...rest] = value.slice(2).split('='); return [key, rest.length ? rest.join('=') : true] }))
const output = path.resolve(args.find(value => !value.startsWith('--')) || `docs/evidence/smoke-${Date.now()}`)
const mode = flags.reference ? 'reference' : 'engine'
const base = new URL(process.env.KLOEL_URL || (mode === 'reference' ? 'http://127.0.0.1:5173' : 'http://127.0.0.1:3004'))
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname) || base.pathname !== '/' || base.search || base.hash || base.username || base.password) throw new Error('Local HTTP origin required')
const viewport = flags.mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }
const chosen = routes.filter(row => !flags.only || row.template.startsWith(String(flags.only)))
if (!chosen.length) throw new Error('No matching routes')
const write = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n')
const reportName = `report${flags.mobile ? '_mobile' : ''}.json`
const now = () => new Date().toISOString()

if (!flags.worker) {
  fs.mkdirSync(output, { recursive: false })
  const env = { PATH: process.env.PATH, TMPDIR: os.tmpdir(), KLOEL_URL: base.origin, LANG: 'pt_BR.UTF-8' }
  for (const key of ['KLOEL_SMOKE_EMAIL', 'KLOEL_SMOKE_PASSWORD', 'KLOEL_CHROMIUM_PATH']) if (process.env[key]) env[key] = process.env[key]
  const childArgs = [fileURLToPath(import.meta.url), output, ...args.filter(value => value.startsWith('--')), '--worker']
  const child = spawn(process.execPath, childArgs, { detached: true, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env })
  let ownedBrowserPid = null
  child.on('message', message => {
    if (message?.type === 'owned-browser-start' && Number.isSafeInteger(message.pid) && message.pid > 1) ownedBrowserPid = message.pid
    if (message?.type === 'owned-browser-exit' && message.pid === ownedBrowserPid) ownedBrowserPid = null
  })
  const signalGroup = signal => { try { process.kill(-child.pid, signal) } catch (error) { if (error.code !== 'ESRCH') throw error } }
  const signalOwnedBrowser = signal => { if (ownedBrowserPid) try { process.kill(-ownedBrowserPid, signal) } catch (error) { if (error.code !== 'ESRCH') throw error } }
  let timedOut = false
  const watchdog = setTimeout(() => { timedOut = true; signalOwnedBrowser('SIGTERM'); signalGroup('SIGTERM'); setTimeout(() => { signalOwnedBrowser('SIGKILL'); signalGroup('SIGKILL') }, 2000).unref() }, 25 * 60 * 1000)
  const result = await new Promise(resolve => {
    child.once('error', error => resolve({ code: null, signal: null, error: error.code || 'spawn_failed' }))
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
  clearTimeout(watchdog)
  signalOwnedBrowser('SIGKILL') // PID received from this worker's own BrowserServer handle
  signalGroup('SIGKILL') // only this worker's temporary process group, never user Chrome
  const reportPath = path.join(output, reportName)
  const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : null
  const passed = !timedOut && result.code === 0 && report?.passed === true
  write('supervisor.json', { completedAt: now(), mode, viewport, timedOut, ...result, passed, fullRouteCoverage: passed && chosen.length === 71, providersValidated: false })
  console.log(JSON.stringify({ output, routes: report?.results?.length || 0, passed, fullRouteCoverage: passed && chosen.length === 71, mode }))
  process.exitCode = passed ? 0 : 1
} else {
  const { chromium } = await import('playwright-core')
  const mappings = flags['route-map'] ? JSON.parse(fs.readFileSync(path.resolve(String(flags['route-map'])), 'utf8')) : {}
  let browser, browserServer, context, page, currentStage = 'initialization', errors = []
  const results = [], bootstrap = [], anonymousChecks = [], inventory = { agentIds: [], conversationIds: [], contactIds: [], eventTypeIds: [] }
  const append = value => fs.appendFileSync(path.join(output, 'events.jsonl'), JSON.stringify({ at: now(), ...value }) + '\n')
  const classify = error => error?.name === 'TimeoutError' || error?.code === 'deadline' ? 'deadline' : typeof error?.message === 'string' && /^[a-z_]+$/.test(error.message) ? error.message : 'stage_failed'
  const deadline = async (name, action, ms = 15000) => {
    currentStage = name; append({ stage: name, status: 'started' }); let timer
    try { const result = await Promise.race([action(), new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('deadline'), { code: 'deadline' })), ms) })]); append({ stage: name, status: 'completed' }); return result }
    finally { clearTimeout(timer) }
  }
  const persist = passed => write(reportName, { completedAt: now(), base: base.origin, mode, viewport, expectedRoutes: chosen.length, results, bootstrap, anonymousChecks, passed, fullRouteCoverage: passed && chosen.length === 71, authentication: mode === 'reference' ? 'browser-local reference demo' : 'login form and real same-origin HTTP auth/me', providersValidated: false })
  const referenceLogin = async () => {
    await page.goto(new URL('/login', base).href, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.waitForFunction(() => Boolean(window.__kloelDemo?.login), null, { timeout: 10000 })
    await page.evaluate(async () => { await window.__kloelDemo.login('demo@kloel.ai', 'demo1234') })
    Object.assign(inventory, await page.evaluate(() => {
      const db = window.__kloelDemo.store.getState().db, org = db.session.orgId
      return { agentIds: db.agents.filter(row => row.orgId === org).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(row => row.id), conversationIds: db.conversations.filter(row => row.orgId === org).map(row => row.id), contactIds: db.contacts.filter(row => row.orgId === org).map(row => row.id), eventTypeIds: db.eventTypes.filter(row => row.orgId === org).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(row => row.id) }
    }))
  }
  const engineLogin = async () => {
    if (!process.env.KLOEL_SMOKE_EMAIL || !process.env.KLOEL_SMOKE_PASSWORD) throw new Error('engine_credentials_required')
    await page.goto(new URL('/login', base).href, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.locator('#li-email').fill(process.env.KLOEL_SMOKE_EMAIL)
    await page.locator('#li-password').fill(process.env.KLOEL_SMOKE_PASSWORD)
    const loginReply = page.waitForResponse(response => new URL(response.url()).origin === base.origin && new URL(response.url()).pathname === '/api/v1/auth/login' && response.request().method() === 'POST', { timeout: 15000 })
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    const response = await loginReply
    if (response.status() !== 200) throw new Error('engine_login_rejected')
    const found = await page.evaluate(async () => {
      const meResponse = await fetch('/api/v1/auth/me', { credentials: 'include', cache: 'no-store' })
      if (meResponse.status !== 200) throw new Error('engine_session_unverified')
      const me = await meResponse.json(), c = me.context
      if (!c?.tenantId || !c?.userId || !c?.membershipId || !c?.authorityVersion) throw new Error('engine_context_missing')
      const headers = { 'x-kloel-expected-user': c.userId, 'x-kloel-expected-tenant': c.tenantId, 'x-kloel-expected-membership': c.membershipId, 'x-kloel-expected-authority': c.authorityVersion }
      async function list(endpoint) {
        const response = await fetch('/api/v1' + endpoint, { credentials: 'include', cache: 'no-store', headers })
        if (response.status !== 200) throw new Error('engine_inventory_unavailable')
        const data = await response.json()
        if (!Array.isArray(data.items) || data.items.some(row => row.tenantId !== c.tenantId || !/^[A-Za-z0-9_-]{1,128}$/.test(row.id))) throw new Error('engine_inventory_invalid')
        return data.items.map(row => row.id)
      }
      async function eventTypeIds() {
        const rows = [], seen = new Set()
        for (let page = 1; page <= 100; page++) {
          const response = await fetch(`/api/v1/scheduling/event-types?page=${page}&limit=100`, { credentials: 'include', cache: 'no-store', headers })
          if (response.status !== 200) throw new Error('engine_event_inventory_unavailable')
          const data = await response.json()
          if (!Array.isArray(data.items) || data.page !== page || data.limit !== 100 || !Number.isSafeInteger(data.total) || data.totalPages !== Math.ceil(data.total / 100)) throw new Error('engine_event_inventory_invalid')
          for (const row of data.items) {
            if (row.tenantId !== c.tenantId || !/^[A-Za-z0-9_-]{1,128}$/.test(row.id) || !Number.isFinite(Date.parse(row.createdAt)) || seen.has(row.id)) throw new Error('engine_event_inventory_invalid')
            seen.add(row.id); rows.push(row)
          }
          if (page >= data.totalPages) { if (rows.length !== data.total) throw new Error('engine_event_inventory_changed'); return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(row => row.id) }
        }
        throw new Error('engine_event_inventory_limit')
      }
      return { agentIds: await list('/agents?page=1&limit=100&sort=createdAt&order=asc'), conversationIds: await list('/conversations?page=1&limit=25&sort=updatedAt&order=desc'), contactIds: await list('/crm/contacts?page=1&limit=100&sort=createdAt&order=asc'), eventTypeIds: await eventTypeIds() }
    })
    Object.assign(inventory, found)
    bootstrap.push({ stage: 'engine-authentication', httpLogin: 200, httpIdentity: 200, inventoryCounts: Object.fromEntries(Object.entries(found).map(([key, value]) => [key, value.length])) })
  }
  try {
    browserServer = await deadline('browser-launch', () => chromium.launchServer({ executablePath: process.env.KLOEL_CHROMIUM_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, timeout: 20000 }), 21000)
    const owned = browserServer.process(), ownedPid = owned.pid
    process.send?.({ type: 'owned-browser-start', pid: ownedPid })
    owned.once('exit', () => process.send?.({ type: 'owned-browser-exit', pid: ownedPid }))
    append({ stage: 'browser-owned', pid: ownedPid, workerPid: process.pid })
    browser = await deadline('browser-connect', () => chromium.connect(browserServer.wsEndpoint(), { timeout: 10000 }))
    context = await deadline('context', () => browser.newContext({ viewport, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', deviceScaleFactor: 1, reducedMotion: 'reduce' }))
    page = await deadline('page', () => context.newPage())
    page.setDefaultTimeout(10000)
    page.on('pageerror', () => errors.push('pageerror'))
    let authenticated = false, remaining = Infinity, resetAt = 0
    page.on('response', response => {
      const url = new URL(response.url())
      if (url.origin !== base.origin || !url.pathname.startsWith('/api/')) return
      const headers = response.headers(), budget = Number(headers['x-ratelimit-remaining']), reset = Number(headers['x-ratelimit-reset'])
      if (Number.isFinite(budget) && Number.isFinite(reset) && reset >= 0) { remaining = budget; resetAt = Date.now() + reset * 1000 + 300 }
      if (!authenticated && response.request().method() === 'GET' && url.pathname === '/api/v1/auth/me' && response.status() === 401) anonymousChecks.push({ path: url.pathname, status: 401, expected: true })
    })
    page.on('console', message => {
      if (message.type() !== 'error') return
      let location; try { location = new URL(message.location().url) } catch {}
      if (!authenticated && location?.origin === base.origin && location.pathname === '/api/v1/auth/me' && /status of 401/.test(message.text())) errors.push('anonymous_auth_401')
      else errors.push('console_error')
    })
    const respectRateBudget = async () => {
      if (remaining >= 50 || Date.now() >= resetAt) return
      const duration = Math.min(60300, Math.max(0, resetAt - Date.now()))
      append({ stage: 'respect-api-rate-limit', status: 'waiting', remaining, durationMs: duration })
      await new Promise(resolve => setTimeout(resolve, duration))
      remaining = Infinity
    }
    for (const row of chosen) {
      await respectRateBudget()
      if (row.group === 'app' && !authenticated) {
        try { await deadline('authentication', mode === 'reference' ? referenceLogin : engineLogin, 75000); authenticated = true }
        catch (error) { bootstrap.push({ stage: currentStage, error: classify(error) }); persist(false); throw error }
      }
      errors = []; let info = null, screenshot = null, route
      try {
        route = resolveRoute(row.template, mode, inventory, mappings)
        const response = await deadline('navigate', () => page.goto(new URL(route.path, base).href, { waitUntil: 'domcontentloaded', timeout: 45000 }), 46000)
        if (!response || response.status() >= 400) errors.push('navigation_http_error')
        await deadline('body-ready', () => page.waitForFunction(() => document.body.innerText.trim().length > 40 && !document.querySelector('[data-engine-state="loading"],[role="status"][aria-label="Carregando"],[aria-busy="true"]'), null, { timeout: 10000 }))
        await deadline('network-settled', () => page.waitForLoadState('networkidle', { timeout: 10000 }), 11000)
        await deadline('fonts-ready', () => page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: 10000 }), 11000)
        await deadline('images-ready', () => page.waitForFunction(() => [...document.images].filter(image => { const b = image.getBoundingClientRect(); return b.bottom > 0 && b.top < innerHeight && b.right > 0 && b.left < innerWidth }).every(image => image.complete && image.naturalWidth > 0), null, { timeout: 5000 }), 6000)
        info = await deadline('inspect', () => page.evaluate(() => ({ url: location.pathname + location.search, textLen: document.body.innerText.trim().length, pending: document.body.innerText.includes('Módulo em construção'), notFound: document.body.innerText.includes('Página não encontrada'), demoBadge: document.body.innerText.includes('Demonstração local'), loading: !!document.querySelector('[data-engine-state="loading"],[role="status"][aria-label="Carregando"]'), errorState: !!document.querySelector('[data-engine-state="error"]') })))
        screenshot = `${String(results.length + 1).padStart(2, '0')}-${row.group}${row.template.replace(/[^a-z0-9]+/gi, '_').slice(0, 80)}${flags.mobile ? '_mobile' : ''}.png`
        await deadline('screenshot', () => page.screenshot({ path: path.join(output, screenshot), timeout: 8000, animations: 'disabled' }), 9000)
      } catch (error) { errors.push(`${currentStage}:${classify(error)}`) }
      if (anonymousChecks.length) errors = errors.filter(error => error !== 'anonymous_auth_401')
      const failures = route ? inspectFailure({ ...row, route, info, errors, mode }) : [...errors, 'route_unresolved']
      if (!screenshot) failures.push('screenshot_missing')
      results.push({ ...row, route, info, screenshot, failures, passed: failures.length === 0 }); persist(false)
    }
  } catch (error) { bootstrap.push({ stage: currentStage, error: classify(error) }) }
  finally {
    if (context) try { await deadline('context-close', () => context.close(), 8000) } catch { bootstrap.push({ stage: 'context-close', error: 'deadline' }) }
    if (browser) try { await deadline('browser-disconnect', () => browser.close(), 8000) } catch { bootstrap.push({ stage: 'browser-disconnect', error: 'deadline' }) }
    if (browserServer) try { await deadline('browser-close', () => browserServer.close(), 20000) } catch {
      bootstrap.push({ stage: 'browser-close', error: 'deadline' })
      try { await deadline('browser-kill-owned', () => browserServer.kill(), 4000) } catch { bootstrap.push({ stage: 'browser-kill-owned', error: 'deadline' }) }
    }
    const passed = results.length === chosen.length && results.every(row => row.passed) && !bootstrap.some(row => row.error)
    persist(passed)
    process.exit(passed ? 0 : 1)
  }
}
