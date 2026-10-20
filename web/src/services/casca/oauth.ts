import type { CalendarConnection } from '@/domain/types'
import type { ProgressFn } from '@/services/runtime'
import { accountClient, authorizationUrl, type Capability, type Connection, type Provider } from '@/services/engine/account'
import { captureEngineContext, engineSession, type EngineContext } from '@/services/engine/session'

export interface ConnectOptions {
  scope: 'personal' | 'shared'
  features: ('calendar' | 'email')[]
  /** Reautoriza esta conexão: pede de novo tudo o que ela já tem (agenda, e-mail, planilhas) e o motor só conclui com a mesma conta. */
  reauthorize?: string
}
export interface OAuthWindow { closed: boolean; navigate(url: string): void; close(): void }
export interface OAuthEnvironment {
  open(): OAuthWindow | null
  now(): number
  wait(ms: number): Promise<void>
}
const browser: OAuthEnvironment = {
  open() {
    const popup = window.open('about:blank', '_blank', 'popup,width=640,height=760')
    if (!popup) return null
    return { get closed() { return popup.closed }, navigate: url => { popup.location.href = url }, close: () => popup.close() }
  },
  now: () => Date.now(),
  wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
}

export function projectConnection(row: Connection, tenantId: string, ownerUserId = ''): CalendarConnection {
  return { id: row.id, orgId: tenantId, provider: row.provider, email: row.email, scope: row.visibility,
    features: [...(row.capabilities.includes('calendar') ? ['calendar' as const] : []), ...(row.capabilities.includes('email') ? ['email' as const] : [])],
    ownerUserId, connectedAt: row.createdAt }
}

export function capabilitiesFor(options: ConnectOptions): Capability[] {
  if (!['personal', 'shared'].includes(options.scope) || !options.features.length || options.features.some(f => !['calendar', 'email'].includes(f))) {
    throw new Error('Escolha os recursos que você quer conectar.')
  }
  return [...(options.features.includes('calendar') ? ['calendar' as const, 'calendar_write' as const] : []),
    ...(options.features.includes('email') ? ['email' as const, 'email_send' as const] : [])]
}

