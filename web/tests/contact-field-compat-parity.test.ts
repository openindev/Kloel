import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { fitFieldValue } from '../../engine/src/crm/service'
import type { FieldDefinition } from '../../engine/src/crm/schema'

type EngineType = FieldDefinition['type']
const corpus = ['42', '-7', '0', '-0', '1.500,5', '1500.5', '1,5', '12.34', '1.234.567,89', '007', '0.5', '.5', '+5511999', '1 234', '1e3', '1.0000000000001',
  '12345678901234567890123456789012345678', '123456789012345678901234567890123456789', 'abc', '  ', 'Sim', 'sim', 'S', 'não', 'Nao', 'NO', 'true', '1', 'Verdadeiro', 'talvez',
  'Unimed', 'unimed', ' Bradesco ', 'Prata', 'Ouro']
const engineDef = (type: EngineType, options: FieldDefinition['options'] = []): FieldDefinition => ({ id: 'f', revision: 1, key: 'f', label: 'F', type, description: '', status: 'active', aiFill: false, options, example: '', showInList: false, findHint: '', keepUpdated: false, updateWhen: '' })
const webType = (type: EngineType) => type === 'choice' ? 'enum' as const : type
// Stored engine value (+ what the web projects) for each corpus entry under the "before" type; only values the engine can store.
const canonicalNumber = /^-?(?:0|[1-9]\d*)(?:\.\d{1,12})?$/
const beforeChoices = [...new Set(corpus.map(v => v.trim()).filter(Boolean))].map((label, i) => ({ id: `o${i}`, label, status: (label === 'Prata' ? 'archived' : 'active') as 'active' | 'archived' }))
function stored(type: EngineType, text: string): { value: string | boolean; projected: string } | undefined {
  if (type === 'text') return { value: text, projected: text }
  if (type === 'number') return canonicalNumber.test(text) && text.replace(/\D/g, '').length <= 38 ? { value: text, projected: text } : undefined
  if (type === 'boolean') return text === 'Sim' || text === 'Não' ? { value: text === 'Sim', projected: text } : undefined
  const option = beforeChoices.find(o => o.label === text)
  return option && { value: option.id, projected: option.label }
}

test('troca de tipo / opções: a regra da web (fieldValueFits) e a do motor (fitFieldValue) decidem igual para todo valor', async () => {
  const dom = new JSDOM('', { url: 'http://127.0.0.1/' }); Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage })
  const { fieldValueFits } = await import('../src/app/pages/contacts/lib')
  const types: EngineType[] = ['text', 'number', 'boolean', 'choice']
  // Destino "Escolha": opções ativas Unimed/Bradesco/Ouro/Sim e "Prata" arquivada (a web só vê as ativas).
  const afterOptions = [{ id: 'a1', label: 'Unimed', status: 'active' }, { id: 'a2', label: 'Bradesco', status: 'active' }, { id: 'a3', label: 'Ouro', status: 'active' }, { id: 'a4', label: 'Sim', status: 'active' }, { id: 'a5', label: 'Prata', status: 'archived' }] as FieldDefinition['options']
  let compared = 0
  for (const from of types) for (const to of types) for (const text of [...corpus, 'Não']) {
    const value = stored(from, text); if (!value) continue
    const before = engineDef(from, from === 'choice' ? beforeChoices : []), after = from === 'choice' && to === 'choice'
      ? engineDef('choice', beforeChoices.map(o => ['Unimed', 'Ouro', 'Sim'].includes(o.label) ? o : { ...o, status: 'archived' as const }))
      : engineDef(to, to === 'choice' ? afterOptions : [])
    const web = (def: FieldDefinition) => ({ id: 'f', label: 'F', type: webType(def.type), description: '', aiFill: false, options: def.type === 'choice' ? def.options.filter(o => o.status === 'active').map(o => o.label) : undefined })
    const engine = fitFieldValue(before, after, value.value) !== undefined
    assert.equal(fieldValueFits(web(before), web(after), value.projected), engine, `${from} → ${to}: ${JSON.stringify(text)} (motor: ${engine ? 'cabe' : 'não cabe'})`)
    compared++
  }
  assert.ok(compared > 150, `${compared} comparações`)
  dom.window.close()
})

test('valor de Escolha que não aponta para opção nenhuma (legado: id órfão ou rótulo gravado): não cabe para o motor, e a web o lista para apagar', async () => {
  const dom = new JSDOM('', { url: 'http://127.0.0.1/' }); Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage })
  const { fieldValueFits } = await import('../src/app/pages/contacts/lib')
  const { projectContact, incompatibleContactIds } = await import('../src/services/casca/contacts')
  const options: FieldDefinition['options'] = [{ id: 'o1', label: 'Ouro', status: 'active' }, { id: 'o2', label: 'Prata', status: 'archived' }]
  const before = engineDef('choice', options), settings = { id: 's', revision: 2, autoCapture: false, creationGate: '', definitions: [before] }
  const row = (value: string) => ({ id: `c-${value}`, orgId: 't', firstName: 'Ana', lastName: '', phones: [], emails: [], company: '', notes: '', source: 'manual', createdAt: '', updatedAt: '', raw: { fieldValues: { f: value }, ownerMembershipId: null } }) as any
  const targets: [EngineType, string[] | undefined][] = [['text', undefined], ['number', undefined], ['boolean', undefined], ['choice', ['Ouro', 'Prata', '42']]]
  for (const stored of ['o-removida', 'Ouro', '42', 'o1', 'o2']) {
    const contact = projectContact(row(stored), settings as any, new Map())
    for (const [type, labels] of targets) {
      // Como settingsPayload: o rótulo de uma opção existente mantém o id dela (e a reativa).
      const after = engineDef(type, labels ? labels.map((label, i) => ({ id: options.find(o => o.label === label)?.id ?? `n${i}`, label, status: 'active' as const })) : [])
      const engine = fitFieldValue(before, after, stored) !== undefined
      const web = incompatibleContactIds({ id: 'f', label: 'F', type: webType(type), description: '', aiFill: false, options: labels }, [contact], (field, value) => fieldValueFits({ type: 'enum', options: ['Ouro'] }, field, value)).length === 0
      assert.equal(web, engine, `Escolha guardada ${JSON.stringify(stored)} (tela: ${JSON.stringify(contact.fields.f)}) → ${type} (motor: ${engine ? 'cabe' : 'não cabe'})`)
    }
  }
  dom.window.close()
})
