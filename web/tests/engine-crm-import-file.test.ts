import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeText, parseCSV, mapCSV, parseJSON, CRM_IMPORT_MAX_BYTES } from '../src/services/engine/crm-import-file'

test('UTF-8 decoding preserves Unicode/BOM and refuses malformed, nul and oversized files', () => {
  assert.equal(decodeText(new TextEncoder().encode('\uFEFFNome\nJoão')), 'Nome\nJoão')
  assert.throws(() => decodeText(new Uint8Array([0xff, 0xfe, 65, 0])), (error: any) => error.code === 'invalid_encoding')
  assert.throws(() => decodeText(new TextEncoder().encode('a\0b')))
  assert.throws(() => decodeText(new Uint8Array(CRM_IMPORT_MAX_BYTES + 1)), (error: any) => error.code === 'import_too_large')
})

test('CSV handles explicit delimiters, escaped quotes and multiline cells with duplicate indexed headers', () => {
  const table = parseCSV('Nome;Nome;Nota\r\nAna;Silva;"primeira; linha\ncom ""aspas"""\r\n', ';')
  assert.deepEqual(table, { headers: ['Nome', 'Nome', 'Nota'], rows: [['Ana', 'Silva', 'primeira; linha\ncom "aspas"']] })
  assert.deepEqual(mapCSV(table, [{ column: 0, target: 'firstName' }, { column: 1, target: 'lastName' }, { column: 2, target: 'notes' }]).contacts[0].data,
    { firstName: 'Ana', lastName: 'Silva', notes: 'primeira; linha\ncom "aspas"' })
  assert.equal(parseCSV('a,b\n1,2\n').rows.length, 1)
  for (const source of ['a,b\n1', 'a,b\n"x"bad,y', 'a,b\n"unfinished,y', 'a,b\nfirst"quote,y']) assert.throws(() => parseCSV(source))
  assert.throws(() => parseCSV('name\n' + Array.from({ length: 2001 }, () => 'value').join('\n')), (error: any) => error.code === 'import_too_large')
})

test('CSV mapping omits blank cells and preserves typed false, decimal precision and active choice IDs', () => {
  const bundle = mapCSV(parseCSV('Nome,Email,Empresa,Flag,Valor,Escolha\nAna,ana@example.test, ,Não,12345678901234567890.12,Ativo'), [
    { column: 0, target: 'firstName' }, { column: 1, target: 'email' }, { column: 2, target: 'company' },
    { column: 3, target: 'field', definition: { id: 'flag-id', key: 'flag', label: 'Flag', type: 'boolean', aiFill: false } },
    { column: 4, target: 'field', definition: { id: 'amount-id', key: 'amount', label: 'Valor', type: 'number' } },
    { column: 5, target: 'field', definition: { id: 'choice-id', key: 'choice', label: 'Escolha', type: 'choice', options: [{ id: 'choice-a', label: 'Ativo', status: 'active' }] } },
  ])
  assert.equal(Object.hasOwn(bundle.contacts[0].data, 'company'), false)
  assert.deepEqual(bundle.contacts[0].data.fieldValues, { 'flag-id': false, 'amount-id': '12345678901234567890.12', 'choice-id': 'choice-a' })
  assert.equal(bundle.definitions.length, 3); assert.ok(bundle.definitions.every(field => field.aiFill === false))
  assert.equal(Object.hasOwn(bundle.contacts[0].data.emails![0], 'label'), false)
  assert.equal(mapCSV(parseCSV('Name,Phone\n , '), [{ column: 0, target: 'firstName' }, { column: 1, target: 'phone' }]).contacts.length, 0)
})

test('CSV rejects ambiguous mappings or types with a precise logical row and no consent target', () => {
  const table = parseCSV('name,flag\nAna,perhaps')
  assert.throws(() => mapCSV(table, [{ column: 0, target: 'firstName' }, { column: 1, target: 'firstName' }]))
  assert.throws(() => mapCSV(table, [{ column: 1, target: 'field', definition: { key: 'flag', label: 'Flag', type: 'boolean' } }]), (error: any) => error.code === 'invalid_csv_field' && error.line === 2 && error.details.column === 2)
  assert.throws(() => mapCSV(table, [{ column: 0, target: 'consent' } as any]))
  assert.throws(() => mapCSV(table, [{ column: 0, target: 'field', definition: { key: 'name', label: 'Name', type: 'text', aiFill: true } }]))
  assert.throws(() => mapCSV(parseCSV('choice\nSame'), [{ column: 0, target: 'field', definition: { key: 'choice', label: 'Choice', type: 'choice', options: [{ id: 'a', label: 'Same' }, { id: 'b', label: 'Same' }] } }]))
})

test('JSON only disables aiFill after explicit opt-in and keeps all data presence, identities and inert legacy data', () => {
  const raw = { format: 'kloel.contacts', version: 2, definitions: [{ key: 'flag', label: 'Synthetic flag', type: 'boolean', aiFill: true }], contacts: [{ sourceId: 'contact-source', revision: 4, data: { firstName: 'Ana', notes: '', fieldValues: { flag: false } }, legacyData: { consent: true } }] }
  assert.throws(() => parseJSON(JSON.stringify(raw)), (error: any) => error.code === 'ai_fill_confirmation_required' && error.details.fields[0] === 'Synthetic flag')
  const parsed = parseJSON(JSON.stringify(raw), { disableAiFill: true }); assert.deepEqual(parsed.disabledAiFill, ['Synthetic flag']); assert.equal(parsed.bundle.definitions[0].aiFill, false); assert.equal(raw.definitions[0].aiFill, true)
  assert.deepEqual(parsed.bundle.contacts, raw.contacts); assert.equal(Object.hasOwn(parsed.bundle.contacts[0].data, 'timezone'), false)
  assert.throws(() => parseJSON(JSON.stringify({ ...raw, contacts: [{ data: { firstName: 'Ana', consent: true } }] })))
  assert.throws(() => parseJSON(JSON.stringify({ ...raw, definitions: [], contacts: Array.from({ length: 2001 }, () => ({ data: { firstName: 'Synthetic' } })) })))
  assert.throws(() => parseJSON('{'))
})

test('CSV rejects reserved field-value IDs instead of mutating object prototypes or silently dropping data', () => {
  for (const id of ['__proto__', 'constructor', 'prototype']) assert.throws(() => mapCSV(parseCSV('Value\nSynthetic'), [{ column: 0, target: 'field', definition: { id, key: 'safe_key', label: 'Safe label', type: 'text' } }]))
  assert.equal(Object.getPrototypeOf({}), Object.prototype)
})
