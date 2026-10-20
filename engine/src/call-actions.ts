import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Entity, Store } from './store.js';
import { requireRequestPermission } from './memberships/access.js';
import { MembershipError } from './memberships/service.js';
import { metaCreds } from './meta-tenants.js';
import { lastWhatsAppInbound, normalizePhone } from './lead-link.js';
import { oauthRequest } from './oauth/access.js';
import { presignGet } from './recordings.js';

/** Fonio parity for the voice "Recursos": WhatsApp number ownership, post-call WhatsApp actions, transfer rules, recording refusal. */
const OWN = 'wa-ownership', VERIFIED = 'wa-verified-numbers';
export const VERIFY_RE = /^\s*kloel verify ([A-Za-z0-9]{16,40})\s*$/i;
const editorState = (store: Store, tenant: string, agentId: string) => (store.list(tenant, 'agent-editor-states').find(r => r.agentId === agentId)?.state ?? {}) as Record<string, any>;
const officialNumber = () => (process.env.KLOEL_WHATSAPP_NUMBER || '+551152863804').replace(/[^\d+]/g, '');
const digits = (s: string) => s.replace(/\D/g, '');

/** Called from the Meta webhook (inside its transaction) for "kloel verify <code>" sent to Kloel's official number. */
export function consumeOwnershipCode(store: Store, body: string, from: string): boolean {
  const m = VERIFY_RE.exec(body); if (!m) return false;
  const code = m[1]!, number = normalizePhone('+' + digits(from)); if (!number) return true;
  const tenants = (store.db.prepare("SELECT id FROM organizations WHERE status='active'").all() as { id: string }[]).map(r => r.id);
  for (const t of tenants) {
    const row = store.list(t, OWN).find(r => r.code === code && r.status === 'pending' && Date.now() - Date.parse(String(r.createdAt)) < 30 * 60_000);
    if (!row) continue;
    store.update(t, OWN, row.id, { status: 'verified', number, verifiedAt: new Date().toISOString() });
    if (!store.list(t, VERIFIED).some(v => v.number === number)) store.create(t, VERIFIED, { number, verifiedAt: new Date().toISOString(), verifiedBy: row.userId ?? null });
    console.log('wa_ownership_verified');
    return true;
  }
  console.log('wa_ownership_code_unknown');
  return true;
}

function inHours(bh: any, now = new Date()): boolean {
  if (!bh || !Array.isArray(bh.days)) return true;
  const tz = typeof bh.timezone === 'string' && bh.timezone ? bh.timezone : 'America/Sao_Paulo';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now).map(p => [p.type, p.value]));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(String(parts.weekday)), hm = `${String(parts.hour).replace('24', '00')}:${parts.minute}`;
  const d = bh.days.find((x: any) => x.day === day);
  return !!d?.enabled && (d.ranges ?? []).some((r: any) => typeof r.from === 'string' && typeof r.to === 'string' && r.from <= hm && hm < r.to);
}

async function calendarBusyNow(store: Store, tenant: string, connectionId: string): Promise<boolean | undefined> {
  const c = store.get(tenant, 'oauth-connections', connectionId); if (!c || c.status !== 'connected') return;
  const from = new Date(), to = new Date(Date.now() + 10 * 60_000);
  try {
    if (c.provider === 'google') {
      const r = await oauthRequest(store, c, 'https://www.googleapis.com/calendar/v3/freeBusy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: 'primary' }] }) }) as any;
      return (r?.calendars?.primary?.busy ?? []).length > 0;
    }
    const u = new URL('https://graph.microsoft.com/v1.0/me/calendarView'); u.searchParams.set('startDateTime', from.toISOString()); u.searchParams.set('endDateTime', to.toISOString()); u.searchParams.set('$select', 'showAs,isCancelled');
    const r = await oauthRequest(store, c, u.toString()) as any;
    return (r?.value ?? []).some((e: any) => !e.isCancelled && e.showAs !== 'free');
  } catch { return; }
}

async function sendEmail(to: string, subject: string, text: string) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) return false;
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ from: process.env.RESEND_FROM, to: [to], subject, text }) }).catch(() => undefined);
  return !!r?.ok;
}

