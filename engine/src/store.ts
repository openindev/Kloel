import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { initializeMemberships } from './memberships/service.js';
import { initializeApiKeys } from './api-keys/service.js';
import { initializeBillingQuota } from './billing/schema.js';

export type Entity = { id: string; tenantId: string; createdAt: string; updatedAt: string; [key: string]: unknown };
export class Store {
  readonly db: DatabaseSync;
  constructor(path = ':memory:', options: { migrateMemberships?: boolean } = {}) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS entities (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, collection TEXT NOT NULL, body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS entity_scope ON entities(tenant_id,collection);
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS webhook_receipts (provider TEXT NOT NULL, event_id TEXT NOT NULL, received_at TEXT NOT NULL, PRIMARY KEY(provider,event_id));`);
    try { initializeBillingQuota(this.db); if (options.migrateMemberships !== false) { initializeMemberships(this); initializeApiKeys(this); } }
    catch (error) { this.db.close(); throw error; }
  }
  list(tenantId: string, collection: string): Entity[] {
    return this.db.prepare('SELECT body FROM entities WHERE tenant_id=? AND collection=? ORDER BY rowid').all(tenantId, collection).map(r=>JSON.parse(String(r.body)));
  }
  get(tenantId:string,collection:string,id:string):Entity|undefined {
    const r=this.db.prepare('SELECT body FROM entities WHERE tenant_id=? AND collection=? AND id=?').get(tenantId,collection,id);
    return r ? JSON.parse(String(r.body)) : undefined;
  }
  create(tenantId:string,collection:string,data:Record<string,unknown>):Entity {
    const now=new Date().toISOString();
    const item={...data,id:randomUUID(),tenantId,createdAt:now,updatedAt:now};
    this.db.prepare('INSERT INTO entities(id,tenant_id,collection,body) VALUES(?,?,?,?)').run(item.id,tenantId,collection,JSON.stringify(item)); return item;
  }
  update(tenantId:string,collection:string,id:string,data:Record<string,unknown>):Entity|undefined {
    const old=this.get(tenantId,collection,id); if(!old)return;
    const item={...old,...data,id:old.id,tenantId:old.tenantId,createdAt:old.createdAt,updatedAt:new Date().toISOString()};
    this.db.prepare('UPDATE entities SET body=? WHERE tenant_id=? AND collection=? AND id=?').run(JSON.stringify(item),tenantId,collection,id);return item;
  }
  remove(tenantId:string,collection:string,id:string):boolean {return this.db.prepare('DELETE FROM entities WHERE tenant_id=? AND collection=? AND id=?').run(tenantId,collection,id).changes>0;}
  transaction<T>(fn:()=>T):T {this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  close(){this.db.close();}
}
