import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { TestContext } from 'node:test'
import type { RequestSpec } from '../../engine/src/integrations/transport'
import type { Address, SafeResponse } from '../../engine/src/ingestion/safe-url'
import { setBeforeHttpTransport } from '../../engine/src/before-context/http-resolution'
import { registerPhoneConfig } from '../../engine/src/phone-config'
import { createBeforeContextService } from '../src/services/engine/before-context'
import { createBeforeHttpService, type HttpConfiguration, type HttpSecrets } from '../src/services/engine/before-http'
import { beforeContextUIFixture } from './engine-before-context-fixture'
import { beforeVoiceUIFixture } from './engine-before-voice-fixture'

type ChatFixture = Awaited<ReturnType<typeof beforeContextUIFixture>>
type VoiceFixture = Awaited<ReturnType<typeof beforeVoiceUIFixture>>
type UIBase = ChatFixture | VoiceFixture

function attachHttp<F extends UIBase>(f: F) {
  const httpRequests: Array<{ url: string; address: Address; spec: RequestSpec }> = []
  const dns: string[] = []
  const httpHooks: {
    resolve?: (host: string) => Promise<Address[]> | Address[]
    request?: (spec: RequestSpec) => Promise<SafeResponse> | SafeResponse
  } = {}
  // This replaces only the source transport; all UI routes and authorization remain real.
  setBeforeHttpTransport(f.store, {
    resolve: async host => {
      dns.push(host)
      return httpHooks.resolve ? httpHooks.resolve(host) : [{ address: '93.184.216.34', family: 4 }]
    },
    request: async (url, address, spec) => {
      httpRequests.push({ url: url.href, address, spec })
      if (httpHooks.request) return httpHooks.request(spec)
      spec.onResponse?.(200)
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(JSON.stringify({ nome: 'Externo sintético', quantidade: 0, ativo: false })),
      }
    },
  })
  const httpBase = `/api/v1/agents/${f.agent.id}/before-context/http-source`
  const source: HttpConfiguration = {
    enabled: false,
    method: 'POST',
    audiences: {
      private: true,
      voicePrivate: true,
      webchatChannelIds: 'publicRequest' in f ? [f.channel.id] : [],
      incomingNumberIds: 'number' in f ? [f.number.id] : [],
      incomingDefaultRoute: false,
    },
    mappings: f.sample.variables.map(variable => ({ variable: variable.name, jsonPointer: '/' + variable.name })),
    conditions: [],
    schedule: null,
  }
  const secrets: Extract<HttpSecrets, { mode: 'replace' }> = {
    mode: 'replace',
    url: 'https://context.example.com/context',
    headers: { authorization: 'Bearer synthetic-before-http-secret' },
    bodyTemplate: { name: { $before: 'vars.nome' }, surface: { $before: 'system.surface' } },
  }
  const configureHttp = (
    configuration: HttpConfiguration = source,
    revision = 0,
    key = randomUUID(),
    inputSecrets: HttpSecrets = secrets,
    beforeRevision = 1,
  ) => f.app.inject({
    method: 'PUT',
    url: httpBase,
    headers: { 'content-type': 'application/json', ...f.headers },
    ...('cookies' in f ? { cookies: f.cookies } : {}),
    payload: JSON.stringify({
      expectedTenantId: f.actor.tenantId,
      expectedRevision: revision,
      expectedBeforeRevision: beforeRevision,
      idempotencyKey: key,
      configuration,
      secrets: inputSecrets,
    }),
  })
  const enableHttp = async (configuration: HttpConfiguration = { ...source, enabled: true }, beforeRevision = 1) => {
    let response = await configureHttp(source, 0, randomUUID(), secrets, beforeRevision)
    assert.equal(response.statusCode, 200, response.body)
    response = await configureHttp(configuration, 1, randomUUID(), { mode: 'keep' }, beforeRevision)
    assert.equal(response.statusCode, 200, response.body)
    return response.json().operation
  }
  const httpClient = createBeforeHttpService(f.context, f.agent.id)
  return {
    ...f,
    client: httpClient,
    httpClient,
    before: createBeforeContextService(f.context, f.agent.id),
    httpBase,
    source,
    secrets,
    configureHttp,
    enableHttp,
    httpRequests,
    dns,
    httpHooks,
    httpWrites: () => f.calls.filter(call => call.method !== 'GET' && call.path.endsWith('/before-context/http-source')),
  }
}

export function beforeHttpUIFixture(t: TestContext, options: { voice: true }): Promise<ReturnType<typeof attachHttp<VoiceFixture>> & { voiceClient: VoiceFixture['client'] }>
export function beforeHttpUIFixture(t: TestContext, options?: { voice?: false }): Promise<ReturnType<typeof attachHttp<ChatFixture>>>
export function beforeHttpUIFixture(t: TestContext, options: { voice?: boolean }): Promise<ReturnType<typeof attachHttp<UIBase>>>
export async function beforeHttpUIFixture(t: TestContext, options: { voice?: boolean } = {}) {
  // Both ancestors install their closed fetcher before returning; DOM tests can import session afterward.
  if (options.voice) {
    const f = await beforeVoiceUIFixture(t)
    return { ...attachHttp(f), voiceClient: f.client }
  }
  return attachHttp(await beforeContextUIFixture(t, registerPhoneConfig))
}
