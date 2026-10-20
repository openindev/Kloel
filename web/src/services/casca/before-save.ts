import type { Agent } from '@/domain/types'
import { captureEngineContext, engineSession, type EngineContext } from '../engine/session'
import type { ExpectedContext } from '../engine/types'
import { createPhonesService } from '../engine/phones'
import { createWebchatService } from '../engine/webchat'
import { createBeforeFieldsService } from './before-context'
import { preflightBeforeFields, translateInbound } from './before-translation'
import { parseHttpConfiguration } from '../engine/before-http'

/** Returns only after the dedicated configuration APIs confirm their individual writes. */
export async function prepareBeforeFieldsForContext(base: Agent, next: Agent, context: EngineContext, expected: ExpectedContext, storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): Promise<null | (() => Promise<void>)> {
  const plan = preflightBeforeFields(base, next)
  if (!plan) return null
  context.assertCurrent()
  if (context.tenantId !== base.orgId || context.generation !== base.cascaEditor?.generation || !base.engineBefore?.http) throw Error('Atualize o assistente com um acesso de administrador antes de salvar a mensagem inicial.')
  let incomingNumberIds: string[] = [], webchatChannelIds: string[] = []
  if (plan.httpChanged && plan.inbound?.enabled) {
    const api = createPhonesService(context), phones = await api.listLocal(), channels = await api.listChannels()
    incomingNumberIds = phones.filter(row => row.agentId === base.id && row.capabilities.includes('voice') && !!row.providerNumberId && channels.some(channel => channel.id === row.channelId && channel.type === 'phone' && channel.enabled && channel.agentId === base.id)).map(row => row.id)
    // Chat assistants: the same form loads context when a visitor opens an enabled webchat channel of this assistant.
    try { webchatChannelIds = (await createWebchatService(context, base.id).list()).items.filter(row => row.enabled && row.provider === 'openai').map(row => row.id).slice(0, 20) } catch { webchatChannelIds = [] }
    // No outbound/default-route/public/private audience is inferred from this incoming-call form.
  } else { incomingNumberIds = base.engineBefore.http?.configuration?.audiences.incomingNumberIds ?? []; webchatChannelIds = base.engineBefore.http?.configuration?.audiences.webchatChannelIds ?? [] }
  if (plan.httpChanged) translateInbound(plan, incomingNumberIds, base.engineBefore, webchatChannelIds)
  else if ((plan.contextChanged || plan.reauthorizeHttp) && base.engineBefore.http?.configuration) parseHttpConfiguration(base.engineBefore.http.configuration, plan.configuration)
  const snapshot = base.engineBefore
  const service = createBeforeFieldsService(context, expected, storage, base.id)
  await service.checkPending()
  await service.validateSnapshot(snapshot)
  return async () => { await service.save(plan, snapshot, incomingNumberIds, webchatChannelIds) }
}
export async function prepareBeforeFields(base: Agent, next: Agent): Promise<null | (() => Promise<void>)> {
  if (!preflightBeforeFields(base, next)) return null
  const context = captureEngineContext('agents:write'), expected = engineSession.getSnapshot().data!.identity.context
  return prepareBeforeFieldsForContext(base, next, context, expected, window.sessionStorage)
}
export async function saveBeforeFields(base: Agent, next: Agent): Promise<boolean> {
  const save = await prepareBeforeFields(base, next)
  if (!save) return false
  await save(); return true
}
