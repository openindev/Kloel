import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { beforeHttpFixture,beforeHttpVoiceFixture } from './fixtures/before-http.js';
import { sourceSecrets } from '../src/before-context/http-source.js';

test('HTTP source config keeps secrets by re-encrypting for new revision; historical config receipt and CAS are independent',async t=>{
 const f=await beforeHttpFixture(t);await f.enable();const created=await f.configure();assert.equal(created.statusCode,200,created.body);const old=f.store.list(f.actor.tenantId,'before-http-sources')[0];assert.equal(sourceSecrets(old).url,f.secrets.url);
 const enabled=await f.configure({...f.source,enabled:true},1,randomUUID(),{mode:'keep'});assert.equal(enabled.statusCode,200,enabled.body);const current=f.store.list(f.actor.tenantId,'before-http-sources')[0];assert.notEqual(current.encryptedSecrets,old.encryptedSecrets);assert.deepEqual(sourceSecrets(current),sourceSecrets(old));
 const get=await f.request('GET',f.httpBase);assert.equal(get.json().state,'enabled');assert.ok(!get.body.includes('synthetic-before-http-secret'));assert.equal(get.json().targetOrigin,'https://context.example.com');assert.ok(!get.body.includes(f.secrets.url));
 assert.equal((await f.configure({...f.source,enabled:false},1)).statusCode,409);assert.equal((await f.request('GET','/api/v1/before-context/http-config-operations/'+created.json().operation.key)).json().revision,1);assert.equal(f.dns.length,0);
});
for(const [name,mutate] of [
 ['non-HTTPS',(s:any)=>{s.url='http://example.com/path';}],['loopback',(s:any)=>{s.url='https://127.0.0.1/path';}],['cookie',(s:any)=>{s.headers.cookie='secret';}],['CRLF',(s:any)=>{s.headers.authorization='bearer\r\nbad';}],['phone export',(s:any)=>{s.bodyTemplate={phone:{$before:'system.phone'}};}],['partial text interpolation',(s:any)=>{s.bodyTemplate={$before:'vars.unknown'};}],
] as const)test(`source rejects ${name} before any external lookup`,async t=>{const f=await beforeHttpFixture(t);await f.enable();const secrets=structuredClone(f.secrets);mutate(secrets);const r=await f.configure(f.source,0,randomUUID(),secrets);assert.equal(r.statusCode,400,r.body);assert.equal(f.dns.length,0);assert.equal(f.store.list(f.actor.tenantId,'before-http-sources').length,0);});
test('source first enable, stale Before, invalid map/type/operator and revision overflow fail before reservation',async t=>{
 const f=await beforeHttpFixture(t);await f.enable();assert.equal((await f.configure({...f.source,enabled:true})).statusCode,409);assert.equal((await f.configure(f.source,0,randomUUID(),f.secrets,0)).statusCode,409);
 for(const config of [{...f.source,mappings:[{variable:'unknown',jsonPointer:'/x'}]},{...f.source,conditions:[{field:'vars.ativo',operator:'is_set'}]},{...f.source,conditions:[{field:'vars.nome',operator:'bogus'}]},{...f.source,schedule:{weekdays:[1],start:'22:00',end:'06:00',overnight:false}}])assert.equal((await f.configure(config as any)).statusCode,400);
 await f.enableHttp();const row=f.store.list(f.actor.tenantId,'before-http-sources')[0];f.store.update(f.actor.tenantId,'before-http-sources',row.id,{revision:Number.MAX_SAFE_INTEGER});assert.equal((await f.configure(f.source,Number.MAX_SAFE_INTEGER)).json().error.code,'before_context_revision_exhausted');assert.equal(f.dns.length,0);
});
test('configuration replay survives removal but membership ABA cannot adopt original receipt or grant',async t=>{
 const f=await beforeHttpFixture(t);await f.enable();const key=randomUUID(),body={...f.source};const r=await f.configure(body,0,key);assert.equal(r.statusCode,200,r.body);const row=f.store.list(f.actor.tenantId,'before-http-sources')[0];f.store.remove(f.actor.tenantId,'before-http-sources',row.id);assert.equal((await f.configure(body,0,key)).json().replayed,true);f.aba();const fresh=await f.freshHeaders();assert.equal((await f.request('GET','/api/v1/before-context/http-config-operations/'+key,undefined,fresh)).statusCode,404);assert.equal(f.dns.length,0);
});
