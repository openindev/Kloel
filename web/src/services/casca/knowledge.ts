import { useStore } from '@/data/store'
import { createKnowledgeService, type KnowledgeEntry } from '../engine/knowledge'
import { captureEngineContext, engineSession, type EngineContext } from '../engine/session'
import { EngineError } from '../engine/http'
import type { ExpectedContext } from '../engine/types'
import { projectKnowledge } from './agents'

const working = new Set<string>()
function publish(context: EngineContext, row: KnowledgeEntry) {
  context.assertCurrent()
  const st = useStore.getState(), projected = projectKnowledge(row)
  if (st.db.knowledgeEntries.some(x => x.id === row.id)) st.patch('knowledgeEntries', row.id, projected.entry)
  else st.insert('knowledgeEntries', projected.entry)
  if (projected.source) {
    if (st.db.knowledgeSources.some(x => x.id === row.id)) st.patch('knowledgeSources', row.id, projected.source)
    else st.insert('knowledgeSources', projected.source)
  }
}

/** Actual import/extraction/indexing APIs. Storage contains only context and entry identifiers. */
export function knowledgeCommands(agentId: string, slot = 'create') {
  const context = captureEngineContext('knowledge:write'), expected = engineSession.getSnapshot().data!.identity.context
  return createKnowledgeCommands(context, expected, window.sessionStorage, agentId, slot)
}
export function createKnowledgeCommands(context: EngineContext, expected: ExpectedContext, storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, agentId: string, slot = 'create', publishRow = publish) {
  const api = createKnowledgeService(context, agentId)
  const key = `kloel-casca-knowledge:${expected.userId}:${expected.tenantId}:${agentId}:${slot}`
  type Reference = { context: typeof expected; entryId: string | null }
  const read = (): Reference | null => {
    const value = storage.getItem(key)
    if (!value) return null
    const ref = JSON.parse(value)
    if (!ref || Object.keys(ref).sort().join(',') !== 'context,entryId' || JSON.stringify(ref.context) !== JSON.stringify(expected) || ref.entryId !== null && (typeof ref.entryId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(ref.entryId))) throw Error('A importação pendente pertence a outra sessão ou não pôde ser lida.')
    return ref
  }
  const write = (ref: Reference | null) => {
    context.assertCurrent()
    const value = ref && JSON.stringify(ref)
    if (value) storage.setItem(key, value); else storage.removeItem(key)
    context.assertCurrent()
    if (storage.getItem(key) !== value) throw Error('Não foi possível preservar a referência da importação.')
  }
  const consult = async () => {
    context.assertCurrent()
    const ref = read()
    if (!ref?.entryId) throw Error('O resultado da importação não foi confirmado. Atualize as fontes e confira o conteúdo antes de iniciar outra importação; nada foi reenviado.')
    const row = await api.get(ref.entryId)
    publishRow(context, row)
    if (!row.indexed) throw Error('A fonte foi salva, mas a indexação ainda não foi confirmada. Nada foi reenviado.')
    write(null)
    return row
  }
  async function create(start: () => Promise<KnowledgeEntry>) {
    context.assertCurrent()
    if (working.has(key)) throw Error('Aguarde a importação em andamento.')
    if (read()) return consult()
    working.add(key)
    try {
      write({ context: expected, entryId: null })
      let row: KnowledgeEntry
      try { row = await start() }
      catch (error) {
        context.assertCurrent()
        if (error instanceof EngineError && error.status >= 400 && error.status < 500 && !['context_mismatch','context_changed_in_flight'].includes(error.code)) write(null)
        throw error
      }
      write({ context: expected, entryId: row.id }); publishRow(context, row)
      let ingestError: unknown
      try { await api.ingest(row.id) } catch (error) { ingestError = error /* GET is the only recovery from an uncertain indexing response. */ }
      const result = await consult()
      if (ingestError instanceof EngineError && ingestError.status >= 400 && ingestError.status < 500) {
        write(null)
        throw Error(`O conteúdo foi importado, mas a indexação falhou: ${ingestError.message}`)
      }
      return result
    } finally { working.delete(key) }
  }
  return {
    consult,
    createText: (title: string, content: string) => {
      if (!title.trim() || title.length > 200 || !content.trim() || content.length > 100000) throw Error('Informe uma pergunta de até 200 caracteres e uma resposta de até 100 mil caracteres.')
      return create(() => api.createText({ title, content, tags: [] }))
    },
    importWebsite: (address: string) => {
      const url = new URL(/^https?:\/\//i.test(address) ? address : `https://${address}`)
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || address.length > 200) throw Error('Informe uma URL pública de até 200 caracteres.')
      return create(() => api.importUrl(address, url.href))
    },
    async generate(sourceId: string) {
      if (working.has(key)) throw Error('Aguarde a operação atual.')
      working.add(key)
      try {
        const result = await api.generateInfo(sourceId)
        const st = useStore.getState()
        for (const id of result.removedIds) st.remove('knowledgeEntries', id)
        for (const item of result.items) {
          publishRow(context, item)
          try { await api.ingest(item.id) } catch { /* o texto fica salvo; a busca vetorial depende da indexação */ }
        }
        return result.created
      } finally { working.delete(key) }
    },
    upload: (title: string, file: File) => {
      if (!title.trim() || title.length > 200 || !file.size || file.size > 10 * 1024 * 1024 || file.name.length > 200) throw Error('Este envio aceita documento de até 10 MiB e nome de até 200 caracteres.')
      return create(() => api.upload(title, file))
    },
    async update(entryId: string, title: string, content: string) {
      if (working.has(key)) throw Error('Aguarde o salvamento atual.')
      working.add(key)
      try {
        const row = await api.update(entryId, { title, content, tags: [] }); publishRow(context, row)
        try { await api.ingest(row.id) } catch { /* No provider retry. */ }
        const current = await api.get(row.id); publishRow(context, current)
        if (!current.indexed) throw Error('O conteúdo foi salvo, mas a indexação ainda não foi confirmada.')
        return current
      } finally { working.delete(key) }
    },
    async remove(entryId: string) {
      if (working.has(key)) throw Error('Aguarde a operação atual.')
      working.add(key)
      try {
        try { await api.remove(entryId) }
        catch (error) { context.assertCurrent(); try { await api.get(entryId); throw error } catch (readError) { if (!(readError instanceof EngineError && readError.status === 404)) throw error } }
        context.assertCurrent(); const st = useStore.getState(); st.remove('knowledgeEntries', entryId); st.remove('knowledgeSources', entryId)
      } finally { working.delete(key) }
    },
  }
}
