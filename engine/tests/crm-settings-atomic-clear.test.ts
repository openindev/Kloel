import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Store } from '../src/store.js';
import { registerAuth } from '../src/auth.js';
import { registerDomains } from '../src/domains.js';
import { registerCRM } from '../src/crm.js';
import { getContact, getSettings } from '../src/crm/service.js';

async function fixture() {
  const store = new Store(), app = Fastify(); await app.register(cookie); await registerAuth(app, store); await registerDomains(app, store); await registerCRM(app, store);
  const signup = await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email: 'crm-atomic-clear@example.test', password: 'test-crm-password-long', organization: 'Atomic clear' } });
  assert.equal(signup.statusCode, 201, signup.body);
  const cookies = { kloel_session: signup.cookies.find(value => value.name === 'kloel_session')!.value }, tenant = signup.json().tenantId as string; let serial = 0;
  const request = (method: any, url: string, payload?: any, headers: Record<string, string> = {}) => app.inject({ method, url, cookies, payload, headers });
  const create = async (firstName: string, fieldValues: Record<string, string | boolean>) => { const response = await request('POST', '/api/v1/crm/contacts', { firstName, phones: [{ value: `+55629911100${String(++serial).padStart(2, '0')}` }], fieldValues }, { 'idempotency-key': `atomic-clear-${serial}` }); assert.equal(response.statusCode, 201, response.body); return response.json(); };
  const put = (body: any, revision = getSettings(store, tenant).revision) => request('PUT', '/api/v1/crm/settings', body, { 'if-match': `"crm-settings:${tenant}:${revision}"` });
  const definitions = () => getSettings(store, tenant).definitions.map(({ revision: _revision, ...definition }) => definition);
  return { app, store, tenant, request, create, put, definitions, close: async () => { await app.close(); store.close(); } };
}
const values = (f: Awaited<ReturnType<typeof fixture>>, id: string) => getContact(f.store, f.tenant, id).fieldValues;

test('PUT /crm/settings with clear: listed values that do not fit the new type are removed in the same transaction; fitting ones are converted, never deleted', async t => {
  const f = await fixture(); t.after(f.close);
  assert.equal((await f.put({ definitions: [{ key: 'idade', label: 'Idade', type: 'text' }] })).statusCode, 200);
  const [idade] = getSettings(f.store, f.tenant).definitions;
  const ok = await f.create('Ok', { [idade!.id]: '1.500,5' }), zero = await f.create('Zero', { [idade!.id]: '007' }), word = await f.create('Word', { [idade!.id]: 'quarenta' });
  const toNumber = f.definitions().map(d => ({ ...d, type: 'number' }));
  // Fitting value listed by mistake (or changed since the preview): converted, not deleted.
  const saved = await f.put({ definitions: toNumber, clear: [{ fieldId: idade!.id, contactIds: [ok.id, zero.id, word.id] }] });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(getSettings(f.store, f.tenant).definitions[0]!.type, 'number');
  assert.deepEqual(values(f, ok.id), { [idade!.id]: '1500.5' }); assert.deepEqual(values(f, zero.id), {}); assert.deepEqual(values(f, word.id), {});
  const audit = f.store.list(f.tenant, 'crm-audit');
  assert.ok(audit.some(row => row.action === 'field_values_cleared' && row.contactId === zero.id && row.detail.fields[0] === idade!.id));
  assert.ok(audit.some(row => row.action === 'field_values_converted' && row.contactId === ok.id));
  assert.ok(!audit.some(row => row.action === 'field_values_cleared' && row.contactId === ok.id));
});