/** Text inside the 24h window; outside it only the approved summary template (WHATSAPP_SUMMARY_TEMPLATE) may be used. */
async function waSend(store: Store, senderTenant: string, to: string, text: string): Promise<{ ok: boolean; reason?: string }> {
  const c = metaCreds(senderTenant); if (!c?.token || !c.phoneId) return { ok: false, reason: 'whatsapp_nao_configurado' };
  const inbound = lastWhatsAppInbound(store, senderTenant, to), inWindow = !!inbound && Date.now() - Date.parse(String(inbound.createdAt)) < 23.5 * 3600_000;
  const tpl = process.env.WHATSAPP_SUMMARY_TEMPLATE;
  if (!inWindow && !tpl) return { ok: false, reason: 'fora_da_janela_sem_modelo' };
  const payload = inWindow ? { messaging_product: 'whatsapp', to: digits(to), type: 'text', text: { preview_url: false, body: text.slice(0, 4000) } }
    : { messaging_product: 'whatsapp', to: digits(to), type: 'template', template: { name: tpl, language: { code: process.env.WHATSAPP_TEMPLATE_LANG || 'pt_BR' }, components: [{ type: 'body', parameters: [{ type: 'text', text: text.replace(/\s+/g, ' ').slice(0, 900) }] }] } };
  const r = await fetch(`https://graph.facebook.com/${c.version}/${c.phoneId}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${c.token}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => undefined);
  return r?.ok ? { ok: true } : { ok: false, reason: `falha_${r?.status ?? 'rede'}` };
}

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/, EMAIL_IN_TEXT = /[^\s@<>,;:()"'\[\]]+@[^\s@<>,;:()"'\[\]]+\.[A-Za-z]{2,}/g;
/**
 * Chats e WhatsApp: quem escreve é anônimo, então "Deixar a IA decidir" só escolhe entre endereços que a empresa configurou
 * (destinatários fixos das ações do assistente e endereços escritos na instrução de destinatários) ou e-mails do contato CRM
 * vinculado à conversa que a equipe confirmou (cadastro manual, importação ou captura revisada por uma pessoa). Um endereço que
 * só aparece na transcrição nunca é destinatário. Ligações mantêm a extração da transcrição (quem liga dita o próprio e-mail).
 */
function chatRecipientChoices(store: Store, tenant: string, st: Record<string, any>, conv: Entity, a: any) {
  const out = new Set<string>();
  for (const e of (st.emails ?? []) as any[]) for (const r of Array.isArray(e?.recipients) ? e.recipients : []) out.add(String(r).trim().toLowerCase());
  for (const m of String(a.recipientsInstruction ?? '').match(EMAIL_IN_TEXT) ?? []) out.add(m.toLowerCase());
  const contact = typeof conv.contactId === 'string' && conv.contactId ? store.get(tenant, 'contacts', conv.contactId) : undefined;
  if (contact?.schemaVersion === 2 && ['manual', 'import', 'conversation'].includes(String(contact.source)) && Array.isArray(contact.emails))
    for (const e of contact.emails as any[]) if (typeof e?.normalized === 'string') out.add(e.normalized);
  return new Set([...out].filter(x => EMAIL_RE.test(x)));
}
/** Cota diária (UTC) por organização dos e-mails das ações de conversa, em todos os canais; cada destinatário conta 1. */
const EMAIL_BUDGETS = 'conversation-email-budgets';
export const conversationEmailDailyLimit = () => { const v = Number(process.env.CONVERSATION_EMAILS_MAX_PER_DAY); return Number.isSafeInteger(v) && v > 0 && v <= 10000 ? v : 200; };
const emailBudget = (store: Store, tenant: string) => { const day = new Date().toISOString().slice(0, 10), row = store.list(tenant, EMAIL_BUDGETS).find(b => b.day === day); return { day, row, used: Number(row?.count ?? 0) }; };
function reserveEmails(store: Store, tenant: string, n: number) {
  const { day, row, used } = emailBudget(store, tenant); if (used + n > conversationEmailDailyLimit()) return false;
  if (row) store.update(tenant, EMAIL_BUDGETS, row.id, { count: used + n }); else store.create(tenant, EMAIL_BUDGETS, { day, count: n });
  return true;
}
async function sendEmailAs(from: string, to: string[], subject: string, text: string, idem: string) {
  if (!process.env.RESEND_API_KEY) return false;
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json', 'Idempotency-Key': idem.slice(0, 256) }, body: JSON.stringify({ from, to, subject, text }) }).catch(() => undefined);
  return !!r?.ok;
}
const decode = (t: string) => t.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
export function renderText(t: string, vars: Record<string, string>) { return t.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => vars[k] ?? ''); }
export function renderHtmlVars(html: string, vars: Record<string, string>) {
  return renderText(html.replace(/<span[^>]*data-var="([\w.]+)"[^>]*>[\s\S]*?<\/span>/g, (_, k) => (vars[k] ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')), vars);
}
export function htmlToText(html: string) {
  return decode(html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<li[^>]*>/gi, '• ').replace(/<[^>]+>/g, '')).replace(/\n{3,}/g, '\n\n').trim();
}
function companyName(store: Store, tenant: string) { const o = store.list(tenant, 'organization-settings')[0] ?? store.list(tenant, 'organizations')[0]; return String(o?.name ?? o?.companyName ?? ''); }
function duration(conv: Entity) { const s = Date.parse(String(conv.startedAt ?? '')), e = Date.parse(String(conv.endedAt ?? '')) || Date.now(); if (!s) return ''; const m = Math.round((e - s) / 1000); return `${Math.floor(m / 60)}min ${m % 60}s`; }

async function llmJson(instructions: string, input: string): Promise<any> {
  const key = process.env.OPENAI_API_KEY, model = process.env.OPENAI_MODEL; if (!key || !model) return;
  try {
    const r = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ model, store: false, max_output_tokens: 700, instructions, input: [{ role: 'user', content: input }], text: { format: { type: 'json_object' } } }) });
    const d = await r.json() as any;
    const t = (d.output ?? []).flatMap((i: any) => i.type === 'message' ? i.content ?? [] : []).filter((c: any) => c.type === 'output_text').map((c: any) => c.text).join('');
    return JSON.parse(t);
  } catch { return; }
}

export function registerCallActions(app: FastifyInstance, store: Store, prefix: string, scope: (req: FastifyRequest) => { tenant: string; agentId: string }) {
  const wrap = (fn: (r: FastifyRequest, p: FastifyReply) => unknown) => async (r: FastifyRequest, p: FastifyReply) => {
    p.header('Cache-Control', 'no-store');
    try { return await fn(r, p); } catch (e) { if (e instanceof MembershipError) return p.code(e.statusCode).send({ error: { code: e.code, message: e.message } }); throw e; }
  };
  // ---- WhatsApp number ownership (app) ----
  app.post('/api/v1/whatsapp/ownership', wrap(req => {
    const actor = requireRequestPermission(store, req, 'agents:write');
    const code = randomBytes(16).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 22).padEnd(22, 'x');
    store.create(actor.tenantId, OWN, { code, status: 'pending', userId: actor.userId ?? null });
    const message = `kloel verify ${code}`, to = officialNumber();
    return { code, message, to, link: `https://wa.me/${digits(to)}?text=${encodeURIComponent(message)}` };
  }));
  app.get('/api/v1/whatsapp/ownership/:code', wrap((req, reply) => {
    const actor = requireRequestPermission(store, req, 'agents:read');
    const code = String((req.params as any).code);
    const row = store.list(actor.tenantId, OWN).find(r => r.code === code);
    if (!row) return reply.code(404).send({ error: { code: 'not_found', message: 'Código não encontrado.' } });
    return { status: row.status, number: row.status === 'verified' ? row.number : null };
  }));
  app.get('/api/v1/whatsapp/verified-numbers', wrap(req => {
    const actor = requireRequestPermission(store, req, 'agents:read');
    return { items: store.list(actor.tenantId, VERIFIED).map(v => ({ number: String(v.number), verifiedAt: String(v.verifiedAt) })) };
  }));

  // ---- Transfers (voice worker) ----
  const target = (tenant: string, agentId: string, id: string) => (editorState(store, tenant, agentId).transfers ?? []).find((t: any) => t?.id === id);
  app.post(`${prefix}transfer/check`, async req => {
    const { tenant, agentId } = scope(req); const b = z.object({ id: z.string().max(128) }).strict().parse(req.body);
    const t = target(tenant, agentId, b.id); if (!t) return { ok: false, reason: 'destino_desconhecido' };
    const st = editorState(store, tenant, agentId), win = t.activeWindow ?? 'any';
    if (win !== 'any') { const open = inHours(t.businessHours ?? st.businessHours); if (win === 'during' && !open || win === 'outside' && open) return { ok: false, reason: win === 'during' ? 'fora_do_horario' : 'dentro_do_horario' }; }
    if (t.checkAvailability && t.calendarConnectionId) { const busy = await calendarBusyNow(store, tenant, String(t.calendarConnectionId)); if (busy) return { ok: false, reason: 'ocupado_no_calendario' }; }
    return { ok: true };
  });
  app.post(`${prefix}transfer/failed`, async req => {
    const { tenant, agentId } = scope(req); const b = z.object({ id: z.string().max(128), phone: z.string().max(40).optional(), reason: z.string().max(60).optional(), callId: z.string().max(128).optional() }).strict().parse(req.body);
    const t = target(tenant, agentId, b.id); if (!t?.emailOnFailure || typeof t.failureEmail !== 'string') return { ok: false, reason: 'sem_email' };
    const ok = await sendEmail(t.failureEmail, `Kloel — transferência não concluída: ${String(t.label || 'destino')}`,
      `Uma ligação não pôde ser transferida para "${String(t.label || t.destination)}".\nMotivo: ${b.reason ?? 'falha'}\nTelefone de quem ligou: ${b.phone ?? 'desconhecido'}\n${b.callId ? `Conversa: https://www.kloel.ai/app/inbox?id=${b.callId}\n` : ''}\nKloel — https://www.kloel.ai`);
    console.log('transfer_failure_email', ok); return { ok };
  });

  // ---- Recording refused by the caller (Exclusão automática) ----
  app.post(`${prefix}calls/:id/recording/delete`, async req => {
    const { tenant } = scope(req); const id = String((req.params as any).id);
    const conv = store.get(tenant, 'conversations', id); const key = typeof conv?.recordingKey === 'string' ? conv.recordingKey : '';
    if (!conv) return { ok: false };
    if (key) { const url = presignGet(key, 300, new Date(), 'DELETE'); if (url) await fetch(url, { method: 'DELETE' }).catch(() => undefined); }
    store.update(tenant, 'conversations', id, { recordingKey: null, recordingRefused: true, recordingDeletedAt: new Date().toISOString() });
    console.log('recording_deleted_on_refusal'); return { ok: true };
  });

  // ---- Post-call WhatsApp actions ----
  app.post(`${prefix}calls/:id/actions`, async req => {
    const { tenant, agentId } = scope(req); const id = String((req.params as any).id);
    const b = z.object({ phone: z.string().max(40).optional() }).strict().parse(req.body ?? {});
    return runConversationActions(store, tenant, agentId, id, b.phone);
  });
  // "A qualquer momento": a ferramenta enviar_email do agente de voz envia agora, com a transcrição até aqui.
  app.post(`${prefix}calls/:id/email`, async req => {
    const { tenant, agentId } = scope(req); const id = String((req.params as any).id);
    const b = z.object({ id: z.string().max(128).optional(), phone: z.string().max(40).optional() }).strict().parse(req.body ?? {});
    return runConversationActions(store, tenant, agentId, id, b.phone, { during: true, only: b.id });
  });
}

