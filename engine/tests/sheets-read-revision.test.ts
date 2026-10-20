import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sheetsFixture, sheetInput } from './fixtures/sheets-http.js';
import { listSpreadsheetTabs, readSpreadsheetRange, sheetsBindings, publicSheetBinding } from '../src/oauth/sheets.js';
import { integrationRuntimeMatrix } from '../src/integrations/capabilities.js';

for (const method of ['tabs', 'values'] as const) test(`stale ${method} response cannot verify or disclose a newer binding revision`, async t => {
  const f = await sheetsFixture(t);
  f.hooks.provider = () => { f.store.update(f.actor.tenantId, sheetsBindings, f.binding.id, { name: 'Changed while awaiting Google', revision: 2 }); };
  await assert.rejects(method === 'tabs'
    ? listSpreadsheetTabs(f.store, f.actor, f.connection.id, f.binding.id)
    : readSpreadsheetRange(f.store, f.actor, f.connection.id, f.binding.id, { sheetTitle: sheetInput.sheetTitle, range: sheetInput.range }),
  (e: any) => e.code === 'spreadsheet_configuration_changed');
  const current = f.store.get(f.actor.tenantId, sheetsBindings, f.binding.id)!;
  assert.equal(current.revision, 2); assert.equal(current.lastVerifiedAt, undefined); assert.equal(publicSheetBinding(current).status, 'configured_unverified');
});

for (const method of ['tabs', 'values'] as const) test(`HTTP ${method} requires the observed revision before provider I/O`, async t => {
  const f = await sheetsFixture(t), suffix = method === 'tabs' ? '' : '&sheetTitle=Tab&range=A1';
  const missing = await f.request('GET', `${f.prefix}/${f.binding.id}/${method}${method === 'tabs' ? '' : '?sheetTitle=Tab&range=A1'}`); assert.equal(missing.statusCode, 400);
  const stale = await f.request('GET', `${f.prefix}/${f.binding.id}/${method}?expectedRevision=2${suffix}`); assert.equal(stale.json().error.code, 'spreadsheet_configuration_changed'); assert.equal(f.requests.length, 0);
});

test('binding DTO and capability counter verify only the exact read revision, never legacy timestamps', async t => {
  const f = await sheetsFixture(t), row = () => f.store.get(f.actor.tenantId, sheetsBindings, f.binding.id)!;
  const count = () => integrationRuntimeMatrix(f.store, f.actor).items.find(i => i.name === 'Google Sheets')!.runtime.readVerifiedSpreadsheetBindings;
  f.store.update(f.actor.tenantId, sheetsBindings, f.binding.id, { lastVerifiedAt: new Date().toISOString() });
  assert.equal(publicSheetBinding(row()).status, 'configured_unverified'); assert.equal(count(), 0);
  const response = await f.request('GET', `${f.prefix}/${f.binding.id}/tabs?expectedRevision=1`); assert.equal(response.statusCode, 200); assert.equal(response.json().bindingRevision, 1); assert.equal(response.json().bindingId, f.binding.id);
  assert.equal(publicSheetBinding(row()).status, 'read_verified'); assert.equal(count(), 1);
  f.store.update(f.actor.tenantId, sheetsBindings, f.binding.id, { revision: 2 }); assert.ok(row().lastVerifiedAt); assert.equal(count(), 0); assert.equal(publicSheetBinding(row()).status, 'configured_unverified');
});

test('binding changed during token refresh prevents the resource read and verification', async t => {
  const f = await sheetsFixture(t); f.setTokens(1);
  f.hooks.provider = request => { if (request.url.hostname === 'oauth2.googleapis.com') f.store.update(f.actor.tenantId, sheetsBindings, f.binding.id, { revision: 2 }); };
  const response = await f.request('GET', `${f.prefix}/${f.binding.id}/tabs?expectedRevision=1`);
  assert.equal(response.json().error.code, 'spreadsheet_configuration_changed'); assert.equal(f.requests.length, 1); assert.equal(f.requests[0].url.hostname, 'oauth2.googleapis.com'); assert.equal(f.store.get(f.actor.tenantId, sheetsBindings, f.binding.id)!.lastVerifiedRevision, undefined);
});
