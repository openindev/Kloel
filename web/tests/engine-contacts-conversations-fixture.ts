import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { JSDOM } from 'jsdom'
import Fastify from '../../engine/node_modules/fastify/fastify.js'
import cookie from '../../engine/node_modules/@fastify/cookie/index.js'
import { Store } from '../../engine/src/store'
import { registerAuth } from '../../engine/src/auth'
import { registerAccountProfile } from '../../engine/src/account-profile'
import { registerDomains } from '../../engine/src/domains'
import { registerCRM } from '../../engine/src/crm'
import { registerContactBlocks } from '../../engine/src/contact-blocks'
import { registerConversationControl } from '../../engine/src/conversation-control'
import { registerConversationEditorState } from '../../engine/src/conversation-editor-state'
import { registerConversationAnalysis } from '../../engine/src/conversation-analysis/routes'
import { ConversationAutoTagWorker, registerConversationAutoTags } from '../../engine/src/conversation-auto-tags'
import { registerCRMCapture } from '../../engine/src/crm-capture'
import { CRMCaptureWorker } from '../../engine/src/crm/capture/worker'

/** Web adapters of Contatos/Conversas against the real engine routes (in-process inject; no external provider). */
export async function contactsConversationsFixture(t: any) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:4424/app/inbox', pretendToBeVisual: true }), w = dom.window
  Object.assign(globalThis, { window: w, document: w.document, localStorage: w.localStorage, sessionStorage: w.sessionStorage, DOMParser: w.DOMParser })
  const envNames = ['PROVIDER_TENANT_ID', 'OPENAI_API_KEY', 'PLATFORM_AI_PROVIDERS'], previous = Object.fromEntries(envNames.map(k => [k, process.env[k]]))
  const store = new Store(), app = Fastify({ logger: false }); await app.register(cookie)
  const modelCalls: any[] = []
  const worker = new ConversationAutoTagWorker(store, { fetch: (async (_url: string, init: any) => {
    const body = JSON.parse(String(init.body)), input = JSON.parse(body.input); modelCalls.push(body)
    return Response.json({ id: 'synthetic', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ matches: [{ tagId: input.tags[0].id, reason: 'Pediu retorno.', messageIds: [input.messages[0].id] }] }) }] }] })
  }) as typeof fetch })
  await registerAuth(app, store); await registerAccountProfile(app, store); await registerDomains(app, store); await registerCRM(app, store); registerContactBlocks(app, store)
  await registerConversationControl(app, store); await registerConversationEditorState(app, store); await registerConversationAnalysis(app, store); await registerConversationAutoTags(app, store, worker)
  await registerCRMCapture(app, store, new CRMCaptureWorker(store, { fetch: (async () => { throw Error('No capture provider request expected') }) as typeof fetch }))
  const signup = await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email: `s4-${randomUUID()}@example.test`, password: 'synthetic-password-long', organization: 'S4 Org' } })
  assert.equal(signup.statusCode, 201, signup.body)
  const session = signup.cookies.find(c => c.name === 'kloel_session')!.value, tenant = signup.json().tenantId as string
  Object.assign(process.env, { PROVIDER_TENANT_ID: tenant, OPENAI_API_KEY: 'synthetic-never-external' }); delete process.env.PLATFORM_AI_PROVIDERS
  const requests: { path: string; method: string; body: any }[] = []
  const fetcher: typeof fetch = async (input, init = {}) => {
    const path = String(input), method = init.method ?? 'GET'; assert.ok(path.startsWith('/api/v1/'), 'UI transport cannot contact external providers')
    requests.push({ path, method, body: init.body ? JSON.parse(String(init.body)) : undefined })
    const raw = await app.inject({ method: method as any, url: path, headers: { ...Object.fromEntries(new Headers(init.headers)), cookie: `kloel_session=${session}` }, ...(init.body ? { payload: String(init.body) } : {}) })
    return new Response(raw.statusCode === 204 ? null : raw.body, { status: raw.statusCode, headers: { 'Content-Type': 'application/json' } })
  }
  globalThis.fetch = fetcher
  t.after(async () => { await app.close(); store.close(); dom.window.close(); for (const [k, v] of Object.entries(previous)) { if (v === undefined) delete process.env[k]; else process.env[k] = v } })
  const { engineSession } = await import('../src/services/engine/session')
  await engineSession.refresh(); assert.equal(engineSession.getSnapshot().phase, 'authenticated', JSON.stringify(engineSession.getSnapshot().error))
  return { store, app, tenant, requests, modelCalls }
}