/** Ações pós-conversa ("Enviar e-mail" e, em ligações, "Enviar WhatsApp"). Chamado no fim da ligação e, nos chats, ao encerrar ou por inatividade. */
export async function runConversationActions(store: Store, tenant: string, agentId: string, id: string, phone?: string, opts: { during?: boolean; only?: string } = {}): Promise<{ ok: boolean; sent?: number; reason?: string }> {
    const b = { phone };
    const conv = store.get(tenant, 'conversations', id); if (!conv) return { ok: false, reason: 'conversa_nao_encontrada' };
    const isCall = String(conv.channel ?? 'phone') === 'phone';
    if (conv.actionsRunAt) return { ok: false, reason: 'ja_executado' };
    const already = new Set(Array.isArray(conv.emailsSent) ? (conv.emailsSent as string[]) : []);
    const st = editorState(store, tenant, agentId);
    const actions = isCall && !opts.during ? ((st.whatsapps ?? []) as any[]).filter(a => a && (a.timing ?? 'after') === 'after') : [];
    // "Enviar e-mail" (Recursos): ações 'after' executam aqui; 'during' também é atendida no fim da chamada (o agente de voz não tem ferramenta de e-mail).
    const emails = ((st.emails ?? []) as any[]).filter(a => a && typeof a.id === 'string' && !already.has(a.id) && (!opts.during || (a.timing === 'during' && (!opts.only || a.id === opts.only))));
    if (!actions.length && !emails.length) return { ok: true, sent: 0 };
    if (!opts.during) store.update(tenant, 'conversations', id, { actionsRunAt: new Date().toISOString() });
    else if (!emails.length) return { ok: false, reason: 'sem_email_durante' };
    if (!actions.length && emailBudget(store, tenant).used >= conversationEmailDailyLimit()) { console.log('email_action_skipped', 'limite_diario'); return { ok: true, sent: 0, reason: 'limite_diario' }; }
    const lines = store.list(tenant, 'messages').filter(m => m.conversationId === id && ['user', 'assistant'].includes(String(m.role))).map(m => `${m.role === 'user' ? 'Pessoa' : 'Assistente'}: ${String(m.content).slice(0, 500)}`);
    if (lines.length < 2) return { ok: true, sent: 0, reason: 'conversa_curta' };
    const conds = [...actions, ...emails].filter(a => a.when === 'only_if' && a.condition).map(a => ({ id: String(a.id), condition: String(a.condition).slice(0, 500) }));
    const choices = new Map<string, Set<string>>(isCall ? [] : emails.filter(a => a.recipientsMode === 'ai').map(a => [String(a.id), chatRecipientChoices(store, tenant, st, conv, a)]));
    const aiRecips = emails.filter(a => a.recipientsMode === 'ai' && a.recipientsInstruction && (isCall || choices.get(String(a.id))!.size)).map(a => ({ id: String(a.id), instrucao: String(a.recipientsInstruction).slice(0, 500), ...(isCall ? {} : { permitidos: [...choices.get(String(a.id))!].slice(0, 50) }) }));
    const aiBodies = emails.filter(a => a.messageMode === 'ai').map(a => ({ id: String(a.id), instrucao: String(a.aiInstruction || 'Resuma a ligação para a equipe.').slice(0, 800) }));
    const out = await llmJson('Responda em JSON: {"resumo": string (2-3 frases, português do Brasil, objetivo), "condicoes": {"<id>": true|false}, "destinatarios": {"<id>": [e-mails]}, "emails": {"<id>": {"assunto": string, "corpo": string}}}. Avalie cada condição só com base na transcrição. Em destinatarios, só inclua endereços de e-mail que aparecem na transcrição ou na instrução; quando o item trouxer "permitidos", escolha somente entre eles. Em emails, escreva assunto e corpo (texto simples) seguindo cada instrução.',
      `Condições: ${JSON.stringify(conds)}\nDestinatários a extrair: ${JSON.stringify(aiRecips)}\nE-mails a redigir: ${JSON.stringify(aiBodies)}\n\nTranscrição:\n${lines.join('\n').slice(-12000)}`) ?? {};
    const summary = typeof out.resumo === 'string' ? out.resumo : '';
    const caller = normalizePhone(b.phone ?? String(conv.externalContact ?? '')) ?? '';
    const when = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(String(conv.startedAt ?? conv.createdAt)));
    const verified = new Set(store.list(tenant, VERIFIED).map(v => digits(String(v.number))));
    let sent = 0;
    const windowOk = (a: any) => { const w = a.activeWindow; if (w !== 'during' && w !== 'outside') return true; const open = inHours(a.businessHours ?? st.businessHours); return (w === 'during') === open; };
    for (const a of actions) {
      if (a.when === 'only_if' && out.condicoes?.[String(a.id)] !== true) continue;
      if (!windowOk(a)) continue;
      const body = (typeof a.message === 'string' && a.message.trim() ? a.message.replace(/\{\{\s*(resumo|summary)\s*\}\}/gi, summary).replace(/\{\{\s*(telefone|phone)\s*\}\}/gi, caller) :
        `Resumo da sua chamada em ${when}\n\nNúmero de telefone: ${caller || 'desconhecido'}\nLink: https://www.kloel.ai/app/inbox?id=${id}\n\nResumo: ${summary || '(indisponível)'}\n\nDetalhes: link acima.`) + '\n\nEnviado via kloel.ai';
      const recips: { to: string; sender: string }[] = a.recipientsMode === 'caller'
        ? (caller ? [{ to: caller, sender: metaCreds(tenant) ? tenant : '' }] : [])
        : (Array.isArray(a.recipients) ? a.recipients : []).map((r: string) => normalizePhone(String(r))).filter((r: string | undefined): r is string => !!r && verified.has(digits(r))).map((to: string) => ({ to, sender: process.env.PROVIDER_TENANT_ID || '' }));
      for (const r of recips) { if (!r.sender) continue; const res = await waSend(store, r.sender, r.to, body); console.log('wa_action_sent', res.ok, res.reason ?? ''); if (res.ok) sent++; }
    }
    const agent = store.get(tenant, 'agents', agentId);
    const vars: Record<string, string> = { 'conversation.summary': summary, 'conversation.transcript': lines.join('\n'), 'conversation.link': `https://www.kloel.ai/app/inbox?id=${id}`, 'caller.phoneNumber': caller, 'agent.name': String(agent?.name ?? ''), 'company.name': companyName(store, tenant), 'call.duration': duration(conv), 'call.date': when, 'contact.firstName': '' };
    for (const a of emails) {
      if (a.when === 'only_if' && out.condicoes?.[String(a.id)] !== true) continue;
      if (!windowOk(a)) continue;
      const to = (a.recipientsMode === 'ai' ? (out.destinatarios?.[String(a.id)] ?? []) : (a.recipients ?? [])).map((x: unknown) => String(x).trim().toLowerCase()).filter((x: string) => EMAIL_RE.test(x) && (a.recipientsMode !== 'ai' || isCall || !!choices.get(String(a.id))?.has(x))).slice(0, 10);
      if (!to.length) { console.log('email_action_skipped', 'sem_destinatario'); continue; }
      if (!reserveEmails(store, tenant, to.length)) { console.log('email_action_skipped', 'limite_diario'); continue; }
      const drafted = a.messageMode === 'ai' ? out.emails?.[String(a.id)] : undefined;
      const subject = (drafted?.assunto ? String(drafted.assunto) : renderText(String(a.subject || 'Resumo da ligação — {{conversation.summary}}'), vars)).replace(/\s+/g, ' ').slice(0, 200) || 'Resumo da ligação';
      const text = drafted?.corpo ? String(drafted.corpo) : htmlToText(renderHtmlVars(String(a.body || ''), vars)) || `Resumo: ${summary || '(indisponível)'}\nLink: ${vars['conversation.link']}`;
      const fromName = String(a.fromName || agent?.name || 'Kloel').replace(/[<>"\r\n]/g, '').slice(0, 60);
      const ok = await sendEmailAs(`${fromName} via Kloel <noreply@kloel.ai>`, to, subject, `${text}\n\n—\nEnviado via kloel.ai`, `call-email-${id}-${a.id}`);
      console.log('email_action_sent', ok); if (ok) { sent++; already.add(a.id); store.update(tenant, 'conversations', id, { emailsSent: [...already] }); }
    }
    return { ok: true, sent };
}
export type { Entity };
