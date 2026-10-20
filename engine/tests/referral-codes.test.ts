import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { buildApp } from '../src/app.js';
import { referralCodeFor } from '../src/referral-codes.js';

const cookie = (r: any) => ({ kloel_session: r.cookies.find((c: any) => c.name === 'kloel_session').value as string });
const password = 'referral-test-password';

async function fixture(t: any) {
  const store = new Store(), app = await buildApp(store); t.after(() => app.close());
  const signup = (email: string, organization: string, referralCode?: string) => app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email, password, organization, ...(referralCode ? { referralCode } : {}) } });
  return { store, app, signup };
}

test('each organization gets a stable UUID-shaped code it can share', async t => {
  const f = await fixture(t), owner = await f.signup('referrer@example.test', 'Clínica Indicadora');
  assert.equal(owner.statusCode, 201);
  const tenantId = owner.json().tenantId;
  const response = await f.app.inject({ method: 'GET', url: '/api/v1/referrals/code', cookies: cookie(owner) });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().code, referralCodeFor(tenantId));
  assert.match(response.json().code, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(response.json().path, `/register?ref=${referralCodeFor(tenantId)}`);
  assert.equal(referralCodeFor(tenantId), referralCodeFor(tenantId));
  assert.equal((await f.app.inject({ method: 'GET', url: '/api/v1/referrals/code' })).statusCode, 401, 'code requires a session');
});

test('public lookup confirms only real codes and reveals only the organization name', async t => {
  const f = await fixture(t), owner = await f.signup('referrer@example.test', 'Clínica Indicadora');
  const code = referralCodeFor(owner.json().tenantId);
  const valid = await f.app.inject({ method: 'GET', url: `/api/v1/public/referrals/${code}` });
  assert.equal(valid.statusCode, 200);
  assert.deepEqual(valid.json(), { valid: true, referrerName: 'Clínica Indicadora', benefit: { percentOff: 50, months: 2 } });
  const unknown = await f.app.inject({ method: 'GET', url: '/api/v1/public/referrals/00000000-0000-4000-8000-000000000000' });
  assert.deepEqual(unknown.json(), { valid: false });
});

test('a signup with a valid code is recorded once in both organizations; unknown codes never block signup', async t => {
  const f = await fixture(t), owner = await f.signup('referrer@example.test', 'Clínica Indicadora');
  const referrerTenant = owner.json().tenantId, code = referralCodeFor(referrerTenant);
  const friend = await f.signup('friend@example.test', 'Oficina Amiga', code.toUpperCase());
  assert.equal(friend.statusCode, 201);
  const friendTenant = friend.json().tenantId;
  const signups = f.store.list(referrerTenant, 'referral-signups');
  assert.equal(signups.length, 1);
  assert.equal(signups[0]!.referredTenantId, friendTenant);
  assert.equal(signups[0]!.rewardStatus, 'pending_first_paid_month');
  const referredBy = f.store.list(friendTenant, 'referred-by');
  assert.equal(referredBy.length, 1);
  assert.equal(referredBy[0]!.referrerTenantId, referrerTenant);
  assert.deepEqual(referredBy[0]!.benefit, { percentOff: 50, months: 2 });
  const listed = await f.app.inject({ method: 'GET', url: '/api/v1/referrals/code', cookies: cookie(owner) });
  assert.equal(listed.json().signups.length, 1);
  assert.equal(listed.json().signups[0].referredOrganization, 'Oficina Amiga');

  const stranger = await f.signup('stranger@example.test', 'Sem Indicação', 'not-a-code');
  assert.equal(stranger.statusCode, 201, 'an invalid code is ignored');
  assert.equal(f.store.list(stranger.json().tenantId, 'referred-by').length, 0);
  assert.equal(f.store.list(referrerTenant, 'referral-signups').length, 1);
});
