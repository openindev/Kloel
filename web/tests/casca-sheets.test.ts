import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createSheetsResourceConnector, sheetActionConfiguration, sheetSelection } from '../src/services/casca/sheets'
import type { IntegrationAction } from '../src/domain/types'

const row = (): IntegrationAction => ({ id: 'shell-row', name: 'Clientes', integration: 'google-sheets', timing: 'during', connected: true, config: { connectionId: randomUUID(), sheetUrl: 'https://docs.google.com/spreadsheets/d/synthetic_sheet_123/edit', tab: 'Clientes', action: 'Read rows' } })
test('Sheets adapter derives only actual unique headers, bounded read scope and explicit append inputs', () => {
  const query = sheetActionConfiguration('query', 'Clientes', ['Nome', 'Telefone', ''], 2000) as any
  assert.deepEqual(query.expectedHeaders, ['Nome', 'Telefone']); assert.equal(query.scanRange, 'A1:B1000'); assert.equal(query.maxRows, 50)
  const append = sheetActionConfiguration('append', 'Clientes', ['Nome completo', 'E-mail'], 10) as any
  assert.deepEqual(append.inputDefinitions, [{ name: 'col_1_Nome_completo', type: 'text' }, { name: 'col_2_E_mail', type: 'text' }])
  assert.equal(append.row.length, 2); assert.equal(append.range, 'A1:B1')
  for (const headers of [[], ['Nome', 'Nome'], ['Nome', '', 'Telefone'], Array.from({ length: 21 }, (_, i) => String(i))]) assert.throws(() => sheetActionConfiguration('query', 'Clientes', headers, 20))
})
test('Sheets rejects unselected accounts, external URLs and unsupported execution timing before reserving a write', async () => {
  const selected = row(); assert.equal(sheetSelection(selected).kind, 'query')
  assert.throws(() => sheetSelection({ ...selected, timing: 'after' }), /durante/)
  assert.throws(() => sheetSelection({ ...selected, config: { ...selected.config, sheetUrl: 'https://evil.test/spreadsheets/d/synthetic_sheet_123/edit' } }), /URL/)
  assert.throws(() => sheetSelection({ ...selected, config: { ...selected.config, connectionId: '' } }), /Conecte/)
  const identity = { userId: randomUUID(), tenantId: randomUUID(), membershipId: randomUUID(), authorityVersion: 'a'.repeat(64) }, values = new Map<string, string>(), calls: unknown[] = []
  const context = { tenantId: identity.tenantId, generation: 1, assertCurrent() {}, async request<T>(path: string, options?: any): Promise<T> { calls.push({ path, options }); if (!options?.method) return { source: 'local_configured_bindings', driveListing: false, items: [] } as T; throw Error('should not send') } }
  const api = createSheetsResourceConnector(context, identity, { getItem: k => values.get(k) ?? null, setItem() { throw Error('quota') }, removeItem() {} }, randomUUID(), 'save')
  await assert.rejects(() => api.save(selected), /quota/); assert.equal(calls.filter((c: any) => c.options?.method).length, 0)
})
