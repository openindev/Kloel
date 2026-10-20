import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Store } from '../src/store.js';
import { registerKnowledge, ingestKnowledge } from '../src/knowledge.js';
import { registerIngestion } from '../src/ingestion.js';
import { registerContactImport } from '../src/contact-import.js';
import { sessionDigest } from '../src/auth.js';
import { seedMember } from './fixtures/membership.js';
import type { Role } from '../src/memberships/permissions.js';

async function fixture(role: Role = 'builder') {
  const store = new Store(), app = Fastify(), actor = { userId: 'identity', tenantId: 'org', role };
  seedMember(store, actor);
  await app.register(cookie);
  app.addHook('preHandler', async request => { request.actor = actor; });
  return { store, app, actor, close: async () => { await app.close(); store.close(); } };
}
const embed = { apiKey: 'test-key', fetchImpl: (async () => Response.json({ data: [{ index: 0, embedding: [1, 0] }] })) as typeof fetch };

test('builder indexing checks fresh membership after provider await and cannot commit after demotion', async t => {
  const f = await fixture(); t.after(f.close);
  const entry = f.store.create('org', 'knowledge', { title: 'Policy', content: 'Confidential content', type: 'text' });
  await registerKnowledge(f.app, f.store, { ...embed, fetchImpl: (async () => {
    f.store.db.prepare("UPDATE memberships SET role='viewer' WHERE user_id=? AND tenant_id=?").run(f.actor.userId, f.actor.tenantId);
    return Response.json({ data: [{ index: 0, embedding: [1, 0] }] });
  }) as typeof fetch });
  const response = await f.app.inject({ method: 'POST', url: `/api/v1/knowledge/${entry.id}/ingest`, payload: {} });
  assert.equal(response.statusCode, 403, response.body);
  assert.equal(f.store.list('org', 'knowledge-chunks').length, 0);
  assert.equal(f.store.get('org', 'knowledge', entry.id)?.indexed, undefined);
});

test('revoked session prevents returning knowledge after retrieval await even when membership survives', async t => {
  const f = await fixture('owner'); t.after(f.close);
  const source = f.store.create('org', 'knowledge', { title: 'Policy', content: 'Private result', type: 'text' });
  await ingestKnowledge(f.store, 'org', source.id, {}, embed);
  f.store.db.prepare('INSERT INTO sessions(hash,user_id,expires,tenant_id) VALUES(?,?,?,?)').run(sessionDigest('test-session'), f.actor.userId, Date.now() + 60000, 'org');
  await registerKnowledge(f.app, f.store, { ...embed, fetchImpl: (async () => {
    f.store.db.prepare('DELETE FROM sessions WHERE hash=?').run(sessionDigest('test-session'));
    return Response.json({ data: [{ index: 0, embedding: [1, 0] }] });
  }) as typeof fetch });
  const response = await f.app.inject({ method: 'POST', url: '/api/v1/knowledge/search', cookies: { kloel_session: 'test-session' }, payload: { query: 'private' } });
  assert.equal(response.statusCode, 401, response.body);
  assert.ok(!response.body.includes('Private result'));
  assert.ok(f.store.db.prepare('SELECT id FROM memberships WHERE user_id=?').get(f.actor.userId));
});

test('URL ingestion stops after remote await when access was revoked and never stores extracted data', async t => {
  const f = await fixture(); t.after(f.close);
  await registerIngestion(f.app, f.store, {
    resolve: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async () => {
      f.store.db.prepare('DELETE FROM memberships WHERE user_id=?').run(f.actor.userId);
      return { status: 200, headers: { 'content-type': 'text/plain' }, body: Buffer.from('Revoked content') };
    },
  });
  const response = await f.app.inject({ method: 'POST', url: '/api/v1/knowledge/import-url', payload: { title: 'URL', url: 'https://example.com/policy' } });
  assert.equal(response.statusCode, 401, response.body);
  assert.equal(f.store.list('org', 'knowledge').length, 0);
});

test('viewer cannot use bulk/contact shortcut endpoints, while builder can upload and index knowledge', async t => {
  const f = await fixture('viewer'); t.after(f.close);
  f.store.create('org', 'contacts', { name: 'Private contact', email: 'private@example.test' });
  await registerContactImport(f.app, f.store); await registerIngestion(f.app, f.store); await registerKnowledge(f.app, f.store, embed);
  for (const url of ['/api/v1/contacts/lookup?q=private', '/api/v1/contacts/export', '/api/v1/contacts/import/fields']) {
    const response = await f.app.inject(url); assert.equal(response.statusCode, 403, response.body); assert.ok(!response.body.includes('Private contact'));
  }
  f.store.db.prepare("UPDATE memberships SET role='builder' WHERE user_id=?").run(f.actor.userId);
  const uploaded = await f.app.inject({ method: 'POST', url: '/api/v1/knowledge/upload', payload: { title: 'Builder source', filename: 'policy.txt', mimeType: 'text/plain', base64: Buffer.from('Useful source').toString('base64') } });
  assert.equal(uploaded.statusCode, 201, uploaded.body);
  const indexed = await f.app.inject({ method: 'POST', url: `/api/v1/knowledge/${uploaded.json().id}/ingest`, payload: {} });
  assert.equal(indexed.statusCode, 200, indexed.body);
  f.store.db.prepare("UPDATE memberships SET role='viewer' WHERE user_id=?").run(f.actor.userId);
  const cached = await f.app.inject({ method: 'POST', url: `/api/v1/knowledge/${uploaded.json().id}/ingest`, payload: {} });
  assert.equal(cached.statusCode, 403, cached.body);
});
