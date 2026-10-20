import { seedMember } from './fixtures/membership.js';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { createDomainAppointment, listCalendarSlots, registerDomains, updateDomainContact } from '../src/domains.js';
import { Store } from '../src/store.js';

const app = Fastify();
const store = new Store();
before(async () => {
  app.addHook('preHandler', async request => {
    if (request.headers['x-test-anonymous']) return;
    request.actor = { userId: `${request.headers['x-test-tenant'] ?? 'tenant-a'}-${request.headers['x-test-role'] ?? 'owner'}`, tenantId: String(request.headers['x-test-tenant'] ?? 'tenant-a'), role: (request.headers['x-test-role'] ?? 'owner') as 'owner' | 'admin' | 'member' };
    seedMember(store, request.actor);
  });
  await registerDomains(app, store);
  await app.ready();
});
after(async () => { await app.close(); store.close(); });

async function create(path: string, payload: Record<string, unknown>, tenant = 'tenant-a') {
  const response = await app.inject({ method: 'POST', url: `/api/v1/${path}`, payload, headers: { 'x-test-tenant': tenant } });
  assert.equal(response.statusCode, 201, response.body);
  return response.json();
}

test('all domain reads reject requests without authentication', async () => {
  for (const path of ['agents', 'overview', 'capabilities', 'organization-settings']) {
    const response = await app.inject({ url: `/api/v1/${path}`, headers: { 'x-test-anonymous': 'true' } });
    assert.equal(response.statusCode, 401, path);
  }
});

test('strict schemas prevent identifier, tenant and nested secret injection', async () => {
  for (const payload of [
    { name: 'Unsafe', tenantId: 'tenant-b' },
    { name: 'Unsafe', id: 'owned-id' },
    { name: 'Unsafe', settings: { apiKey: 'not-a-real-key' } },
  ]) {
    const response = await app.inject({ method: 'POST', url: '/api/v1/agents', payload });
    assert.equal(response.statusCode, 400);
  }
  const response = await app.inject({ method: 'POST', url: '/api/v1/channels', payload: { name: 'Secret', type: 'email', provider: 'resend', configuration: { apiKey: 'not-a-real-key' } } });
  assert.equal(response.statusCode, 400);
});

test('tenant isolation applies to list, detail, patch, delete and relationships', async () => {
  const agent = await create('agents', { name: 'Isolated agent' }, 'tenant-isolated');
  const own = await app.inject({ url: '/api/v1/agents', headers: { 'x-test-tenant': 'tenant-isolated' } });
  assert.equal(own.json().total, 1);
  for (const method of ['GET', 'PATCH', 'DELETE'] as const) {
    const response = await app.inject({ method, url: `/api/v1/agents/${agent.id}`, ...(method === 'PATCH' ? { payload: { name: 'Stolen' } } : {}) });
    assert.equal(response.statusCode, 404);
  }
  const link = await app.inject({ method: 'POST', url: '/api/v1/conversations', payload: { agentId: agent.id } });
  assert.equal(link.statusCode, 400);
  assert.equal(link.json().error.code, 'invalid_reference');
});

test('member role may handle contacts and conversations but cannot modify administration', async () => {
  const denied = await app.inject({ method: 'POST', url: '/api/v1/agents', payload: { name: 'Unauthorized' }, headers: { 'x-test-role': 'member' } });
  assert.equal(denied.statusCode, 403);
  const contact = await app.inject({ method: 'POST', url: '/api/v1/contacts', payload: { name: 'Allowed member contact' }, headers: { 'x-test-role': 'member' } });
  assert.equal(contact.statusCode, 201);
  const deniedDelete = await app.inject({ method: 'DELETE', url: `/api/v1/contacts/${contact.json().id}`, headers: { 'x-test-role': 'member' } });
  assert.equal(deniedDelete.statusCode, 403);
});

