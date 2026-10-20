import type { ProgressFn } from '../runtime'
import { captureEngineContext, engineSession } from '../engine/session'
import { accountClient, type Connection } from '../engine/account'
import { createCalendlyService, type CalendlyConnection, type CalendlyEventType } from '../engine/calendly'

const pause = () => new Promise(resolve => setTimeout(resolve, 1000))
const progress = (onProgress?: ProgressFn) => onProgress?.({ step: 1, total: 2, label: 'Conclua a conexão na janela do provedor.', percent: 50 })

export async function connectSheets(onProgress?: ProgressFn): Promise<Connection> {
  const context = captureEngineContext('integrations:execute'), userId = engineSession.getSnapshot().data!.identity.userId
  const popup = window.open('about:blank', '_blank', 'popup,width=640,height=760')
  if (!popup) throw Error('Permita a abertura da janela para conectar sua conta.')
  const api = accountClient(context, userId)
  try {
    const before = await api.connections(); context.assertCurrent()
    const url = await api.start('google', ['sheets_read', 'sheets_append']); context.assertCurrent()
    if (popup.closed) throw Error('A conexão foi cancelada.')
    popup.location.href = url; progress(onProgress)
    const deadline = Date.now() + 10 * 60000
    while (Date.now() < deadline) {
      await pause(); context.assertCurrent()
      const changed = (await api.connections()).filter(c => c.provider === 'google' && c.status === 'connected' && c.capabilities.includes('sheets_read') && c.capabilities.includes('sheets_append') && !before.some(old => old.id === c.id && old.authorizationGeneration === c.authorizationGeneration))
      context.assertCurrent()
      if (changed.length > 1) throw Error('Mais de uma conexão mudou. Atualize as conexões e selecione a conta.')
      if (changed.length === 1) return changed[0]
      if (popup.closed) throw Error('A conexão não foi concluída.')
    }
    throw Error('O tempo para conectar a conta terminou.')
  } finally { popup.close() }
}

export async function connectCalendly(onProgress?: ProgressFn): Promise<{ connection: CalendlyConnection; eventTypes: CalendlyEventType[] }> {
  const context = captureEngineContext('integrations:execute'), expected = engineSession.getSnapshot().data!.identity.context
  const popup = window.open('about:blank', '_blank', 'popup,width=640,height=760')
  if (!popup) throw Error('Permita a abertura da janela para conectar sua conta.')
  const api = createCalendlyService(context), storage = window.sessionStorage
  const slot = `kloel-casca-calendly-connect:${expected.userId}:${context.tenantId}`
  try {
    let saved = storage.getItem(slot), fresh = false
    if (saved === null) { saved = JSON.stringify({ context: expected, key: crypto.randomUUID() }); storage.setItem(slot, saved); fresh = true }
    context.assertCurrent()
    if (storage.getItem(slot) !== saved) throw Error('Não foi possível acompanhar a conexão.')
    const attempt = JSON.parse(saved)
    if (JSON.stringify(attempt.context) !== JSON.stringify(expected) || !/^[0-9a-f-]{36}$/i.test(attempt.key)) throw Error('Esta conexão pertence a outra sessão.')
    let operation
    if (fresh) {
      try { const started = await api.start(attempt.key); operation = { status: 'pending' as const, authorizationUrl: started.authorizationUrl, connectionId: null, expiresAt: started.expiresAt } }
      catch { context.assertCurrent(); operation = await api.oauthOperation(attempt.key) }
    } else operation = await api.oauthOperation(attempt.key)
    if (operation.status === 'pending' && operation.authorizationUrl) { if (popup.closed) throw Error('A conexão foi cancelada.'); popup.location.href = operation.authorizationUrl; progress(onProgress) }
    const deadline = Math.min(Date.now() + 10 * 60000, Date.parse(operation.expiresAt))
    while (operation.status === 'pending' && Date.now() < deadline) {
      await pause(); context.assertCurrent(); operation = await api.oauthOperation(attempt.key)
      if (popup.closed && operation.status !== 'connected') throw Error('A conexão ainda não foi confirmada. Abra novamente para consultar a mesma solicitação.')
    }
    if (operation.status === 'expired') { storage.removeItem(slot); throw Error('A autorização expirou. Inicie a conexão novamente.') }
    if (operation.status !== 'connected' || !operation.connectionId) throw Error('A conexão ainda não foi confirmada. Tente consultar novamente.')
    const connection = (await api.connections()).find(c => c.id === operation.connectionId && c.status === 'connected')
    if (!connection) throw Error('A conta conectada ainda não está disponível para agendamentos.')
    const eventTypes: CalendlyEventType[] = []; let cursor: string | undefined
    for (let page = 0; page < 1000; page++) {
      const result = await api.eventTypes(connection, cursor); eventTypes.push(...result.items)
      if (!result.nextCursor) { context.assertCurrent(); storage.removeItem(slot); return { connection, eventTypes } }
      if (result.nextCursor === cursor) throw Error('Não foi possível carregar todos os tipos de evento.')
      cursor = result.nextCursor
    }
    throw Error('A lista de eventos excedeu o limite de consulta.')
  } finally { popup.close() }
}
