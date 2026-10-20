import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Store } from '../src/store.js';
import { registerAuth } from '../src/auth.js';
import { registerDomains } from '../src/domains.js';
import { registerCRM } from '../src/crm.js';
import { convertFieldValue, getContact, getSettings } from '../src/crm/service.js';

async function fixture() {
  const store = new Store(), app = Fastify(); await app.register(cookie); await registerAuth(app, store); await registerDomains(app, store); await registerCRM(app, store);
  const signup = async (name: string) => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email: `${name}@example.test`, password: 'test-crm-password-long', organization: name } });
    assert.equal(response.statusCode, 201, response.body);
    return { actor: response.json(), cookies: { kloel_session: response.cookies.find(value => value.name === 'kloel_session')!.value } };
  };
  const owner = await signup('crm-ops-owner'); let serial = 0;
  const request = (method: any, url: string, payload?: any, headers: Record<string, string> = {}, cookies = owner.cookies) => app.inject({ method, url, cookies, payload, headers });
  const create = (data: any) => request('POST', '/api/v1/crm/contacts', data, { 'idempotency-key': `ops-contact-${++serial}` });
  const settings = async (definitions: any[]) => { const old = await request('GET', '/api/v1/crm/settings'); return request('PUT', '/api/v1/crm/settings', { definitions, autoCapture: false, creationGate: '' }, { 'if-match': String(old.headers.etag) }); };
  const tenant = owner.actor.tenantId as string;
  return { app, store, owner, signup, request, create, settings, tenant, close: async () => { await app.close(); store.close(); } };
}

test('deleting a contact through the CRM keeps its conversations, appointments and campaigns, only without the contact', async t => {
  const f = await fixture(); t.after(f.close);
  const contact = (await f.create({ firstName: 'Ana', lastName: 'Souza', phones: [{ value: '+5562991110001' }] })).json();
  const conversation = f.store.create(f.tenant, 'conversations', { subject: 'Linked', channel: 'webchat', status: 'closed', contactId: contact.id });
  const appointment = f.store.create(f.tenant, 'appointments', { title: 'Consulta', contactId: contact.id });
  const campaign = f.store.create(f.tenant, 'campaigns', { name: 'Promo', contactIds: [contact.id, 'other'] });
  const deleted = await f.request('DELETE', `/api/v1/crm/contacts/${contact.id}`, undefined, { 'if-match': `"contact:${contact.id}:1"` });
  assert.equal(deleted.statusCode, 204, deleted.body);
  assert.equal(f.store.get(f.tenant, 'contacts', contact.id), undefined);
  assert.equal(f.store.get(f.tenant, 'conversations', conversation.id)?.contactId, null);
  assert.equal(f.store.get(f.tenant, 'appointments', appointment.id)?.contactId, null);
  assert.deepEqual(f.store.get(f.tenant, 'campaigns', campaign.id)?.contactIds, ['other']);
  assert.equal(f.store.list(f.tenant, 'crm-audit').at(-1)?.detail.unlinked, 3);
});

test('a person links a conversation to a contact; replacing another contact requires confirmation and stays tenant-scoped', async t => {
  const f = await fixture(); t.after(f.close);
  const ana = (await f.create({ firstName: 'Ana', phones: [{ value: '+5562991110001' }] })).json(), bia = (await f.create({ firstName: 'Bia', phones: [{ value: '+5562991110002' }] })).json();
  const conversation = f.store.create(f.tenant, 'conversations', { subject: 'Sem contato', channel: 'webchat', status: 'open' });
  const linked = await f.request('POST', `/api/v1/crm/contacts/${ana.id}/conversations`, { conversationId: conversation.id });
  assert.equal(linked.statusCode, 200, linked.body); assert.equal(linked.json().changed, true);
  assert.equal(f.store.get(f.tenant, 'conversations', conversation.id)?.contactId, ana.id);
  assert.equal((await f.request('GET', `/api/v1/crm/contacts/${ana.id}/conversations`)).json().total, 1);
  const again = await f.request('POST', `/api/v1/crm/contacts/${ana.id}/conversations`, { conversationId: conversation.id }); assert.equal(again.json().changed, false);
  const conflict = await f.request('POST', `/api/v1/crm/contacts/${bia.id}/conversations`, { conversationId: conversation.id });
  assert.equal(conflict.statusCode, 409); assert.equal(conflict.json().error.code, 'conversation_already_linked');
  const replaced = await f.request('POST', `/api/v1/crm/contacts/${bia.id}/conversations`, { conversationId: conversation.id, replace: true });
  assert.equal(replaced.json().previousContactId, ana.id); assert.equal(f.store.get(f.tenant, 'conversations', conversation.id)?.contactId, bia.id);
  assert.equal((await f.request('POST', `/api/v1/crm/contacts/${bia.id}/conversations`, { conversationId: 'missing-conversation' })).statusCode, 404);
  const other = await f.signup('crm-ops-other');
  const foreign = await f.request('POST', `/api/v1/crm/contacts/${bia.id}/conversations`, { conversationId: conversation.id }, {}, other.cookies);
  assert.equal(foreign.statusCode, 404); assert.equal(f.store.get(f.tenant, 'conversations', conversation.id)?.contactId, bia.id);
  const apiStyle = await f.app.inject({ method: 'POST', url: `/api/v1/crm/contacts/${bia.id}/conversations`, cookies: f.owner.cookies, headers: { authorization: 'Bearer klo_test' }, payload: { conversationId: conversation.id } });
  assert.notEqual(apiStyle.statusCode, 200);
});

