// Local sandbox webhook bridge. Requires the official Stripe CLI on PATH.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';

const key=process.env.STRIPE_SECRET_KEY;
if(!key?.startsWith('sk_test_'))throw new Error('Only a Stripe sandbox test key is accepted.');
const base='http://127.0.0.1:4310';
const env={PATH:process.env.PATH,HOME:process.env.HOME,STRIPE_API_KEY:key,NO_COLOR:'1'};
const args=['listen','--skip-update','--config','data/stripe-cli.toml'];
const output=await promisify(execFile)('stripe',[...args,'--print-secret'],{env,maxBuffer:65536,timeout:30000}).catch(()=>{throw new Error('Stripe CLI signing-secret setup failed; output withheld.');});
const secret=(output.stdout+'\n'+output.stderr).match(/whsec_[A-Za-z0-9]+/)?.[0];
if(!secret)throw new Error('Stripe CLI did not return a signing secret.');
const owner=JSON.parse(readFileSync('data/local-owner.json','utf8'));
const login=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:owner.email,password:owner.password})});
if(!login.ok)throw new Error('Local owner login failed.');
const cookie=login.headers.get('set-cookie').split(';')[0];
const configured=await fetch(base+'/api/v1/local/config',{method:'PUT',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json','X-Kloel-Local-Config':'1'},body:JSON.stringify({key:'STRIPE_WEBHOOK_SECRET',value:secret})});
if(!configured.ok)throw new Error('Local webhook configuration failed.');
console.log('Stripe sandbox webhook configured; secret omitted.');
const child=spawn('stripe',[...args,'--events','checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed','--forward-to',base+'/api/v1/webhooks/stripe'],{env,stdio:['ignore','pipe','pipe']});
const redact=value=>value.replace(/(?:whsec_|(?:sk|rk|pk)_(?:test|live)_)[A-Za-z0-9]+/g,'[redacted]');
for(const stream of [child.stdout,child.stderr]){
  let pending='';
  stream.on('data',data=>{
    pending+=data.toString();const lines=pending.split('\n');pending=lines.pop()||'';
    for(const line of lines){
      const activeSecret=line.match(/whsec_[A-Za-z0-9]+/)?.[0];
      if(activeSecret&&activeSecret!==secret){console.error('Webhook signing-secret mismatch; bridge stopped.');child.kill('SIGTERM');return;}
      process.stdout.write(redact(line)+'\n');
    }
    if(pending.length>65536){pending='';console.error('Unexpected oversized CLI output; bridge stopped.');child.kill('SIGTERM');}
  });
  stream.on('end',()=>{if(pending)process.stdout.write(redact(pending));});
}
child.on('error',()=>{console.error('Stripe CLI could not start.');process.exitCode=1;});
child.on('close',code=>{process.exitCode=code??0;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