/** Only a changed, server-confirmed authorization completes the original connect dialog. */
export async function connectAccount(context: EngineContext, userId: string, provider: Provider, options: ConnectOptions,
  onProgress?: ProgressFn, environment: OAuthEnvironment = browser): Promise<CalendarConnection> {
  context.assertCurrent()
  let capabilities = capabilitiesFor(options)
  if (!['google', 'microsoft'].includes(provider)) throw new Error('Escolha Google ou Microsoft.')
  const popup = environment.open()
  if (!popup) throw new Error('Permita a abertura da janela para conectar sua conta.')
  const client = accountClient(context, userId)
  const deadline = environment.now() + 10 * 60_000
  try {
    onProgress?.({ step: 0, total: 2, label: 'Conectando...', percent: 0 })
    const before = await client.connections()
    context.assertCurrent()
    // Reautorização: nenhum recurso que a conexão já tem pode cair (o motor mantém agendamentos, automações e planilhas dela).
    const target = options.reauthorize ? before.find(row => row.id === options.reauthorize) : undefined
    if (options.reauthorize && (!target || target.status !== 'connected' || target.provider !== provider || target.visibility !== options.scope)) throw new Error('A conexão desta conta mudou. Atualize a página e tente novamente.')
    // O motor só aceita a reautorização de quem autorizou a conta (do contrário criaria outra conexão).
    if (target?.owned === false) throw new Error(`Só quem conectou ${target.email} pode reconectá-la. Peça a essa pessoa para reconectar a caixa.`)
    if (target) capabilities = [...new Set([...capabilities, ...target.capabilities])]
    if (popup.closed) throw new Error('A conexão foi cancelada. Abra a janela novamente para continuar.')
    const result = await context.request<{ authorizationUrl: string }>(`/oauth/${provider}/start`, {
      method: 'POST', body: { capabilities, visibility: options.scope, ...(target ? { connectionId: target.id } : {}) },
    })
    context.assertCurrent()
    if (popup.closed) throw new Error('A conexão foi cancelada. Abra a janela novamente para continuar.')
    popup.navigate(authorizationUrl(result.authorizationUrl, provider))
    onProgress?.({ step: 1, total: 2, label: 'Conclua a conexão na janela do provedor.', percent: 50 })
    while (environment.now() < deadline) {
      await environment.wait(1000)
      context.assertCurrent()
      const rows = await client.connections()
      context.assertCurrent()
      if (target) {
        // Reautorização: só a própria conexão conclui. Outra conta é recusada pelo motor sem gravar nada (aviso na janela do provedor).
        const row = rows.find(r => r.id === target.id)
        if (row && row.authorizationGeneration !== target.authorizationGeneration) {
          if (row.status !== 'connected' || row.provider !== provider || row.visibility !== options.scope || !capabilities.every(capability => row.capabilities.includes(capability))) throw new Error('A conexão desta conta mudou durante a reconexão. Atualize a página e tente novamente.')
          onProgress?.({ step: 2, total: 2, label: 'Concluído', percent: 100 })
          return projectConnection(row, context.tenantId, userId)
        }
        // Também recusada pelo motor, sem gravar nada: a conta cujo endereço principal mudou no provedor (pararia o que depende dela).
        if (popup.closed) throw new Error(`A reconexão não foi concluída e nada mudou em ${target.email}. Se o ${provider === 'google' ? 'Google' : 'Microsoft'} mostrou outra conta, abra de novo e escolha ${target.email}. Se o endereço dessa conta mudou no ${provider === 'google' ? 'Google' : 'Microsoft'}, a reconexão é recusada para não parar o que depende dela; a janela de autorização listou o que pararia e como passar a usar o novo endereço.`)
        continue
      }
      const changed = rows.filter(row => row.provider === provider && row.visibility === options.scope && row.status === 'connected'
        && capabilities.every(capability => row.capabilities.includes(capability))
        && !before.some(previous => previous.id === row.id && previous.authorizationGeneration === row.authorizationGeneration))
      if (changed.length > 1) throw new Error('Mais de uma conta mudou. Atualize as conexões antes de continuar.')
      if (changed.length === 1) {
        onProgress?.({ step: 2, total: 2, label: 'Concluído', percent: 100 })
        return projectConnection(changed[0], context.tenantId, userId)
      }
      // Uma recusa do motor (ex.: o endereço principal da conta mudou no provedor e algo depende dele) aparece legível na janela.
      if (popup.closed) throw new Error('A conexão não foi concluída. Se a janela de autorização mostrou o motivo (por exemplo, que o endereço da conta mudou), nada foi alterado por essa recusa: siga a orientação dela. Senão, abra a janela novamente para continuar.')
    }
    throw new Error('O tempo para conectar a conta terminou. Inicie novamente.')
  } finally { popup.close() }
}

export async function connect(provider: Provider, _purpose: string, onProgress?: ProgressFn, options: ConnectOptions = { scope: 'personal', features: ['calendar'] }) {
  const context = captureEngineContext('integrations:execute')
  const userId = engineSession.getSnapshot().data!.identity.userId
  const connection = await connectAccount(context, userId, provider, options, onProgress)
  return { email: connection.email, connection }
}

export async function loadConnections(context: EngineContext): Promise<CalendarConnection[]> {
  const userId = engineSession.getSnapshot().data!.identity.userId
  const rows = await accountClient(context, userId).connections()
  context.assertCurrent()
  // The API only exposes a personal connection to its owner; of a shared one it only says whether it is the user's own.
  return rows.filter(row => row.status === 'connected').map(row => projectConnection(row, context.tenantId, row.visibility === 'personal' || row.owned ? userId : ''))
}
