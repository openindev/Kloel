import type { FastifyInstance } from 'fastify';

const page = (reset: boolean) => `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Kloel · ${reset ? 'Redefinir senha' : 'Recuperar acesso'}</title><link rel="stylesheet" href="/ops.css"><main><header><span class="brand">Kloel AI</span></header><h1>${reset ? 'Escolha sua nova senha' : 'Recupere seu acesso'}</h1><section><form id="recovery" method="post" action="/api/v1/auth/${reset ? 'reset-password' : 'forgot-password'}" data-mode="${reset ? 'reset' : 'request'}">${reset ? '<label>Nova senha<input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></label><label>Repita a nova senha<input name="confirmation" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></label><p>Use pelo menos 12 caracteres. Ao redefinir, suas sessões e chaves API serão revogadas.</p>' : '<label>E-mail da conta<input name="email" type="email" autocomplete="email" maxlength="254" required></label>'}<button>${reset ? 'Redefinir senha' : 'Receber instruções'}</button></form><output id="result" role="status"></output><a href="/ops">Voltar ao acesso</a></section></main><script src="/auth-recovery.js" defer></script></html>`;

const script = String.raw`
const form=document.querySelector('#recovery'),output=document.querySelector('#result'),button=form.querySelector('button');
let token=new URLSearchParams(location.hash.slice(1)).get('token')||'';
if(location.hash)history.replaceState(null,'',location.pathname);
if(form.dataset.mode==='reset'&&!/^[A-Za-z0-9_-]{43}$/.test(token)){button.disabled=true;output.textContent='Abra o link completo recebido por e-mail ou solicite uma nova recuperação.';}
form.addEventListener('submit',async event=>{
 event.preventDefault();button.disabled=true;output.textContent='Processando…';
 try{
  const values=Object.fromEntries(new FormData(form));const reset=form.dataset.mode==='reset';
  if(reset&&values.password!==values.confirmation)throw new Error('As senhas precisam ser iguais.');
  const response=await fetch('/api/v1/auth/'+(reset?'reset-password':'forgot-password'),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(reset?{...values,token}:values)});
  const data=await response.json();if(!response.ok)throw new Error(data.error?.message||'Não foi possível concluir agora.');
  form.reset();output.textContent=reset?'Senha redefinida. Entre novamente na sua conta.':data.message;
  if(reset){token='';form.hidden=true;}else button.disabled=false;
 }catch(error){output.textContent=error.message;button.disabled=false;}
});`;

export async function registerAuthRecoveryUI(app: FastifyInstance) {
  const csp = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
  for (const [url, reset] of [['/forgot-password', false], ['/reset-password', true]] as const) {
    app.get(url, async (_request, reply) => reply.header('Content-Security-Policy', csp).header('Referrer-Policy', 'no-referrer').header('Cache-Control', 'no-store').type('text/html').send(page(reset)));
  }
  app.get('/auth-recovery.js', async (_request, reply) => reply.type('application/javascript').send(script));
}
