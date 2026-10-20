import type { DatabaseSync } from 'node:sqlite';

/** Installation schema only; startup never provisions an entitlement or a policy. */
export function initializeBillingQuota(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS billing_quota_meta (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, started_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS billing_plan_policies (scope TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS billing_plan_enforcement (scope TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS billing_plan_entitlements (scope TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS billing_plan_operations (key_hash TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS billing_chat_rounds (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, source_kind TEXT NOT NULL, operation_id TEXT NOT NULL, round_index INTEGER NOT NULL, day TEXT NOT NULL, state TEXT NOT NULL, body TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS billing_chat_round_identity ON billing_chat_rounds(tenant_id,source_kind,operation_id,round_index);
    CREATE INDEX IF NOT EXISTS billing_chat_round_day ON billing_chat_rounds(tenant_id,day,state);`);
  db.prepare('INSERT OR IGNORE INTO billing_quota_meta(id,version,started_at) VALUES(1,1,?)').run(new Date().toISOString());
  assertBillingQuotaSchema(db);
}

/** The CLI calls this before opening Store, so it cannot migrate an old installation. */
export function assertBillingQuotaSchema(db: DatabaseSync) {
  const tables: Record<string, string[]> = {
    billing_quota_meta: ['id', 'version', 'started_at'], billing_plan_policies: ['scope', 'body'],
    billing_plan_enforcement: ['scope', 'body'], billing_plan_entitlements: ['scope', 'body'],
    billing_plan_operations: ['key_hash', 'fingerprint', 'body'],
    billing_chat_rounds: ['id', 'tenant_id', 'source_kind', 'operation_id', 'round_index', 'day', 'state', 'body'],
  };
  for (const [table, columns] of Object.entries(tables)) {
    const actual = db.prepare(`PRAGMA table_info(${table})`).all().map(row => String(row.name));
    if (JSON.stringify(actual) !== JSON.stringify(columns)) throw new Error('billing_quota_schema_incompatible');
  }
  if (db.prepare('SELECT version FROM billing_quota_meta WHERE id=1').get()?.version !== 1) throw new Error('billing_quota_schema_incompatible');
  const index = db.prepare('PRAGMA index_list(billing_chat_rounds)').all().find(row => row.name === 'billing_chat_round_identity');
  const columns = db.prepare('PRAGMA index_info(billing_chat_round_identity)').all().map(row => row.name);
  if (index?.unique !== 1 || JSON.stringify(columns) !== JSON.stringify(['tenant_id', 'source_kind', 'operation_id', 'round_index'])) throw new Error('billing_quota_schema_incompatible');
}
