/** A recovery pointer only. Never store recipients, message bodies or template parameters. */
type AttemptStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const validKey = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value)
const unavailable = 'Não foi possível acessar a referência de envio desta aba. Nenhuma nova mensagem será enviada até que ela possa ser preservada.'

export function createWhatsAppAttemptReference(storage: () => AttemptStorage, userId: string, tenantId: string) {
  if (![userId, tenantId].every(value => /^[A-Za-z0-9_-]{1,150}$/.test(value))) throw new Error('Identidade de recuperação inválida.')
  const name = `kloel.whatsapp.attempt.v1:${userId}:${tenantId}`
  function parse(raw: string | null): string | undefined {
    if (raw === null) return undefined
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 || !('version' in value) || value.version !== 1 || !('key' in value) || !validKey(value.key)) throw new Error('A referência salva nesta aba está inválida. Ela foi preservada para evitar perder uma operação pendente.')
    return value.key
  }
  return {
    load(): { key?: string; error?: string } {
      try { return { key: parse(storage().getItem(name)) } }
      catch { return { error: unavailable } }
    },
    remember(key: string) {
      if (!validKey(key)) throw new Error('Chave de recuperação inválida.')
      try {
        const target = storage(), previous = parse(target.getItem(name))
        if (previous && previous !== key) throw new Error('Uma referência anterior continua pendente.')
        const value = JSON.stringify({ version: 1, key })
        target.setItem(name, value)
        if (target.getItem(name) !== value) throw new Error('Referência não persistida.')
      } catch { throw new Error(unavailable) }
    },
    forgetResolved(key: string) {
      if (!validKey(key)) throw new Error('Chave de recuperação inválida.')
      try {
        const target = storage(), previous = parse(target.getItem(name))
        if (previous && previous !== key) throw new Error('A referência mudou.')
        target.removeItem(name)
        if (target.getItem(name) !== null) throw new Error('Referência não removida.')
      } catch { throw new Error('A referência de envio foi mantida. Consulte-a novamente antes de iniciar outra mensagem.') }
    },
  }
}