test('partial updates preserve existing configured settings and reject system fields', async () => {
  const agent = await create('agents', { name: 'Original', prompt: 'Be brief', settings: { temperature: 0.2, maxResponseTokens: 2000, timezone: 'Europe/Berlin', recordingEnabled: true } });
  const updated = await app.inject({ method: 'PATCH', url: `/api/v1/agents/${agent.id}`, payload: { name: 'Renamed' } });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().prompt, 'Be brief');
  assert.equal(updated.json().settings.temperature, 0.2);
  assert.equal(updated.json().settings.timezone, 'Europe/Berlin');
  for (const payload of [{}, { tenantId: 'other' }, { createdAt: '2000-01-01T00:00:00Z' }]) {
    const denied = await app.inject({ method: 'PATCH', url: `/api/v1/agents/${agent.id}`, payload });
    assert.equal(denied.statusCode, 400);
  }
});

test('search and pagination operate only on scoped records', async () => {
  await create('contacts', { name: 'Maria Silva', email: 'MARIA@example.com', tags: ['VIP'] }, 'search-tenant');
  await create('contacts', { name: 'Maria Souza', phone: '+5511999999999' }, 'search-tenant');
  await create('contacts', { name: 'Maria External' }, 'search-other');
  const response = await app.inject({ url: '/api/v1/contacts?q=maria&limit=1&page=2&sort=name&order=asc', headers: { 'x-test-tenant': 'search-tenant' } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().total, 2);
  assert.equal(response.json().totalPages, 2);
  assert.equal(response.json().items[0].name, 'Maria Souza');
  const invalid = await app.inject({ url: '/api/v1/contacts?limit=101' });
  assert.equal(invalid.statusCode, 400);
});

test('appointments normalize timezone offsets and reject overlapping instants transactionally', async () => {
  const calendar = await create('calendars', { name: 'Bookings', timezone: 'America/Sao_Paulo' });
  const first = await create('appointments', { title: 'First', calendarId: calendar.id, startAt: '2026-12-01T09:00:00-03:00', endAt: '2026-12-01T09:30:00-03:00' });
  assert.equal(first.startAt, '2026-12-01T12:00:00.000Z');
  const overlap = await app.inject({ method: 'POST', url: '/api/v1/appointments', payload: { title: 'Overlap', calendarId: calendar.id, startAt: '2026-12-01T12:15:00Z', endAt: '2026-12-01T12:45:00Z' } });
  assert.equal(overlap.statusCode, 409);
  assert.equal(overlap.json().error.code, 'appointment_overlap');
  const adjacent = await create('appointments', { title: 'Adjacent', calendarId: calendar.id, startAt: '2026-12-01T12:30:00Z', endAt: '2026-12-01T13:00:00Z' });
  const update = await app.inject({ method: 'PATCH', url: `/api/v1/appointments/${adjacent.id}`, payload: { startAt: '2026-12-01T12:29:00Z' } });
  assert.equal(update.statusCode, 409);
  assert.equal(store.get('tenant-a', 'appointments', adjacent.id)?.startAt, '2026-12-01T12:30:00.000Z');
  const unchanged = await app.inject({ method: 'PATCH', url: `/api/v1/appointments/${first.id}`, payload: { title: 'Renamed first' } });
  assert.equal(unchanged.statusCode, 200);
});

test('calendar buffers, disabled state, invalid timezones and invalid date intervals are enforced', async () => {
  const calendar = await create('calendars', { name: 'Buffered', bufferMinutes: 15 });
  await create('appointments', { title: 'First', calendarId: calendar.id, startAt: '2026-12-02T12:00:00Z', endAt: '2026-12-02T12:30:00Z' });
  const buffered = await app.inject({ method: 'POST', url: '/api/v1/appointments', payload: { title: 'Too close', calendarId: calendar.id, startAt: '2026-12-02T12:40:00Z', endAt: '2026-12-02T13:00:00Z' } });
  assert.equal(buffered.statusCode, 409);
  await create('appointments', { title: 'After buffer', calendarId: calendar.id, startAt: '2026-12-02T12:45:00Z', endAt: '2026-12-02T13:00:00Z' });
  for (const fields of [
    { timezone: 'Mars/Olympus', startAt: '2026-12-03T12:00:00Z', endAt: '2026-12-03T13:00:00Z' },
    { startAt: '2026-12-03T12:00:00', endAt: '2026-12-03T13:00:00Z' },
    { startAt: '2026-12-03T13:00:00Z', endAt: '2026-12-03T12:00:00Z' },
  ]) {
    const invalid = await app.inject({ method: 'POST', url: '/api/v1/appointments', payload: { title: 'Invalid', calendarId: calendar.id, ...fields } });
    assert.equal(invalid.statusCode, 400, invalid.body);
  }
  const disabled = await create('calendars', { name: 'Disabled', enabled: false });
  const response = await app.inject({ method: 'POST', url: '/api/v1/appointments', payload: { title: 'No booking', calendarId: disabled.id, startAt: '2026-12-03T12:00:00Z', endAt: '2026-12-03T13:00:00Z' } });
  assert.equal(response.statusCode, 409);
});

test('cancelling an appointment releases its time slot', async () => {
  const calendar = await create('calendars', { name: 'Cancellation' });
  const input = { title: 'Slot', calendarId: calendar.id, startAt: '2026-12-04T12:00:00Z', endAt: '2026-12-04T13:00:00Z' };
  const first = await create('appointments', input);
  const cancelled = await app.inject({ method: 'PATCH', url: `/api/v1/appointments/${first.id}`, payload: { status: 'cancelled' } });
  assert.equal(cancelled.statusCode, 200);
  await create('appointments', input);
  const reopen = await app.inject({ method: 'PATCH', url: `/api/v1/appointments/${first.id}`, payload: { status: 'scheduled' } });
  assert.equal(reopen.statusCode, 409);
});

test('manual messages are recorded without claiming delivery and closed conversations reject writes', async () => {
  const conversation = await create('conversations', { subject: 'Manual chat' });
  const message = await create(`conversations/${conversation.id}/messages`, { role: 'assistant', content: 'A saved draft response' });
  assert.equal(message.source, 'manual');
  assert.equal(message.deliveryStatus, 'recorded');
  const list = await app.inject({ url: `/api/v1/conversations/${conversation.id}/messages` });
  assert.equal(list.json().total, 1);
  const foreign = await app.inject({ url: `/api/v1/conversations/${conversation.id}/messages`, headers: { 'x-test-tenant': 'foreign' } });
  assert.equal(foreign.statusCode, 404);
  await app.inject({ method: 'PATCH', url: `/api/v1/conversations/${conversation.id}`, payload: { status: 'closed' } });
  const denied = await app.inject({ method: 'POST', url: `/api/v1/conversations/${conversation.id}/messages`, payload: { role: 'user', content: 'Late' } });
  assert.equal(denied.statusCode, 409);
  const removed = await app.inject({ method: 'DELETE', url: `/api/v1/conversations/${conversation.id}` });
  assert.equal(removed.statusCode, 204);
  assert.equal(store.get('tenant-a', 'messages', message.id), undefined);
});

test('references prevent orphaning and campaign drafts never imply dispatch', async () => {
  const contact = await create('contacts', { name: 'Campaign recipient' });
  const campaign = await create('campaigns', { name: 'Draft campaign', channel: 'whatsapp', contactIds: [contact.id] });
  assert.equal(campaign.status, 'draft');
  assert.equal(campaign.sentCount, 0);
  assert.equal(campaign.executionEnabled, false);
  const publish = await app.inject({ method: 'PATCH', url: `/api/v1/campaigns/${campaign.id}`, payload: { status: 'sent' } });
  assert.equal(publish.statusCode, 400);
  const deletion = await app.inject({ method: 'DELETE', url: `/api/v1/contacts/${contact.id}`, headers: { 'if-match': `"contact:${contact.id}:${contact.revision}"` } });
  assert.equal(deletion.statusCode, 409);
  assert.equal(deletion.json().error.code, 'resource_in_use');
});

test('knowledge and provider metadata report pending or unverified state truthfully', async () => {
  const knowledge = await create('knowledge', { title: 'Website', type: 'url', url: 'https://example.com/' });
  assert.equal(knowledge.indexed, false);
  assert.equal(knowledge.ingestionStatus, 'pending');
  const invalidUrl = await app.inject({ method: 'POST', url: '/api/v1/knowledge', payload: { title: 'Invalid', type: 'url', url: 'not-a-url' } });
  assert.equal(invalidUrl.statusCode, 400);
  const channel = await app.inject({ method: 'POST', url: '/api/v1/channels', payload: { name: 'WhatsApp config', type: 'whatsapp', provider: 'meta', enabled: true } });
  assert.equal(channel.statusCode, 409); assert.equal(channel.json().error.code, 'whatsapp_private_route_required');
  const legacyChannel = store.create('tenant-a', 'channels', { name: 'Legacy WhatsApp', type: 'whatsapp', provider: 'meta', verificationStatus: 'unverified' });
  assert.equal((await app.inject('/api/v1/channels/' + legacyChannel.id)).json().verificationStatus, 'unverified');
  const number = await app.inject({ method: 'POST', url: '/api/v1/phone-numbers', payload: { name: 'Declared number', number: '+5511987654321' } });
  assert.equal(number.statusCode, 409);
  assert.equal(number.json().error.code, 'phone_private_route_required');
  const legacy = store.create('tenant-a', 'phone-numbers', { name: 'Legacy declared number', number: '+5511987654321', provider: 'twilio', provisioningStatus: 'unverified' });
  const read = await app.inject('/api/v1/phone-numbers/' + legacy.id);
  assert.equal(read.json().provisioningStatus, 'unverified');
});

test('overview aggregates actual scoped data and never invents costs or call minutes', async () => {
  const tenant = 'overview-tenant';
  const agent = await create('agents', { name: 'Overview' }, tenant);
  const conversation = await create('conversations', { agentId: agent.id }, tenant);
  await create(`conversations/${conversation.id}/messages`, { role: 'user', content: 'Hello' }, tenant);
  const overview = await app.inject({ url: '/api/v1/overview?days=7', headers: { 'x-test-tenant': tenant } });
  assert.equal(overview.statusCode, 200);
  const body = overview.json();
  assert.equal(body.counts.agents, 1);
  assert.equal(body.counts.conversations, 1);
  assert.equal(body.counts.messages, 1);
  assert.equal(body.daily.length, 7);
  assert.equal(body.daily.reduce((sum: number, day: { messages: number }) => sum + day.messages, 0), 1);
  assert.equal(body.usage.cost, null);
  assert.equal(body.usage.callMinutes, null);
  assert.equal(body.source, 'stored_tenant_records');
});

test('organization settings remain a scoped singleton and enforce admin writes', async () => {
  const options = { method: 'PUT' as const, url: '/api/v1/organization-settings', headers: { 'x-test-tenant': 'settings-tenant' } };
  const initial = await app.inject({ url: options.url, headers: options.headers });
  const first = await app.inject({ ...options, payload: { name: 'Kloel A', expectedVersion: initial.json().version } });
  assert.equal(first.statusCode, 200);
  const second = await app.inject({ ...options, payload: { name: 'Kloel B', timezone: 'Europe/Lisbon', expectedVersion: first.json().version } });
  assert.equal(second.statusCode, 200, second.body);
  assert.equal(second.json().id, first.json().id);
  assert.equal(store.list('settings-tenant', 'organization-settings').length, 1);
  const denied = await app.inject({ ...options, payload: { name: 'Changed' }, headers: { 'x-test-role': 'member' } });
  assert.equal(denied.statusCode, 403);
});

test('availability uses the calendar timezone and slot generation excludes booked times', async () => {
  const calendar = await create('calendars', { name: 'Sao Paulo hours', timezone: 'America/Sao_Paulo', appointmentDurationMinutes: 30, availability: [{ weekday: 2, start: '09:00', end: '11:00' }] });
  const slots = listCalendarSlots(store, 'tenant-a', { calendarId: calendar.id, from: '2026-12-01T11:00:00Z', to: '2026-12-01T15:00:00Z' });
  assert.deepEqual(slots.slots.map(slot => slot.startAt), ['2026-12-01T12:00:00.000Z', '2026-12-01T12:30:00.000Z', '2026-12-01T13:00:00.000Z', '2026-12-01T13:30:00.000Z']);
  createDomainAppointment(store, 'tenant-a', { title: 'Booked', calendarId: calendar.id, startAt: slots.slots[1].startAt, endAt: slots.slots[1].endAt });
  const after = listCalendarSlots(store, 'tenant-a', { calendarId: calendar.id, from: '2026-12-01T11:00:00Z', to: '2026-12-01T15:00:00Z' });
  assert.equal(after.slots.length, 3);
  assert.throws(() => createDomainAppointment(store, 'tenant-a', { title: 'Too early', calendarId: calendar.id, startAt: '2026-12-01T11:30:00Z', endAt: '2026-12-01T12:00:00Z' }), /outside the calendar availability/);
  assert.throws(() => listCalendarSlots(store, 'foreign', { calendarId: calendar.id, from: '2026-12-01T11:00:00Z', to: '2026-12-01T15:00:00Z' }), /not found/);
  const route = await app.inject({ url: `/api/v1/calendars/${calendar.id}/slots?from=2026-12-01T11:00:00Z&to=2026-12-01T15:00:00Z` });
  assert.equal(route.statusCode, 200);
  assert.equal(route.json().slots.length, 3);
});

test('tool contact updates require CAS and cannot grant consent; nested agent settings remain preserved', async () => {
  const contact = await create('contacts', { name: 'Nested' });
  assert.throws(() => updateDomainContact(store, 'tenant-a', contact.id, { consent: { whatsapp: true } }, contact.revision), /evidências/);
  const updated = updateDomainContact(store, 'tenant-a', contact.id, { notes: 'Updated by trusted tool' }, contact.revision);
  assert.equal((updated.consent as any).whatsapp, false);
  assert.equal(updated.revision, 2);
  assert.throws(() => updateDomainContact(store, 'foreign', contact.id, { name: 'Stolen' }, 1), /not found/);
  const agent = await create('agents', { name: 'Settings', settings: { temperature: 0.2, timezone: 'Europe/Berlin' } });
  const response = await app.inject({ method: 'PATCH', url: `/api/v1/agents/${agent.id}`, payload: { settings: { recordingEnabled: true } } });
  assert.equal(response.json().settings.temperature, 0.2);
  assert.equal(response.json().settings.timezone, 'Europe/Berlin');
  assert.equal(response.json().settings.recordingEnabled, true);
});

test('generic CRUD cannot silently detach or cancel a remotely synchronized appointment', async () => {
  const calendar = await create('calendars', { name: 'Managed calendar' });
  const appointment = await create('appointments', { title: 'Remote appointment', calendarId: calendar.id, startAt: '2026-12-06T12:00:00Z', endAt: '2026-12-06T13:00:00Z' });
  store.update('tenant-a', 'appointments', appointment.id, { syncStatus: 'synced', externalEventId: 'remote-event', connectionId: 'remote-connection' });
  const changed = await app.inject({ method: 'PATCH', url: `/api/v1/appointments/${appointment.id}`, payload: { status: 'cancelled' } });
  assert.equal(changed.statusCode, 409);
  assert.equal(changed.json().error.code, 'external_appointment_requires_sync');
  const removed = await app.inject({ method: 'DELETE', url: `/api/v1/appointments/${appointment.id}` });
  assert.equal(removed.statusCode, 409);
  assert.equal(store.get('tenant-a', 'appointments', appointment.id)?.status, 'scheduled');
  store.update('tenant-a', 'appointments', appointment.id, { status: 'cancelled', syncStatus: 'synced' });
  const completedCleanup = await app.inject({ method: 'DELETE', url: `/api/v1/appointments/${appointment.id}` });
  assert.equal(completedCleanup.statusCode, 204);
});
