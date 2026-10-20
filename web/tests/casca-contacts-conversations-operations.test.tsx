import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { deflateRawSync } from 'node:zlib'
import { JSDOM } from 'jsdom'
import { conversationTagCatalogs } from '../../engine/src/conversation-editor-state'
import { contactsConversationsFixture as fixture } from './engine-contacts-conversations-fixture'

test('Contatos e Conversas: criar contato a partir da conversa, trocar vínculo, responsável, resolver/reabrir e etiquetas automáticas', async t => {
  const f = await fixture(t)
  const { captureEngineContext } = await import('../src/services/engine/session')
  const { loadContacts, saveContact, linkConversationToContact } = await import('../src/services/casca/contacts')
  const { loadConversation, publishConversation, setConversationStatus, runConversationAutoTags, loadAutoTagAutomation, updateConversationEditor } = await import('../src/services/casca/conversations')
  const { publishSlice } = await import('../src/services/casca/data')
  const { useStore } = await import('../src/data/store')
  const conversation = f.store.create(f.tenant, 'conversations', { subject: 'Retorno', channel: 'webchat', status: 'open' })
  f.store.create(f.tenant, 'messages', { conversationId: conversation.id, role: 'user', content: 'Por favor, alguém da equipe me ligue de volta.' })
  const context = captureEngineContext()
  publishSlice(context, await loadContacts(context))
  // Conversas › "Criar contato": o contato nasce vinculado à conversa de origem.
  const created = await saveContact({ firstName: 'Marina', lastName: 'Teixeira', phones: [{ value: '+5562991110009', label: '' }], emails: [], company: '', notes: '', fields: {} }, undefined, conversation.id)
  assert.equal(f.store.get(f.tenant, 'conversations', conversation.id)?.contactId, created.id)
  const other = await saveContact({ firstName: 'Bia', lastName: '', phones: [{ value: '+5562991110010', label: '' }], emails: [], company: '', notes: '', fields: {} })
  await assert.rejects(linkConversationToContact(other.id, conversation.id), /já está vinculada/)
  const moved = await linkConversationToContact(other.id, conversation.id, true)
  assert.equal(moved.previousContactId, created.id); assert.equal(f.store.get(f.tenant, 'conversations', conversation.id)?.contactId, other.id)
  // Responsável, resolver/reabrir (controle versionado) e etiquetas automáticas.
  let loaded = await loadConversation(context, conversation.id); publishConversation(context, loaded)
  const me = (await (await fetch('/api/v1/auth/me')).json()).userId
  loaded = await updateConversationEditor(loaded, { assigneeUserId: me }); assert.equal(loaded.assigneeUserId, me)
  loaded = await updateConversationEditor(loaded, { assigneeUserId: null }); assert.equal(loaded.assigneeUserId, undefined)
  const closed = await setConversationStatus(loaded, 'closed'); assert.equal(f.store.get(f.tenant, 'conversations', conversation.id)?.status, 'closed'); assert.equal(closed.chatActive, false)
  const reopened = await setConversationStatus(closed, 'open'); assert.equal(f.store.get(f.tenant, 'conversations', conversation.id)?.status, 'open'); assert.equal(reopened.chatActive, true)
  await assert.rejects(setConversationStatus({ ...reopened, channel: 'phone' }, 'closed'), /Ligações/)
  const tag = { id: randomUUID(), label: 'Retornar ligação', color: '#585df5', autoAdd: true, condition: 'A pessoa pediu retorno da equipe.' }
  f.store.create(f.tenant, conversationTagCatalogs, { tags: [tag], revision: 1 })
  const automation = await loadAutoTagAutomation(); assert.equal(automation.available, true); assert.equal(automation.rules, 1)
  const run = await runConversationAutoTags(reopened)
  assert.equal(run.status, 'applied'); assert.deepEqual(run.appliedTagIds, [tag.id]); assert.equal(f.modelCalls.length, 1)
  assert.ok(useStore.getState().db.conversations.find(c => c.id === conversation.id)?.tagIds.includes(tag.id), 'conversation reloaded with the automatic tag')
})

