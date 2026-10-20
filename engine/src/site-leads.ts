import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Store } from './store.js';

/**
 * Public site forms (Contato/Imprensa, Parceiros, Carreiras, pedido de integração) and the app's Scale proposal/sales request: every submission is stored first and then
 * e-mailed to the Kloel team through Resend (reply-to = the sender). A delivery failure never loses the lead.
 */
export const SITE_LEADS_PATH = '/api/v1/public/leads';
/** 'sales': pedido de proposta / falar com vendas do plano Scale no app, com a configuração escolhida no contexto. */
const KIND_LABEL = { contact: 'Contato', partner: 'Parceiros', career: 'Candidatura', newsletter: 'Newsletter', callback: 'Retorno', webchat_trial: 'Webchat', sales: 'Vendas' } as const;
const text = (max: number) => z.string().trim().max(max);
const leadSchema = z.object({
  kind: z.enum(Object.keys(KIND_LABEL) as [keyof typeof KIND_LABEL, ...(keyof typeof KIND_LABEL)[]]),
  title: text(200).default(''),
  page: text(300).default(''),
  context: z.record(text(60), text(300)).refine(o => Object.keys(o).length <= 10).default({}),
  fields: z.record(text(60), text(4000)).refine(o => Object.keys(o).length >= 1 && Object.keys(o).length <= 20 && Object.values(o).some(Boolean)),
  consent: z.boolean().default(false),
  /** Honeypot: humans never fill it. */
  website: z.string().max(200).optional(),
}).strict();
type Lead = z.infer<typeof leadSchema>;
export type LeadMailOptions = { fetchImpl?: typeof fetch };

const leadTenant = () => process.env.PROVIDER_TENANT_ID?.trim() || 'kloel-site';
const senderEmail = (fields: Record<string, string>) => Object.entries(fields).find(([k, v]) => /e-?mail/i.test(k) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))?.[1];

export async function sendLeadMail(lead: Lead, id: string, options: LeadMailOptions = {}): Promise<'accepted' | 'rejected' | 'not_configured' | 'failed'> {
  const key = process.env.RESEND_API_KEY, from = process.env.RESEND_FROM, to = (process.env.SITE_LEADS_TO || 'contato@kloel.ai').split(',').map(s => s.trim()).filter(Boolean);
  if (!key || !from || !to.length) return 'not_configured';
  const replyTo = senderEmail(lead.fields), name = Object.entries(lead.fields).find(([k]) => /nome|name/i.test(k))?.[1];
  const lines = [`Formulário: ${KIND_LABEL[lead.kind]}${lead.title ? ` — ${lead.title}` : ''}`, lead.page ? `Página: ${lead.page}` : '',
    ...Object.entries(lead.context).map(([k, v]) => `${k}: ${v}`), '', ...Object.entries(lead.fields).map(([k, v]) => `${k}: ${v}`),
    '', `Consentimento LGPD: ${lead.consent ? 'sim' : 'não informado'}`, `Lead: ${id}`].filter((l, i, a) => l || a[i - 1]);
  try {
    const response = await (options.fetchImpl ?? fetch)('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': `site-lead-${id}` },
      body: JSON.stringify({ from, to, subject: `[Site Kloel] ${KIND_LABEL[lead.kind]}${name ? ` — ${name.slice(0, 80)}` : ''}`, text: lines.join('\n'), ...(replyTo ? { reply_to: replyTo } : {}) }),
      redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    await response.body?.cancel().catch(() => undefined);
    return response.ok ? 'accepted' : response.status >= 400 && response.status < 500 ? 'rejected' : 'failed';
  } catch { return 'failed'; }
}

export async function registerSiteLeads(app: FastifyInstance, store: Store, options: LeadMailOptions = {}) {
  app.post(SITE_LEADS_PATH, { config: { rateLimit: { max: 8, timeWindow: '10 minutes' } } }, async (request, reply) => {
    const lead = leadSchema.parse(request.body);
    // A filled honeypot gets the same answer as a real lead, without storing or sending anything.
    if (lead.website) return reply.code(202).send({ status: 'received' });
    const ipHash = createHash('sha256').update(`site-lead:${request.ip}`).digest('hex').slice(0, 16);
    const row = store.create(leadTenant(), 'site-leads', { ...lead, website: undefined, ipHash, delivery: 'pending', createdAt: new Date().toISOString() });
    const delivery = await sendLeadMail(lead, row.id, options);
    store.update(leadTenant(), 'site-leads', row.id, { delivery });
    if (delivery !== 'accepted') console.warn('site_lead_delivery', delivery, row.id);
    return reply.code(202).send({ status: 'received', id: row.id });
  });
}
