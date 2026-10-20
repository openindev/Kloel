import { Ajv, type ValidateFunction } from 'ajv';
import { DomainError } from '../domains.js';

const unsafe = new Set(['__proto__','prototype','constructor']);
const fail = () => new DomainError(400,'invalid_integration_schema','Use o subconjunto documentado de JSON Schema, com objetos fechados e limites.');
const ajv = new Ajv({strict:true,allErrors:false,coerceTypes:false,useDefaults:false,removeAdditional:false});

/** Deliberately bounded JSON Schema subset: no executable patterns, remote refs or composition explosion. */
export function argumentSchema(input:unknown):{schema:Record<string,unknown>;validate:ValidateFunction} {
  let count=0;
  const visit=(value:any,depth:number):Record<string,unknown>=>{
    if(++count>300||depth>8||!value||Array.isArray(value)||typeof value!=='object')throw fail();
    const allowed=new Set(['type','description','properties','required','additionalProperties','items','minItems','maxItems','minLength','maxLength','minimum','maximum','enum','const']);
    if(Object.keys(value).some(k=>!allowed.has(k)))throw fail();
    const types=['object','array','string','number','integer','boolean','null'];
    if(!types.includes(value.type))throw fail();
    const out:Record<string,unknown>={...value};
    if(value.description!==undefined&&(typeof value.description!=='string'||value.description.length>500))throw fail();
    if(value.type==='object'){
      if(value.additionalProperties!==undefined&&value.additionalProperties!==false)throw fail();
      if(value.properties!==undefined&&(!value.properties||Array.isArray(value.properties)||typeof value.properties!=='object'))throw fail();
      const props=Object.entries(value.properties||{});
      if(props.length>50||props.some(([k])=>unsafe.has(k)||k.length>100))throw fail();
      out.properties=Object.fromEntries(props.map(([k,v])=>[k,visit(v,depth+1)]));out.additionalProperties=false;
    }
    if(value.type==='array'){
      out.items=visit(value.items,depth+1);out.maxItems=value.maxItems??100;
      if(!Number.isInteger(out.maxItems)||Number(out.maxItems)>100||Number(out.maxItems)<0)throw fail();
    }
    if(value.type==='string'){
      out.maxLength=value.maxLength??2000;
      if(!Number.isInteger(out.maxLength)||Number(out.maxLength)>8000||Number(out.maxLength)<0)throw fail();
    }
    return out;
  };
  try {
    if(JSON.stringify(input).length>30000)throw fail();
    const schema=visit(input,0);if(schema.type!=='object')throw fail();
    const validate=ajv.compile(schema);
    // Each store read yields a new schema object; do not retain every execution in Ajv's object cache.
    ajv.removeSchema(schema);
    return {schema,validate};
  } catch {throw fail();}
}

export function boundedJson(value:unknown,maxBytes=64000):string {
  const walk=(v:any,depth:number)=>{
    if(depth>12)throw new DomainError(400,'invalid_arguments','JSON excede a profundidade permitida.');
    if(v&&typeof v==='object')for(const [k,n] of Object.entries(v)){if(unsafe.has(k))throw new DomainError(400,'invalid_arguments','Chave JSON não permitida.');walk(n,depth+1);}
  };
  walk(value,0);const raw=JSON.stringify(value);
  if(!raw||Buffer.byteLength(raw)>maxBytes)throw new DomainError(400,'invalid_arguments','JSON ausente ou acima do limite.');
  return raw;
}

export function jsonPointer(value:unknown,path:string):unknown {
  if(path==='')return value;
  if(!path.startsWith('/')||path.length>500)throw new DomainError(400,'invalid_pointer','Use um JSON Pointer válido.');
  const keys=path.slice(1).split('/').map(segment=>{
    if(/~(?:[^01]|$)/.test(segment))throw new DomainError(400,'invalid_pointer','JSON Pointer inválido.');
    const key=segment.replace(/~1/g,'/').replace(/~0/g,'~');
    if(unsafe.has(key))throw new DomainError(400,'invalid_pointer','JSON Pointer não permitido.');
    return key;
  });
  let current:any=value;
  for(const key of keys){
    if(current===null||typeof current!=='object'||!Object.hasOwn(current,key))return undefined;
    current=current[key];
  }
  return current;
}

/** A complete {"$arg":"/field"} node copies a JSON value; there is no code or URL interpolation. */
export function renderBody(template:unknown,args:unknown):unknown {
  if(template===undefined)return args;
  const visit=(v:any):any=>{
    if(v&&typeof v==='object'&&!Array.isArray(v)&&Object.hasOwn(v,'$arg')){
      if(Object.keys(v).length!==1||typeof v.$arg!=='string')throw new DomainError(400,'invalid_body_template','Variável de corpo inválida.');
      const value=jsonPointer(args,v.$arg);
      if(value===undefined)throw new DomainError(400,'missing_argument','Uma variável obrigatória do corpo não foi fornecida.');
      return value;
    }
    if(Array.isArray(v))return v.map(visit);
    if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,n])=>[k,visit(n)]));
    return v;
  };
  boundedJson(template);const result=visit(template);boundedJson(result);return result;
}

export function validateTemplate(template:unknown) {
  boundedJson(template);
  const visit=(v:any)=>{
    if(v&&typeof v==='object'){
      if(Object.hasOwn(v,'$arg')){if(Array.isArray(v)||Object.keys(v).length!==1||typeof v.$arg!=='string')throw new DomainError(400,'invalid_body_template','Variável de corpo inválida.');jsonPointer({},v.$arg);}
      else Object.values(v).forEach(visit);
    }
  };visit(template);
}
