import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../src/app.js';
import {Store} from '../src/store.js';
test('bootstrap once; auth; persistent session; origin rejects; logout',async()=>{
 const app=await buildApp(new Store());
 assert.equal((await app.inject('/api/v1/auth/me')).statusCode,401);
 const credentials={email:'owner@example.test',password:'a-long-test-password',organization:'Local Test'};
 const r=await app.inject({method:'POST',url:'/api/v1/auth/bootstrap',payload:credentials});assert.equal(r.statusCode,201,r.body);
 const cookie=r.cookies[0];const cookies={[cookie.name]:cookie.value};
 assert.equal((await app.inject({url:'/api/v1/auth/me',cookies})).statusCode,200);
 assert.equal((await app.inject({method:'POST',url:'/api/v1/auth/bootstrap',payload:credentials})).statusCode,409);
 assert.equal((await app.inject({method:'POST',url:'/api/v1/auth/logout',headers:{origin:'https://evil.invalid'},cookies})).statusCode,403);
 assert.equal((await app.inject({method:'POST',url:'/api/v1/auth/logout',cookies})).statusCode,200);
 assert.equal((await app.inject({url:'/api/v1/auth/me',cookies})).statusCode,401);await app.close();
});
