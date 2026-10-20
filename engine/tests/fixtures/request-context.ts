import assert from 'node:assert/strict';
import type { Store } from '../../src/store.js';
import { CONTEXT_HEADERS, resolveSessionContext } from '../../src/request-context.js';

/** Simulate another request changing authority after admission, before a write boundary. */
export function guardedBoundary(store: Store, sessionHash: string, userId: string) {
  const context = resolveSessionContext(store, sessionHash)!.context;
  const headers = Object.fromEntries(Object.entries(CONTEXT_HEADERS).map(([key, name]) => [name, context[key as keyof typeof context] ?? '-']));
  const snapshot = () => store.db.prepare('SELECT * FROM entities ORDER BY tenant_id,collection,id').all();
  const arm = (boundary: 'BEGIN' | 'SAVEPOINT', occurrence = 1) => {
    const original = store.db.exec.bind(store.db); let seen = 0, changed = false;
    store.db.exec = (sql: string) => {
      if (sql.startsWith(boundary) && ++seen === occurrence) {
        store.db.prepare('UPDATE memberships SET role=? WHERE user_id=?').run('admin', userId);
        store.db.prepare('UPDATE memberships SET role=? WHERE user_id=?').run('owner', userId);
        changed = true;
      }
      return original(sql);
    };
    return () => { store.db.exec = original; assert.equal(changed, true, 'requested effect boundary must be exercised'); };
  };
  const rejected = (response: { statusCode: number; body: string; json: () => any }) => {
    assert.equal(response.statusCode, 409, response.body);
    assert.equal(response.json().error.code, 'context_changed_in_flight');
  };
  return { headers, snapshot, arm, rejected };
}

