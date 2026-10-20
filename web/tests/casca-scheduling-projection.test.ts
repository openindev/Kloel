import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { projectEvent, configFromDraft, projectBooking } from '../src/services/casca/scheduling'
import { newEventConfig, type EventType } from '../src/services/engine/scheduling'

function event(): EventType {
  return { ...newEventConfig(randomUUID()), id: randomUUID(), tenantId: 'tenant', revision: 3,
    createdAt: '2026-01-01T10:00:00.000Z', updatedAt: '2026-01-02T10:00:00.000Z', publicationStatus: 'unpublished', publicPath: null,
    slug: 'consulta', minimumNoticeMinutes: 90, availability: [{ weekday: 1, start: '09:00', end: '12:00' }, { weekday: 1, start: '14:00', end: '18:00' }],
    form: [{ field: 'name', label: 'Seu nome', required: true }, { field: 'email', label: 'Seu e-mail', required: false }] }
}
test('shell projection preserves actual calendar identity, dates, fractional notice and hidden engine requirements', () => {
  const source = event(), draft = projectEvent(source)
  assert.equal(draft.calendarId, source.calendarId); assert.equal(draft.createdAt, source.createdAt); assert.equal(draft.minNoticeHours, 1.5)
  const saved = configFromDraft({ ...draft, name: 'Consulta alterada' }, source)
  assert.equal(saved.name, 'Consulta alterada'); assert.deepEqual(saved.availability, source.availability); assert.deepEqual(saved.form, source.form)
  assert.equal(saved.minimumNoticeMinutes, 90); assert.equal(draft.notifications.confirmationEmail, true)
  assert.equal(draft.locationKind, 'none'); assert.equal(draft.engineEvent?.revision, 3)
  assert.throws(() => projectEvent({ ...source, createdAt: undefined }))
})
test('notification, location, custom-field and advanced edits are all carried to the engine configuration', () => {
  const source = event(), draft = projectEvent(source)
  assert.deepEqual(configFromDraft({ ...draft, locationKind: 'online' }, source).location, { kind: 'online', address: '', phone: '' })
  assert.deepEqual(configFromDraft({ ...draft, locationKind: 'physical', locationAddress: ' Rua A, 1 ' }, source).location, { kind: 'physical', address: 'Rua A, 1', phone: '' })
  const call = configFromDraft({ ...draft, locationKind: 'phone', locationPhone: '+55 (11) 3000-0000' }, source); assert.deepEqual(call.location, { kind: 'phone', address: '', phone: '+551130000000' })
  const callsInvitee = configFromDraft({ ...draft, locationKind: 'phone', locationPhone: '' }, source); assert.deepEqual(callsInvitee.form.at(-1), { field: 'phone', label: 'Telefone', required: true })
  assert.throws(() => configFromDraft({ ...draft, locationKind: 'phone', locationPhone: '123' }, source), /DDI e DDD/)
  const silent = configFromDraft({ ...draft, notifications: { ...draft.notifications, confirmationEmail: false, notifyTeam: true } }, source)
  assert.equal(silent.notifications.invitee, false); assert.equal(silent.notifications.team, true)
  const custom = configFromDraft({ ...draft, dataCollection: [{ id: 'dc_motivo', label: ' Motivo ', required: true, type: 'text' }] }, source)
  assert.deepEqual(custom.customFields, [{ id: 'dc_motivo', label: 'Motivo', type: 'text', required: true }])
  const advanced = configFromDraft({ ...draft, advanced: { ...draft.advanced, allowCancel: false, maxPerDay: 0 }, hideFromCompanyPage: true, hostDisplayName: 'Dra. Ana', confirmationMessage: 'Chegue 10 min antes.', staticInvitees: ['Socio@Empresa.com'], reminders: [{ id: 'r1', channel: 'email', hoursBefore: 24 }], webhooks: [{ id: 'w1', url: 'https://hooks.exemplo.com.br/a', events: ['created'], createdAt: '' }] }, source)
  assert.equal(advanced.allowCancel, false); assert.equal(advanced.dailyLimit, 1000); assert.equal(advanced.hideFromCompanyPage, true); assert.equal(advanced.hostDisplayName, 'Dra. Ana'); assert.equal(advanced.confirmationMessage, 'Chegue 10 min antes.')
  assert.deepEqual(advanced.staticInvitees, ['socio@empresa.com']); assert.deepEqual(advanced.notifications.reminders, [{ id: 'r1', hoursBefore: 24 }]); assert.deepEqual(advanced.webhooks, [{ id: 'w1', url: 'https://hooks.exemplo.com.br/a', events: ['created'] }])
  // Round trip: what the engine returns projects back to the same editor values.
  const back = projectEvent({ ...source, ...advanced })
  assert.equal(back.advanced.allowCancel, false); assert.equal(back.advanced.maxPerDay, 0); assert.deepEqual(back.reminders, [{ id: 'r1', channel: 'email', hoursBefore: 24 }]); assert.equal(back.hostDisplayName, 'Dra. Ana')
  const phone = configFromDraft({ ...draft, webPhone: 'required' }, source)
  assert.deepEqual(phone.form.at(-1), { field: 'phone', label: 'Telefone', required: true })
})
test('operator reservation projection keeps pending state and never invents visitor, origin or notices', () => {
  const source = { bookingRef: randomUUID(), pageId: randomUUID(), revision: 2, status: 'reschedule_unknown', startAt: '2026-01-01T10:00:00Z', endAt: '2026-01-01T11:00:00Z', timezone: 'UTC', needsReconciliation: true, notifications: 'not_sent' as const, adminCancellation: { supported: true, eligible: false } }
  const booking = projectBooking(source, 'tenant')
  assert.equal(booking.status, 'reschedule_unknown'); assert.equal(booking.name, ''); assert.equal(booking.source, 'unknown')
  const owned = projectBooking({ ...source, invitee: { name: 'Ana', email: 'ana@x.com', phone: '+5511999990000' }, source: 'agent', cancelReason: 'Viagem', meetingUrl: 'https://meet.google.com/abc-defg-hij' }, 'tenant')
  assert.equal(owned.name, 'Ana'); assert.equal(owned.email, 'ana@x.com'); assert.equal(owned.source, 'agent'); assert.equal(owned.cancelReason, 'Viagem'); assert.equal(owned.meetingLink, 'https://meet.google.com/abc-defg-hij')
  assert.equal(booking.notices, undefined); assert.equal(booking.engineBooking?.endAt, source.endAt)
})
