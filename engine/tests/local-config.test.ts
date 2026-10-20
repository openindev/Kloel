import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { registerLocalConfig } from '../src/local-config.js';
import { Store } from '../src/store.js';
import { createHash } from 'node:crypto';

test('local credentials require owner, loopback, same origin and explicit header; secrets never returned',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'kloel-config-test-')),file=join(dir,'.env.local');
  const oldBinding=process.env.PROVIDER_TENANT_ID,oldToken=process.env.TWILIO_AUTH_TOKEN;
  delete process.env.PROVIDER_TENANT_ID;
  writeFileSync(file,'OPENAI_MODEL=gpt-4.1-mini\n');
  const store=new Store();
  for(const tenant of ['tenant-config-test','other-tenant'])store.db.prepare("INSERT INTO organizations(id,name,status,created_at) VALUES(?,?,'active',?)").run(tenant,tenant,new Date().toISOString());
  for(const role of ['owner','member']){
    store.db.prepare('INSERT INTO users(id,tenant_id,email,password,role) VALUES(?,?,?,?,?)').run(role,'tenant-config-test',role+'@example.com','unused-test-hash',role);
    store.db.prepare('INSERT INTO memberships(id,user_id,tenant_id,role,joined_at) VALUES(?,?,?,?,?)').run(role,role,'tenant-config-test',role,new Date().toISOString());
    store.db.prepare('INSERT INTO sessions(hash,user_id,expires,tenant_id) VALUES(?,?,?,?)').run(createHash('sha256').update(role+'-session').digest('hex'),role,Date.now()+60000,'tenant-config-test');
  }
  store.db.prepare("INSERT INTO memberships(id,user_id,tenant_id,role,joined_at) VALUES('other-owner','owner','other-tenant','owner',?)").run(new Date().toISOString());
  store.db.prepare('INSERT INTO sessions(hash,user_id,expires,tenant_id) VALUES(?,?,?,?)').run(createHash('sha256').update('other-session').digest('hex'),'owner',Date.now()+60000,'other-tenant');
  const app=Fastify();app.decorateRequest('actor');app.decorateRequest('cookies');app.addHook('onRequest',async req=>{
    const role=req.headers['x-role']==='member'?'member':'owner';const other=req.headers['x-tenant']==='other';
    req.actor={tenantId:other?'other-tenant':'tenant-config-test',userId:role,role};req.cookies=req.headers['x-bearer-only']?{}:{kloel_session:other?'other-session':role+'-session'};
    if(req.headers['x-revoke-session'])store.db.prepare('DELETE FROM sessions WHERE hash=?').run(createHash('sha256').update(role+'-session').digest('hex'));
  });
  await registerLocalConfig(app,store,file);
  const headers={host:'127.0.0.1:4310',origin:'http://127.0.0.1:4310','x-kloel-local-config':'1'};
  const payload={key:'TWILIO_AUTH_TOKEN',value:'local-test-secret-not-a-real-token'};
  try {
    for(const variant of [ {headers:{}}, {headers:{...headers,origin:'https://evil.test'}}, {headers:{...headers,host:'evil.test'}}, {headers:{...headers,'x-role':'member'}}, {headers,remoteAddress:'10.0.0.1'}]) {
      const res=await app.inject({method:'PUT',url:'/api/v1/local/config',payload,...variant});assert.equal(res.statusCode,403,res.body);
    }
    const saved=await app.inject({method:'PUT',url:'/api/v1/local/config',headers,payload});assert.equal(saved.statusCode,200,saved.body);assert.ok(!saved.body.includes(payload.value));
    const result=readFileSync(file,'utf8');assert.ok(result.includes('OPENAI_MODEL=gpt-4.1-mini'));assert.ok(result.includes(payload.value));assert.equal(statSync(file).mode&0o777,0o600);
    const status=await app.inject({url:'/api/v1/local/config',headers});assert.ok(!status.body.includes(payload.value));assert.equal(status.json().tenantBound,true);
    for(const extra of [{'x-tenant':'other'},{'x-bearer-only':'1'}]){
      const deniedRead=await app.inject({url:'/api/v1/local/config',headers:{...headers,...extra}});assert.equal(deniedRead.statusCode,403);
      const deniedWrite=await app.inject({method:'PUT',url:'/api/v1/local/config',headers:{...headers,...extra},payload});assert.equal(deniedWrite.statusCode,403);
    }
    const bad=await app.inject({method:'PUT',url:'/api/v1/local/config',headers,payload:{key:'UNSAFE_ENV',value:'x'}});assert.notEqual(bad.statusCode,200);
    const newline=await app.inject({method:'PUT',url:'/api/v1/local/config',headers,payload:{...payload,value:'x\nOTHER=bad'}});assert.notEqual(newline.statusCode,200);
    const stale=await app.inject({method:'PUT',url:'/api/v1/local/config',headers:{...headers,'x-revoke-session':'1'},payload:{...payload,value:'must-not-be-written'}});assert.equal(stale.statusCode,403);assert.equal(readFileSync(file,'utf8'),result);
  } finally {await app.close();store.close();rmSync(dir,{recursive:true,force:true});if(oldBinding===undefined)delete process.env.PROVIDER_TENANT_ID;else process.env.PROVIDER_TENANT_ID=oldBinding;if(oldToken===undefined)delete process.env.TWILIO_AUTH_TOKEN;else process.env.TWILIO_AUTH_TOKEN=oldToken;}
});
