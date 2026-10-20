import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
test('store isolation, protected fields, rollback and delete',()=>{
 const s=new Store(); const a=s.create('a','contacts',{name:'A',id:'overwrite',tenantId:'b'});
 assert.equal(a.tenantId,'a');assert.notEqual(a.id,'overwrite');assert.equal(s.get('b','contacts',a.id),undefined);
 const u=s.update('a','contacts',a.id,{tenantId:'b',id:'bad',name:'B'});assert.equal(u?.tenantId,'a');assert.equal(u?.id,a.id);
 assert.throws(()=>s.transaction(()=>{s.create('a','contacts',{name:'rollback'});throw new Error('fail');}));
 assert.equal(s.list('a','contacts').length,1);assert.equal(s.remove('b','contacts',a.id),false);s.close();
});