test('field values are cleared (audited) in the same save as the field type change, which converts the remaining values or refuses', async t => {
  const f = await fixture(); t.after(f.close);
  assert.equal((await f.settings([{ key: 'convenio', label: 'Convênio', type: 'text' }, { key: 'idade', label: 'Idade', type: 'text' }])).statusCode, 200);
  const [convenio, idade] = getSettings(f.store, f.tenant).definitions;
  const a = (await f.create({ firstName: 'A', phones: [{ value: '+5562991110011' }], fieldValues: { [convenio!.id]: 'Unimed', [idade!.id]: '42' } })).json();
  const b = (await f.create({ firstName: 'B', phones: [{ value: '+5562991110012' }], fieldValues: { [convenio!.id]: 'Particular sem plano', [idade!.id]: 'quarenta' } })).json();
  const base = getSettings(f.store, f.tenant).definitions.map(({ revision: _r, ...d }) => d);
  // text → choice with "Unimed"/"Bradesco": B's value does not fit, so nothing changes.
  const toChoice = base.map(d => d.id === convenio!.id ? { ...d, type: 'choice', options: [{ label: 'Unimed' }, { label: 'Bradesco' }] } : d);
  const refused = await f.settings(toChoice); assert.equal(refused.statusCode, 409); assert.equal(refused.json().error.code, 'field_type_in_use'); assert.match(refused.json().error.message, /1 valor salvo não combina/);
  assert.equal(getSettings(f.store, f.tenant).definitions[0]!.type, 'text');
  // "Apagar esses valores ao salvar" travels inside the settings save: one transaction, nothing deleted if the save is refused.
  const old = await f.request('GET', '/api/v1/crm/settings');
  const converted = await f.request('PUT', '/api/v1/crm/settings', { definitions: toChoice.map(d => d.id === idade!.id ? { ...d, type: 'number' } : d), autoCapture: false, creationGate: '', clear: [{ fieldId: convenio!.id, contactIds: [b.id] }, { fieldId: idade!.id, contactIds: [b.id] }] }, { 'if-match': String(old.headers.etag) });
  assert.equal(converted.statusCode, 200, converted.body);
  assert.deepEqual(getContact(f.store, f.tenant, b.id).fieldValues, {}); assert.equal(getContact(f.store, f.tenant, b.id).revision, 2);
  assert.ok(f.store.list(f.tenant, 'crm-audit').some(row => row.action === 'field_values_cleared' && row.contactId === b.id));
  const after = getSettings(f.store, f.tenant).definitions.find(d => d.id === convenio!.id)!;
  assert.equal(after.type, 'choice'); assert.equal(getContact(f.store, f.tenant, a.id).fieldValues[convenio!.id], after.options.find(o => o.label === 'Unimed')!.id);
  assert.equal(getContact(f.store, f.tenant, a.id).fieldValues[idade!.id], '42');
  assert.equal((await f.request('POST', '/api/v1/crm/field-values/clear', { fields: [{ fieldId: 'unknown-field', contactIds: [a.id] }] })).statusCode, 400);
});

test('smart field options are persisted and old definitions keep their revision', async t => {
  const f = await fixture(); t.after(f.close);
  await f.settings([{ key: 'plano', label: 'Plano', type: 'text' }]);
  const first = getSettings(f.store, f.tenant).definitions[0]!;
  // Simulates a definition stored before findHint/keepUpdated/updateWhen existed.
  const row = f.store.list(f.tenant, 'crm-settings')[0]!; const { findHint: _a, keepUpdated: _b, updateWhen: _c, ...legacy } = first as any; f.store.update(f.tenant, 'crm-settings', row.id, { definitions: [legacy] });
  const { revision: _r, ...unchanged } = legacy; assert.equal((await f.settings([unchanged])).statusCode, 200);
  assert.equal(getSettings(f.store, f.tenant).definitions[0]!.revision, first.revision);
  const saved = await f.settings([{ ...unchanged, findHint: 'Procure “meu plano é …”.', keepUpdated: true, updateWhen: 'a pessoa trocou de plano' }]);
  assert.equal(saved.statusCode, 200, saved.body);
  const def = getSettings(f.store, f.tenant).definitions[0]!;
  assert.equal(def.findHint, 'Procure “meu plano é …”.'); assert.equal(def.keepUpdated, true); assert.equal(def.updateWhen, 'a pessoa trocou de plano'); assert.equal(def.revision, first.revision + 1);
});

test('type conversion is lossless or refused', () => {
  const def = (type: any, options: any[] = []) => ({ id: 'f', key: 'f', label: 'F', type, description: '', status: 'active', aiFill: false, options, example: '', showInList: false, findHint: '', keepUpdated: false, updateWhen: '', revision: 1 }) as any;
  assert.equal(convertFieldValue(def('text'), def('number'), '1.234,5'), '1234.5');
  assert.equal(convertFieldValue(def('text'), def('number'), 'doze'), undefined);
  assert.equal(convertFieldValue(def('text'), def('boolean'), 'sim'), true);
  assert.equal(convertFieldValue(def('boolean'), def('text'), false), 'Não');
  assert.equal(convertFieldValue(def('choice', [{ id: 'o1', label: 'Ouro', status: 'active' }]), def('text'), 'o1'), 'Ouro');
  assert.equal(convertFieldValue(def('text'), def('choice', [{ id: 'o2', label: 'Prata', status: 'active' }]), ' prata '), 'o2');
});