test('a refused settings save deletes nothing: unlisted incompatible value, stale revision or unknown field roll the clear back', async t => {
  const f = await fixture(); t.after(f.close);
  assert.equal((await f.put({ definitions: [{ key: 'convenio', label: 'Convênio', type: 'text' }] })).statusCode, 200);
  const [convenio] = getSettings(f.store, f.tenant).definitions;
  const a = await f.create('A', { [convenio!.id]: 'Unimed' }), b = await f.create('B', { [convenio!.id]: 'Plano antigo' }), c = await f.create('C', { [convenio!.id]: 'Outro plano' });
  const toChoice = f.definitions().map(d => ({ ...d, type: 'choice', options: [{ label: 'Unimed' }, { label: 'Bradesco' }] }));
  // C changed after the preview and is not listed: the type change is refused and B keeps its value.
  const refused = await f.put({ definitions: toChoice, clear: [{ fieldId: convenio!.id, contactIds: [b.id] }] });
  assert.equal(refused.statusCode, 409, refused.body); assert.equal(refused.json().error.code, 'field_type_in_use');
  assert.equal(values(f, b.id)[convenio!.id], 'Plano antigo'); assert.equal(getContact(f.store, f.tenant, b.id).revision, 1);
  assert.equal(getSettings(f.store, f.tenant).definitions[0]!.type, 'text');
  const stale = await f.put({ definitions: toChoice, clear: [{ fieldId: convenio!.id, contactIds: [b.id, c.id] }] }, getSettings(f.store, f.tenant).revision - 1);
  assert.equal(stale.statusCode, 409); assert.equal(stale.json().error.code, 'revision_conflict'); assert.equal(values(f, b.id)[convenio!.id], 'Plano antigo');
  const unknown = await f.put({ definitions: toChoice, clear: [{ fieldId: 'unknown-field', contactIds: [b.id] }] });
  assert.equal(unknown.statusCode, 400); assert.equal(values(f, b.id)[convenio!.id], 'Plano antigo');
  assert.ok(!f.store.list(f.tenant, 'crm-audit').some(row => row.action === 'field_values_cleared'));
  const accepted = await f.put({ definitions: toChoice, clear: [{ fieldId: convenio!.id, contactIds: [b.id, c.id] }] });
  assert.equal(accepted.statusCode, 200, accepted.body);
  const after = getSettings(f.store, f.tenant).definitions[0]!;
  assert.equal(values(f, a.id)[convenio!.id], after.options.find(o => o.label === 'Unimed')!.id); assert.deepEqual(values(f, b.id), {}); assert.deepEqual(values(f, c.id), {});
});

test('archived choice: the value stays without clear and is removed with clear; /field-values/clear applies the same rule', async t => {
  const f = await fixture(); t.after(f.close);
  assert.equal((await f.put({ definitions: [{ key: 'plano', label: 'Plano', type: 'choice', options: [{ label: 'Ouro' }, { label: 'Prata' }, { label: 'Bronze' }] }] })).statusCode, 200);
  const [plano] = getSettings(f.store, f.tenant).definitions, option = (label: string) => plano!.options.find(o => o.label === label)!.id;
  const gold = await f.create('Gold', { [plano!.id]: option('Ouro') }), silver = await f.create('Silver', { [plano!.id]: option('Prata') }), bronze = await f.create('Bronze', { [plano!.id]: option('Bronze') });
  const archive = (labels: string[]) => f.definitions().map(d => ({ ...d, options: d.options.map(o => labels.includes(o.label) ? { ...o, status: 'archived' } : o) }));
  assert.equal((await f.put({ definitions: archive(['Prata']) })).statusCode, 200);
  assert.equal(values(f, silver.id)[plano!.id], option('Prata'), 'sem "Apagar" o valor continua salvo');
  assert.equal((await f.put({ definitions: archive(['Prata', 'Bronze']), clear: [{ fieldId: plano!.id, contactIds: [gold.id, bronze.id] }] })).statusCode, 200);
  assert.equal(values(f, gold.id)[plano!.id], option('Ouro'), 'valor que cabe nunca é apagado'); assert.deepEqual(values(f, bronze.id), {});
  // Standalone clear: only values that do not fit the current definition.
  const cleared = await f.request('POST', '/api/v1/crm/field-values/clear', { fields: [{ fieldId: plano!.id, contactIds: [gold.id, silver.id] }] });
  assert.equal(cleared.statusCode, 200, cleared.body); assert.deepEqual(cleared.json(), { cleared: 1, contacts: [silver.id] });
  assert.equal(values(f, gold.id)[plano!.id], option('Ouro')); assert.deepEqual(values(f, silver.id), {});
});
