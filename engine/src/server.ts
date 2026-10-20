import {buildApp} from './app.js';
const app=await buildApp(undefined,{workers:true});
await app.listen({host:process.env.HOST||'127.0.0.1',port:Number(process.env.PORT||4310)});
console.log(`Kloel engine listening on ${process.env.HOST||'127.0.0.1'}:${process.env.PORT||4310}. See /health.`);
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,async()=>{await app.close();process.exit(0);});
