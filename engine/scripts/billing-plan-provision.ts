import { openSync, readSync, closeSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { Store } from '../src/store.js';
import { assertBillingQuotaSchema } from '../src/billing/schema.js';
import { enforcementInput, policyInput, provisionPlanPolicy, setTenantEnforcement, PlanError } from '../src/billing/plans.js';

/** Installation-only command; no app import, environment loading, HTTP, workers or provider I/O. */
export function provisionFromArgs(args: string[]) {
  if (args.length !== 5 || !['policy', 'enforcement'].includes(args[0]) || args[1] !== '--db' || args[3] !== '--input' || !args[2] || !args[4]) throw new PlanError(400, 'invalid_arguments');
  const file = args[4];
  if (file !== '-' && (!lstatSync(file).isFile() || lstatSync(file).size > 16384)) throw new PlanError(400, 'invalid_input');
  const fd = file === '-' ? 0 : openSync(file, 'r'), buffer = Buffer.alloc(16385);
  let length = 0;
  try { while (length < buffer.length) { const count = readSync(fd, buffer, length, buffer.length - length, null); if (!count) break; length += count; } }
  finally { if (file !== '-') closeSync(fd); }
  if (length > 16384) throw new PlanError(400, 'invalid_input');
  const input = buffer.subarray(0, length).toString('utf8');
  let parsed: unknown;
  try { parsed = JSON.parse(input); } catch { throw new PlanError(400, 'invalid_json'); }
  const value = args[0] === 'policy' ? policyInput.parse(parsed) : enforcementInput.parse(parsed);
  if (args[2] === ':memory:' || !lstatSync(args[2]).isFile()) throw new PlanError(400, 'existing_database_required');
  const probe = new DatabaseSync(args[2], { readOnly: true });
  try { assertBillingQuotaSchema(probe); } finally { probe.close(); }
  const store = new Store(args[2], { migrateMemberships: false });
  try { return args[0] === 'policy' ? provisionPlanPolicy(store, value) : setTenantEnforcement(store, value); }
  finally { store.close(); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { process.stdout.write(`${JSON.stringify(provisionFromArgs(process.argv.slice(2)))}\n`); }
  catch (error) {
    const code = error instanceof PlanError ? error.code : error instanceof z.ZodError ? 'invalid_input' : error instanceof Error && error.message === 'billing_quota_schema_incompatible' ? error.message : 'provision_failed';
    process.stderr.write(`${JSON.stringify({ status: 'failed', code })}\n`); process.exitCode = 1;
  }
}
