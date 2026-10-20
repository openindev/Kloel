import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createHmac } from 'node:crypto';
import Fastify from 'fastify';
import { Store } from '../src/store.js';
import { rejectCardData, registerCommercial, executeCommercial } from '../src/commercial.js';
import { seedMember } from './fixtures/membership.js';
import { DomainError } from '../src/domains.js';

const PAN = '4111111111111111';

test('card numbers are refused before any payment call', () => {
  assert.throws(() => rejectCardData({ cardNumber: PAN }), (error: unknown) => error instanceof DomainError && error.code === 'card_data_refused');
  assert.throws(() => rejectCardData({ note: `pedido ${PAN}` }), (error: unknown) => error instanceof DomainError && error.code === 'card_data_refused');
  assert.doesNotThrow(() => rejectCardData({ orderId: 'pedido-1042', amountCents: 9900 }));
});

test('personalizar stores no card data and creates a payment link', async () => {
  const previous = process.env.OAUTH_ENCRYPTION_KEY;
  process.env.OAUTH_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const store = new Store(); const app = Fastify();
  const actor = { userId: 'owner', tenantId: 'tenant-a', role: 'owner' as const };
  try {
    app.addHook('preHandler', async request => { request.actor = actor; seedMember(store, request.actor); });
    const agent = store.create(actor.tenantId, 'agents', { name: 'Ana', status: 'active' });
    await registerCommercial(app, store);
    const saved = await app.inject({ method: 'PUT', url: `/api/v1/agents/${agent.id}/commercial`, payload: {
      platformName: 'Loja', baseUrl: 'https://api.loja.example/', authType: 'bearer', secret: 'fixture-platform-secret',
      actions: [{ name: 'Criar pedido', method: 'POST', path: '/orders', description: 'Cria o pedido', confirm: true }],
      rules: { maxDiscountPercent: 10, tiers: [{ days: 30, percent: 10 }], offers: 'brinde até 10%', returnPolicy: 'troca em 7 dias', contactFrom: '09:00', contactTo: '18:00', cadencePerDay: 1, maxAttempts: 3, autoContact: false, fieldMap: { nome: 'customer.name' } },
      pagarme: { accountId: 'acc_fixture', mode: 'test', secretKey: 'sk_test_fixture' },
    } });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.ok(saved.json().inboundSecret);
    assert.equal(JSON.stringify(saved.json()).includes('sk_test_fixture'), false);
    await assert.rejects(executeCommercial(store, actor.tenantId, agent.id, 'comercial_link', { amountCents: 9900, customerName: 'Ana', cardNumber: PAN }), /cartão/);
    let called = '';
    const link = await executeCommercial(store, actor.tenantId, agent.id, 'comercial_link', { amountCents: 9900, customerName: 'Ana', description: 'Pedido' }, { fetch: (async (url: string, init?: RequestInit) => { called = String(url) + String(init?.body); return new Response(JSON.stringify({ url: 'https://pay.example/link', id: 'pl_1' }), { status: 200 }); }) as typeof fetch });
    assert.equal(link.ok, true);
    assert.equal(link.url, 'https://pay.example/link');
    assert.equal(called.includes(PAN), false);
    assert.match(called, /paymentlinks/);
    const raw = Buffer.from(JSON.stringify({ event: 'payment_overdue', phone: '+5511999990000', summary: 'Fatura 10' }));
    const signature = `v1=${createHmac('sha256', saved.json().inboundSecret).update(raw).digest('hex')}`;
    const inbound = await app.inject({ method: 'POST', url: `/api/v1/commercial/inbound/${actor.tenantId}/${agent.id}`, headers: { 'content-type': 'application/json', 'x-kloel-signature': signature }, payload: raw });
    assert.equal(inbound.statusCode, 202, inbound.body);
    const leaked = store.list(actor.tenantId, 'commercial-events').some(row => JSON.stringify(row).includes(PAN) || JSON.stringify(row).includes('sk_test_fixture'));
    assert.equal(leaked, false);
  } finally {
    await app.close(); store.close();
    if (previous === undefined) delete process.env.OAUTH_ENCRYPTION_KEY; else process.env.OAUTH_ENCRYPTION_KEY = previous;
  }
});
