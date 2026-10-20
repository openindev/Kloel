import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync, spawnSync } from 'node:child_process';
import { Store } from '../src/store.js';
import { provisionPlanPolicy, setTenantEnforcement, getPlanPolicy, getEnforcement } from '../src/billing/plans.js';
import { provisionFromArgs } from '../scripts/billing-plan-provision.js';
const policy = (operationKey = randomUUID(), expectedRevision = 0) => ({ operationKey, expectedRevision, priceId: 'price_Synthetic', stripeMode: 'test', planId: 'synthetic', enabled: true, assistantChatRoundsPerDay: 3 });
function temp(t: any) { const dir = mkdtempSync(join(tmpdir(), 'billing-cli-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return { dir, path: join(dir, 'controlled.sqlite'), input: join(dir, 'input.json') }; }

test('policy and enforcement CAS replay their original receipts after later revisions without restoring history', t => {
  const store = new Store(); t.after(() => store.close()); const first = policy(), a = provisionPlanPolicy(store, first), b = provisionPlanPolicy(store, policy(randomUUID(), 1));
  assert.equal(a.resultRevision, 1); assert.equal(b.resultRevision, 2); assert.equal(provisionPlanPolicy(store, first).operationRef, a.operationRef); assert.equal(provisionPlanPolicy(store, first).replayed, true);
  assert.equal(getPlanPolicy(store, 'test', first.priceId)!.revision, 2);
  assert.throws(() => provisionPlanPolicy(store, { ...first, assistantChatRoundsPerDay: 100 }), /Consulte/);
  assert.throws(() => provisionPlanPolicy(store, policy()), /Consulte/);
  const tenant = randomUUID(), intent = { operationKey: randomUUID(), expectedRevision: 0, tenantId: tenant, stripeMode: 'test', enabled: true };
  const result = setTenantEnforcement(store, intent); setTenantEnforcement(store, { ...intent, operationKey: randomUUID(), expectedRevision: 1, enabled: false });
  assert.equal(setTenantEnforcement(store, intent).operationRef, result.operationRef); assert.equal(getEnforcement(store, tenant)!.enabled, false);
});

test('administrative post-COMMIT failure recovers same operation without applying a second revision', t => {
  const store = new Store(); t.after(() => store.close()); const original = store.transaction.bind(store); let fail = true;
  store.transaction = ((fn: any) => { const result = original(fn); if (fail) { fail = false; throw new Error('post_commit'); } return result; }) as typeof store.transaction;
  const intent = policy(); assert.throws(() => provisionPlanPolicy(store, intent), /post_commit/);
  const recovered = provisionPlanPolicy(store, intent); assert.equal(recovered.replayed, true); assert.equal(recovered.resultRevision, 1); assert.equal(getPlanPolicy(store, 'test', intent.priceId)!.revision, 1);
});

test('two connections cannot both accept the same expected revision; reopen never reapplies provisioning', t => {
  const f = temp(t), a = new Store(f.path), b = new Store(f.path); const p = policy(); provisionPlanPolicy(a, p);
  assert.throws(() => provisionPlanPolicy(b, policy())); assert.equal(getPlanPolicy(b, 'test', p.priceId)!.revision, 1);
  a.close(); b.close(); const restarted = new Store(f.path); assert.equal(getPlanPolicy(restarted, 'test', p.priceId)!.revision, 1); assert.equal(restarted.db.prepare('SELECT COUNT(*) AS n FROM billing_plan_operations').get()!.n, 1); restarted.close();
});

test('strict CLI rejects malformed input before opening storage and refuses incompatible schemas without migration', t => {
  const f = temp(t); writeFileSync(f.input, JSON.stringify({ ...policy(), extraSecret: 'DO_NOT_PRINT' }));
  assert.throws(() => provisionFromArgs(['policy', '--db', join(f.dir, 'does-not-exist'), '--input', f.input]));
  writeFileSync(f.input, JSON.stringify(policy())); const old = new DatabaseSync(f.path); old.exec('CREATE TABLE old_installation(id INTEGER)'); old.close();
  const before = readFileSync(f.path); assert.throws(() => provisionFromArgs(['policy', '--db', f.path, '--input', f.input]), /schema_incompatible/); assert.deepEqual(readFileSync(f.path), before);
});

test('installation CLI is a local executable with bounded receipt output, stdin and no network or application bootstrap', t => {
  const f = temp(t); const store = new Store(f.path); store.close(); const p = policy(); writeFileSync(f.input, JSON.stringify(p));
  const block = join(f.dir, 'block-network.cjs'); writeFileSync(block, "globalThis.fetch=()=>{throw new Error('network_forbidden')};require('node:http').Server.prototype.listen=()=>{throw new Error('listen_forbidden')};");
  const args = ['--require', block, '--import', 'tsx', 'scripts/billing-plan-provision.ts', 'policy', '--db', f.path, '--input', f.input];
  const result = JSON.parse(execFileSync(process.execPath, args, { cwd: process.cwd(), encoding: 'utf8' }));
  assert.deepEqual(Object.keys(result).sort(), ['kind', 'operationRef', 'replayed', 'resultRevision', 'status']); assert.equal(result.resultRevision, 1);
  assert.doesNotMatch(JSON.stringify(result), /price_|synthetic|operationKey|tenantId/);
  const replay = JSON.parse(execFileSync(process.execPath, [...args.slice(0, -1), '-'], { cwd: process.cwd(), encoding: 'utf8', input: JSON.stringify(p) })); assert.equal(replay.replayed, true); assert.equal(replay.operationRef, result.operationRef);
  writeFileSync(f.input, JSON.stringify({ ...p, unexpected: 'PRIVATE_INPUT' }));
  const failure = spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: 'utf8' }); assert.equal(failure.status, 1); assert.doesNotMatch(failure.stderr, /PRIVATE_INPUT|price_|stack/); assert.match(failure.stderr, /invalid_input/);
});

test('revision overflow and unsafe limits reject before any administrative record', t => {
  const store = new Store(); t.after(() => store.close());
  for (const value of [NaN, Infinity, -1, 1.5, 1000001]) assert.throws(() => provisionPlanPolicy(store, { ...policy(), assistantChatRoundsPerDay: value }));
  assert.throws(() => provisionPlanPolicy(store, { ...policy(), expectedRevision: Number.MAX_SAFE_INTEGER }));
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM billing_plan_operations').get()!.n, 0);
});