test('exportação de contatos neutraliza fórmulas e a importação lê planilhas .xlsx (armazenadas ou comprimidas)', async () => {
  const dom = new JSDOM(''); Object.assign(globalThis, { DOMParser: dom.window.DOMParser })
  const { contactExportTable } = await import('../src/app/pages/contacts/exportContacts')
  const { buildXlsx } = await import('../src/app/pages/inbox/xlsx')
  const { readXlsxRows } = await import('../src/app/pages/contacts/xlsxRead')
  const contact = { id: 'c1', orgId: 'o', firstName: '=HYPERLINK("x")', lastName: 'Silva', phones: [{ value: '+55 62 99111-0001', label: '' as const }], emails: [], company: '@empresa', notes: '', fields: { f1: 'Ouro' }, source: 'manual' as const, createdAt: '2026-10-20T04:00:00.000Z', updatedAt: '2026-10-20T04:00:00.000Z' }
  const table = contactExportTable([contact as any], [{ id: 'f1', label: 'Plano', type: 'text', description: '', aiFill: false }], [])
  assert.equal(table.header.at(-1), 'Plano'); assert.equal(table.rows[0]![0], `'=HYPERLINK("x")`); assert.equal(table.rows[0]![2], '+55 62 99111-0001'); assert.equal(table.rows[0]![4], "'@empresa"); assert.equal(table.rows[0]!.at(-1), 'Ouro')
  const stored = await buildXlsx('Contatos', ['Nome', 'Telefone'], [['Ana', '+5562991110001'], ['Bruno', '']]).arrayBuffer()
  assert.deepEqual(await readXlsxRows(stored), [['Nome', 'Telefone'], ['Ana', '+5562991110001'], ['Bruno', '']])
  // Planilha do Excel típica: entradas "deflate", strings compartilhadas e células numéricas/booleanas.
  const files: [string, string][] = [
    ['xl/workbook.xml', '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="A" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet7.xml"/></Relationships>'],
    ['xl/sharedStrings.xml', '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Nome</t></si><si><t>Idade</t></si><si><r><t>Car</t></r><r><t>la</t></r></si></sst>'],
    ['xl/worksheets/sheet7.xml', '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="b"><v>1</v></c><c r="C2"><v>42</v></c></row></sheetData></worksheet>'],
  ]
  assert.deepEqual(await readXlsxRows(zip(files)), [['Nome', '', 'Idade'], ['Carla', 'Sim', '42']])
  await assert.rejects(readXlsxRows(new TextEncoder().encode('nome,telefone').buffer as ArrayBuffer))
})

/** ZIP mínimo com entradas comprimidas por deflate (método 8), como o Excel grava. */
function zip(entries: [string, string][]): ArrayBuffer {
  const enc = new TextEncoder(), parts: Uint8Array[] = [], central: Uint8Array[] = []; let offset = 0
  for (const [name, text] of entries) {
    const raw = enc.encode(text), data = new Uint8Array(deflateRawSync(raw)), n = enc.encode(name)
    const local = new DataView(new ArrayBuffer(30)); local.setUint32(0, 0x04034b50, true); local.setUint16(8, 8, true); local.setUint32(18, data.length, true); local.setUint32(22, raw.length, true); local.setUint16(26, n.length, true)
    const head = new DataView(new ArrayBuffer(46)); head.setUint32(0, 0x02014b50, true); head.setUint16(10, 8, true); head.setUint32(20, data.length, true); head.setUint32(24, raw.length, true); head.setUint16(28, n.length, true); head.setUint32(42, offset, true)
    parts.push(new Uint8Array(local.buffer), n, data); central.push(new Uint8Array(head.buffer), n); offset += 30 + n.length + data.length
  }
  const size = central.reduce((s, p) => s + p.length, 0), end = new DataView(new ArrayBuffer(22)); end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true); end.setUint32(12, size, true); end.setUint32(16, offset, true)
  const all = [...parts, ...central, new Uint8Array(end.buffer)], out = new Uint8Array(all.reduce((s, p) => s + p.length, 0)); let at = 0
  for (const p of all) { out.set(p, at); at += p.length }
  return out.buffer
}

test('ligações mostram resumo, direção, duração e número informados pelo motor de voz; o responsável vem do estado compartilhado', async () => {
  const { projectConversationRecord } = await import('../src/services/casca/conversation-projection')
  const editor = { conversationId: 'call-1', tenantId: 't', version: 'a'.repeat(64), read: false, starred: false, archived: false, tagIds: [], assigneeUserId: 'user-2' }
  const base = { id: 'call-1', tenantId: 't', subject: 'Ligação', channel: 'phone' as const, status: 'closed' as const, agentId: 'a', contactId: null, tags: [], createdAt: '2026-10-20T04:00:00.000Z', updatedAt: '2026-10-20T04:03:02.000Z' }
  const call = projectConversationRecord({ ...base, summary: 'Pediu orçamento.', direction: 'inbound', endedAt: '2026-10-20T04:03:02.000Z', externalContact: '+5562991110001' }, null, [], [], editor)
  assert.equal(call.summary, 'Pediu orçamento.'); assert.equal(call.direction, 'inbound'); assert.equal(call.durationSec, 182); assert.equal(call.callerNumber, '+5562991110001'); assert.equal(call.assigneeUserId, 'user-2')
  assert.equal(call.engineConversation?.closedAt, '2026-10-20T04:03:02.000Z')
  const outbound = projectConversationRecord({ ...base, direction: 'outbound', durationSeconds: 61, externalContact: '+5562991110002' }, null, [], [], { ...editor, assigneeUserId: undefined })
  assert.equal(outbound.durationSec, 61); assert.equal(outbound.calleeNumber, '+5562991110002'); assert.equal(outbound.callerNumber, undefined); assert.equal(outbound.assigneeUserId, undefined)
  const chat = projectConversationRecord({ ...base, id: 'chat-1', channel: 'webchat', status: 'open', externalContact: '+5562991110003' }, null, [], [], { ...editor, conversationId: 'chat-1' })
  assert.equal(chat.durationSec, null); assert.equal(chat.callerNumber, undefined)
})
