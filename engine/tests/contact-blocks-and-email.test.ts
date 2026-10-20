import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { isPhoneBlocked } from '../src/contact-blocks.js';
import { renderHtmlVars, htmlToText } from '../src/call-actions.js';

test('blocked contacts match every phone variant; unblocked or other tenants do not', () => {
  const store = new Store();
  const c = store.create('t1', 'contacts', { phone: '+5511900000001', phones: [{ normalized: '+5511900000001' }, { normalized: '+5521988887777' }] });
  assert.equal(isPhoneBlocked(store, 't1', '+5511900000001'), false);
  store.create('t1', 'contact-communication', { contactId: c.id, blocked: true });
  assert.equal(isPhoneBlocked(store, 't1', '+55 11 90000-0001'), true);
  assert.equal(isPhoneBlocked(store, 't1', '5521988887777'), true);
  assert.equal(isPhoneBlocked(store, 't1', '+5511900000002'), false);
  assert.equal(isPhoneBlocked(store, 't2', '+5511900000001'), false);
});
test('email body variables render from the editor HTML', () => {
  const html = '<p>Resumo: <span data-var="conversation.summary" class="v">Resumo</span></p><p>Tel {{caller.phoneNumber}} &amp; mais</p>';
  assert.equal(htmlToText(renderHtmlVars(html, { 'conversation.summary': 'Quer <orçamento>', 'caller.phoneNumber': '+5511' })), 'Resumo: Quer <orçamento>\nTel +5511 & mais');
});

test('idle webchat conversations run email actions once', async () => {
  const { sweepIdleChats } = await import('../src/chat-end.js');
  const store = new Store();
  const conv = store.create('t9', 'conversations', { channel: 'webchat', agentId: 'ag1', status: 'open' });
  store.create('t9', 'agent-editor-states', { agentId: 'ag1', state: { emails: [{ id: 'e1', when: 'always', recipientsMode: 'fixed', recipients: ['x@example.com'], messageMode: 'manual', subject: 'S', body: 'B' }] } });
  const old = new Date(Date.now() - 3600_000).toISOString();
  store.create('t9', 'messages', { conversationId: conv.id, role: 'user', content: 'oi', createdAt: old });
  store.create('t9', 'messages', { conversationId: conv.id, role: 'assistant', content: 'olá', createdAt: old });
  const prev = process.env.RESEND_API_KEY; delete process.env.RESEND_API_KEY;
  assert.equal(await sweepIdleChats(store, Date.now()), 0);
  assert.equal(await sweepIdleChats(store, Date.now() + 2 * 3600_000), 1);
  assert.ok(store.get('t9', 'conversations', conv.id)?.actionsRunAt);
  assert.equal(await sweepIdleChats(store, Date.now() + 2 * 3600_000), 0);
  if (prev) process.env.RESEND_API_KEY = prev;
});
