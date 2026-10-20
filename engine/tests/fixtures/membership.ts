import { randomUUID } from 'node:crypto';
import type { Store } from '../../src/store.js';
import type { MembershipActor } from '../../src/memberships/service.js';

/** Test setup only: production authorization never falls back to legacy user columns. */
export function seedMemberships(store: Store): void {
  const now = new Date().toISOString();
  for (const user of store.db.prepare('SELECT id,tenant_id,role FROM users').all()) {
    store.db.prepare("INSERT OR IGNORE INTO organizations(id,name,status,created_at) VALUES(?,?,'active',?)").run(String(user.tenant_id), 'Fixture workspace', now);
    store.db.prepare('INSERT OR IGNORE INTO memberships(id,user_id,tenant_id,role,joined_at) VALUES(?,?,?,?,?)').run(randomUUID(), String(user.id), String(user.tenant_id), String(user.role), now);
  }
  store.db.exec('UPDATE sessions SET tenant_id=(SELECT tenant_id FROM users WHERE id=sessions.user_id) WHERE tenant_id IS NULL');
}

export function seedMember(store: Store, actor: MembershipActor): void {
  store.db.prepare('INSERT OR IGNORE INTO users(id,tenant_id,email,password,role) VALUES(?,?,?,?,?)').run(actor.userId, actor.tenantId, `${actor.userId}@example.test`, 'unused-fixture-password', actor.role);
  const now = new Date().toISOString();
  store.db.prepare("INSERT OR IGNORE INTO organizations(id,name,status,created_at) VALUES(?,?,'active',?)").run(actor.tenantId, 'Fixture workspace', now);
  store.db.prepare('INSERT OR IGNORE INTO memberships(id,user_id,tenant_id,role,joined_at) VALUES(?,?,?,?,?)').run(randomUUID(), actor.userId, actor.tenantId, actor.role, now);
}
