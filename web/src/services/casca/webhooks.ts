import type { WebhookService } from '../types'
import { captureEngineContext, engineSession } from '../engine/session'
import { createIntegrationService } from '../engine/integrations'
import { createAfterHttpService } from '../engine/after-http'

/** A test targets an already configured action and agent. It never creates a destination from a URL. */
export const realWebhooks: WebhookService = {
  async test(cfg, onProgress) {
    if (!cfg.agentId || !cfg.actionId) throw Error('Salve e selecione uma requisição do assistente antes de testá-la.')
    const context = captureEngineContext('integrations:execute'), identity = engineSession.getSnapshot().data!.identity.context
    const api = createIntegrationService(context), action = (await api.actions()).find(a => a.id === cfg.actionId && a.agentIds.includes(cfg.agentId!))
    if (!action || !action.enabled) throw Error('Esta requisição não está disponível para o assistente.')
    const after = await createAfterHttpService(context).config(cfg.agentId)
    if (action.executionTiming === 'after' || after.configuration.enabled && after.configuration.actionId === action.id) throw Error('Esta requisição é executada ao encerrar a conversa.')
    const key = `kloel-casca-http-test:${identity.userId}:${identity.tenantId}:${cfg.agentId}:${action.id}`
    if (window.sessionStorage.getItem(key)) throw Error('Há um teste sem confirmação. Consulte a operação original antes de repetir.')
    const reference = JSON.stringify({ context: identity, key: crypto.randomUUID(), actionId: action.id, revision: action.revision })
    window.sessionStorage.setItem(key, reference); context.assertCurrent(); if (window.sessionStorage.getItem(key) !== reference) throw Error('Não foi possível preservar o acompanhamento do teste.')
    onProgress?.({ step: 1, total: 1, label: 'Enviando requisição…', percent: 50 })
    const result = await api.execute(action.id, cfg.arguments ?? {}, JSON.parse(reference).key); context.assertCurrent()
    if (result.operation.status === 'endpoint_acknowledged' || result.operation.status === 'not_sent') window.sessionStorage.removeItem(key)
    if (result.operation.status !== 'endpoint_acknowledged' || result.operation.httpStatus === null || result.operation.durationMs === null) throw Error('O recebimento da requisição ainda não foi confirmado.')
    return { status: 'success', code: result.operation.httpStatus, ms: result.operation.durationMs, response: 'O destino confirmou o recebimento da requisição.' }
  },
}
