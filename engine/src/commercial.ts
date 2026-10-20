import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Entity, Store } from './store.js';
import { DomainError } from './domains.js';
import { seal, unseal } from './oauth/crypto.js';
import { deliver, integrationUrl, type IntegrationTransport } from './integrations/transport.js';
import { requireRequestPermission } from './memberships/access.js';
import { MembershipError, resolveMembershipActor } from './memberships/service.js';
import { metaCreds } from './meta-tenants.js';

const COLLECTION = 'commercial-profiles';
const EVENTS = 'commercial-events';
const secretContext = (tenantId: string, id: string) => `${tenantId}:${id}:commercial`;
type Secrets = { secret?: string; username?: string; clientId?: string; tokenUrl?: string; pagarmeSecret?: string; inboundSecret: string };
const actionSchema = z.object({
  name: z.string().trim().min(1).max(80), method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('POST'), path: z.string().trim().min(1).max(300),
  description: z.string().max(500).default(''), confirm: z.boolean().default(false), confirmLabel: z.string().max(20).optional(), sourceLine: z.string().max(600).optional(),
}).strict();
const rulesSchema = z.object({
  maxDiscountPercent: z.number().min(0).max(100).default(0),
  tiers: z.array(z.object({ days: z.number().int().min(0).max(3650), percent: z.number().min(0).max(100) }).strict()).max(12).default([]),
  gifts: z.string().max(500).default(''), returnPolicy: z.string().max(1000).default(''),
  contactFrom: z.string().regex(/^\d{2}:\d{2}$/).default('09:00'), contactTo: z.string().regex(/^\d{2}:\d{2}$/).default('18:00'),
  timezone: z.string().min(1).max(80).default('America/Sao_Paulo'), cadencePerDay: z.number().int().min(0).max(5).default(1),
  maxAttempts: z.number().int().min(1).max(30).default(5), offers: z.string().max(500).default(''), autoContact: z.boolean().default(false),
  fieldMap: z.record(z.string().max(120)).default({}),
}).strict();
const inputSchema = z.object({
  platformName: z.string().trim().min(1).max(80), baseUrl: z.string().trim().max(300),
  authType: z.enum(['api_key', 'bearer', 'basic', 'oauth2']), apiKeyHeader: z.string().trim().max(80).optional(),
  secret: z.string().max(2000).optional(), username: z.string().max(200).optional(), tokenUrl: z.string().max(300).optional(), clientId: z.string().max(200).optional(),
  actions: z.array(actionSchema).max(12).default([]), rules: rulesSchema.optional(),
  pagarme: z.object({ accountId: z.string().max(80).default(''), mode: z.enum(['test', 'live']).default('test'), secretKey: z.string().max(400).optional() }).strict().optional(),
  rotateInboundSecret: z.boolean().optional(),
}).strict();

const CARD_KEY = /pan|card.?number|cvv|cvc|security.?code|numero.?do.?cartao|número.?do.?cartão/i;
function luhn(digits: string) {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) { let n = digits.charCodeAt(i) - 48; if (n < 0 || n > 9) return false; if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; }
  return sum % 10 === 0;
}
/** Full card numbers and CVV never enter logs, transcripts or the database. Card charges use a payment link. */
export function rejectCardData(value: unknown): void {
  const walk = (current: unknown, key = ''): void => {
    if (CARD_KEY.test(key)) throw new DomainError(422, 'card_data_refused', 'Não envie número de cartão nem CVV. Envie um link de pagamento.');
    if (typeof current === 'string') {
      const digits = current.replace(/\D/g, '');
      if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) throw new DomainError(422, 'card_data_refused', 'Não envie número de cartão nem CVV. Envie um link de pagamento.');
    } else if (Array.isArray(current)) current.forEach(item => walk(item, key));
    else if (current && typeof current === 'object') for (const [child, next] of Object.entries(current)) walk(next, child);
  };
  walk(value);
}

function profileOf(store: Store, tenantId: string, agentId: string) {
  return store.list(tenantId, COLLECTION).find(row => row.agentId === agentId);
}
function openSecrets(row: Entity): Secrets {
  try { return unseal<Secrets>(String(row.encryptedSecrets), secretContext(String(row.tenantId), String(row.id))); }
  catch { throw new DomainError(503, 'commercial_storage_unavailable', 'Chave de proteção das integrações indisponível.'); }
}
function rulesOf(row: Entity) { return rulesSchema.parse(row.rules ?? {}); }
export function commercialSummary(store: Store, tenantId: string, agentId: string) {
  const row = profileOf(store, tenantId, agentId);
  if (!row) return { enabled: false, actions: [] as { name: string; description: string }[], rules: '' };
  const rules = rulesOf(row);
  const actions = (Array.isArray(row.actions) ? row.actions : []) as { name?: string; description?: string }[];
  return { enabled: true, platform: row.platformName, actions: actions.map(action => ({ name: String(action.name ?? ''), description: String(action.description ?? '') })), rules: `Desconto máximo ${rules.maxDiscountPercent}%. ${rules.offers} Política: ${rules.returnPolicy}`.trim() };
}
export function publicProfile(row: Entity) {
  const rules = rulesOf(row);
  let secrets: Secrets | undefined;
  try { secrets = openSecrets(row); } catch { secrets = undefined; }
  return {
    id: row.id, agentId: row.agentId, platformName: row.platformName, baseUrl: row.baseUrl, authType: row.authType, apiKeyHeader: row.apiKeyHeader ?? 'X-Api-Key',
    actions: row.actions ?? [], rules, secretConfigured: !!secrets?.secret, lastTest: row.lastTest ?? null, pagarme: { accountId: (row.pagarme as { accountId?: string } | undefined)?.accountId ?? '', mode: (row.pagarme as { mode?: string } | undefined)?.mode ?? 'test', configured: !!secrets?.pagarmeSecret },
    inboundPath: `/api/v1/commercial/inbound/${row.tenantId}/${row.agentId}`, inboundConfigured: !!secrets?.inboundSecret,
  };
}

function authHeaders(profile: Entity, secrets: Secrets, token?: string): Record<string, string> {
  if (profile.authType === 'api_key' && secrets.secret) return { [String(profile.apiKeyHeader || 'x-api-key').toLowerCase()]: secrets.secret };
  if (profile.authType === 'bearer' && secrets.secret) return { authorization: `Bearer ${secrets.secret}` };
  if (profile.authType === 'basic' && secrets.secret) return { authorization: `Basic ${Buffer.from(`${secrets.username ?? ''}:${secrets.secret}`).toString('base64')}` };
  if (profile.authType === 'oauth2' && token) return { authorization: `Bearer ${token}` };
  return {};
}
async function oauthToken(secrets: Secrets, transport?: IntegrationTransport) {
  if (!secrets.tokenUrl || !secrets.clientId || !secrets.secret) throw new DomainError(422, 'oauth_incomplete', 'Informe a URL do token, o client id e o segredo.');
  const body = Buffer.from(new URLSearchParams({ grant_type: 'client_credentials', client_id: secrets.clientId, client_secret: secrets.secret }).toString());
  const sent = await deliver(secrets.tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }, 8000, transport);
  if (sent.response.status < 200 || sent.response.status >= 300) throw new DomainError(502, 'oauth_failed', 'O provedor não emitiu o token.');
  const parsed = JSON.parse(sent.response.body.toString('utf8')) as { access_token?: string };
  if (!parsed.access_token) throw new DomainError(502, 'oauth_failed', 'O provedor não emitiu o token.');
  return parsed.access_token;
}

function discountCap(rules: z.infer<typeof rulesSchema>, days: number) {
  const tier = [...rules.tiers].sort((a, b) => b.days - a.days).find(item => days >= item.days);
  return tier ? Math.min(rules.maxDiscountPercent, tier.percent) : rules.maxDiscountPercent;
}
function assertDiscount(rules: z.infer<typeof rulesSchema>, args: Record<string, unknown>) {
  if (args.discountPercent === undefined) return;
  const percent = Number(args.discountPercent);
  if (!Number.isFinite(percent) || percent < 0) throw new DomainError(422, 'invalid_discount', 'Informe um desconto válido.');
  const cap = discountCap(rules, Number(args.daysOverdue ?? 0) || 0);
  if (percent > cap) throw new DomainError(422, 'discount_above_policy', `O desconto de ${percent}% passa do limite de ${cap}% para esta situação.`);
}

const tokens = new WeakMap<Store, Map<string, { token: string; at: number }>>();
export async function executeCommercial(store: Store, tenantId: string, agentId: string, action: string, args: Record<string, unknown>, options: { transport?: IntegrationTransport; fetch?: typeof fetch } = {}) {
  rejectCardData(args);
  const row = profileOf(store, tenantId, agentId);
  if (!row) return { ok: false, error: 'commercial_not_configured' };
  const rules = rulesOf(row);
  const secrets = openSecrets(row);
  const record = (kind: string, summary: string, extra: Record<string, unknown> = {}) => store.create(tenantId, EVENTS, { agentId, kind, summary: summary.slice(0, 500), at: new Date().toISOString(), ...extra });
  if (action === 'comercial_fila') {
    const due = store.list(tenantId, EVENTS).filter(event => event.agentId === agentId && ['checkout_abandoned', 'payment_overdue', 'order_created'].includes(String(event.kind)) && event.status !== 'closed').slice(-20);
    return { ok: true, items: due.map(event => ({ id: event.id, kind: event.kind, summary: event.summary, phone: event.phone ?? null, attempts: event.attempts ?? 0 })) };
  }
  if (action === 'comercial_registrar') {
    const summary = String(args.summary ?? '').slice(0, 500);
    if (!summary) throw new DomainError(422, 'summary_required', 'Descreva o que aconteceu.');
    const saved = record('activity', summary, { phone: typeof args.phone === 'string' ? args.phone.slice(0, 20) : null, orderId: typeof args.orderId === 'string' ? args.orderId.slice(0, 80) : null });
    return { ok: true, id: saved.id };
  }
  if (action === 'comercial_pix' || action === 'comercial_boleto' || action === 'comercial_link') return charge(row, secrets, action, args, rules, options.fetch ?? globalThis.fetch, record);
  if (action === 'comercial_whatsapp') {
    const text = String(args.text ?? '').slice(0, 1000);
    const phone = String(args.phone ?? '');
    if (!text || !/^\+[1-9]\d{7,14}$/.test(phone)) throw new DomainError(422, 'whatsapp_invalid', 'Informe o texto e o telefone em E.164.');
    const sent = await sendWhatsApp(tenantId, phone, text, options.fetch ?? globalThis.fetch);
    record('whatsapp', text, { phone, ok: sent.ok });
    return sent;
  }
  const actions = (Array.isArray(row.actions) ? row.actions : []) as { name: string; method: string; path: string; description?: string; confirm?: boolean }[];
  const selected = actions.find(item => item.name === action || item.name === String(args.acao ?? ''));
  if (!selected) return { ok: false, error: 'action_not_found' };
  if (selected.confirm && args.confirmed !== true) return { ok: false, error: 'confirmation_required', message: 'Confirme com a pessoa antes de executar esta ação.' };
  assertDiscount(rules, args);
  let token: string | undefined;
  if (row.authType === 'oauth2') {
    const cache = tokens.get(store) ?? new Map(); tokens.set(store, cache);
    const hit = cache.get(String(row.id));
    token = hit && Date.now() - hit.at < 240000 ? hit.token : await oauthToken(secrets, options.transport);
    cache.set(String(row.id), { token, at: Date.now() });
  }
  const url = new URL(selected.path.replace(/^\//, ''), String(row.baseUrl).endsWith('/') ? String(row.baseUrl) : `${row.baseUrl}/`);
  const method = selected.method || 'POST';
  const payload = { ...args }; delete payload.confirmed; delete payload.acao; delete payload.discountPercent; delete payload.daysOverdue;
  const body = ['GET', 'HEAD'].includes(method) ? undefined : Buffer.from(JSON.stringify(payload));
  const sent = await deliver(url.href, { method, headers: { ...authHeaders(row, secrets, token), ...(body ? { 'content-type': 'application/json' } : {}) }, body }, 10000, options.transport);
  const ok = sent.response.status >= 200 && sent.response.status < 300;
  const text = sent.response.body.toString('utf8').slice(0, 4000);
  record('platform', `${selected.name} HTTP ${sent.response.status}`, { orderId: typeof args.orderId === 'string' ? args.orderId.slice(0, 80) : null });
  return { ok, status: sent.response.status, body: text };
}

async function charge(row: Entity, secrets: Secrets, action: string, args: Record<string, unknown>, rules: z.infer<typeof rulesSchema>, call: typeof fetch, record: (kind: string, summary: string, extra?: Record<string, unknown>) => Entity) {
  assertDiscount(rules, args);
  if (!secrets.pagarmeSecret) return { ok: false, error: 'pagarme_not_configured' };
  const amount = Number(args.amountCents);
  if (!Number.isInteger(amount) || amount < 100 || amount > 100_000_000) throw new DomainError(422, 'invalid_amount', 'Informe o valor em centavos.');
  const name = String(args.customerName ?? 'Cliente').slice(0, 80);
  const description = String(args.description ?? 'Pedido').slice(0, 120);
  const auth = `Basic ${Buffer.from(`${secrets.pagarmeSecret}:`).toString('base64')}`;
  const pagarme = row.pagarme as { accountId?: string; mode?: string } | undefined;
  if (action === 'comercial_link') {
    const response = await call('https://api.pagar.me/core/v5/paymentlinks', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'order', name: description, payment_settings: { accepted_payment_methods: ['credit_card'], credit_card_settings: { operation_type: 'auth_and_capture' } }, cart_settings: { items: [{ amount, name: description, default_quantity: 1 }] }, metadata: { accountId: pagarme?.accountId ?? '', mode: pagarme?.mode ?? 'test' } }) });
    const data = await response.json().catch(() => ({})) as { url?: string; id?: string };
    if (!response.ok || !data.url) return { ok: false, error: 'pagarme_failed', status: response.status };
    record('payment_link', `Link de cartão ${description}`, { amountCents: amount });
    return { ok: true, url: data.url, id: data.id ?? null, note: 'O cartão é digitado na página da Pagar.me. A Kloel não recebe o número nem o CVV.' };
  }
  const method = action === 'comercial_pix' ? 'pix' : 'boleto';
  const response = await call('https://api.pagar.me/core/v5/orders', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ amount, description, quantity: 1, code: 'item' }], customer: { name, type: 'individual', document: String(args.document ?? '').replace(/\D/g, '').slice(0, 14) || undefined, phones: args.phone ? { mobile_phone: { country_code: '55', area_code: '11', number: String(args.phone).replace(/\D/g, '').slice(-9) } } : undefined }, payments: [{ payment_method: method, ...(method === 'pix' ? { pix: { expires_in: 3600 } } : { boleto: { instructions: description } }) }] }) });
  const data = await response.json().catch(() => ({})) as { id?: string; charges?: { last_transaction?: { qr_code?: string; url?: string; line?: string; pdf?: string } }[] };
  if (!response.ok) return { ok: false, error: 'pagarme_failed', status: response.status };
  const transaction = data.charges?.[0]?.last_transaction ?? {};
  record(method, `${method} ${description}`, { amountCents: amount });
  return { ok: true, id: data.id ?? null, pix: transaction.qr_code ?? null, boletoUrl: transaction.url ?? transaction.pdf ?? null, line: transaction.line ?? null };
}

async function sendWhatsApp(tenantId: string, phone: string, text: string, call: typeof fetch) {
  const creds = metaCreds(tenantId);
  if (!creds?.token || !creds.phoneId) return { ok: false, error: 'whatsapp_not_configured', text };
  const response = await call(`https://graph.facebook.com/${creds.version || process.env.META_GRAPH_VERSION || 'v21.0'}/${creds.phoneId}/messages`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to: phone.slice(1), type: 'text', text: { body: text } }) });
  return response.ok ? { ok: true } : { ok: false, error: 'whatsapp_failed', status: response.status, text };
}

function withinHours(rules: z.infer<typeof rulesSchema>, now: number) {
  try {
    const local = new Intl.DateTimeFormat('en-GB', { timeZone: rules.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(now));
    return local >= rules.contactFrom && local < rules.contactTo;
  } catch { return false; }
}

/** Marks customers who should be contacted. Sends WhatsApp only when the profile opted in and the channel is configured. */
export async function runCommercialCadence(store: Store, now = Date.now(), options: { fetch?: typeof fetch } = {}) {
  let queued = 0, sent = 0;
  const tenants = new Set<string>();
  const known = store.db.prepare(`SELECT DISTINCT tenant_id FROM entities WHERE collection=?`).all(COLLECTION) as { tenant_id: string | null }[];
  for (const item of known) if (item.tenant_id) tenants.add(item.tenant_id);
  for (const tenantId of tenants) {
    for (const row of store.list(tenantId, COLLECTION)) {
      const rules = rulesOf(row);
      if (!rules.autoContact || !withinHours(rules, now)) continue;
      const events = store.list(tenantId, EVENTS).filter(event => event.agentId === row.agentId && ['checkout_abandoned', 'payment_overdue', 'order_created'].includes(String(event.kind)) && event.status !== 'closed');
      for (const event of events) {
        const attempts = Number(event.attempts ?? 0);
        const last = Date.parse(String(event.lastContactAt ?? 0));
        if (attempts >= rules.maxAttempts || (Number.isFinite(last) && now - last < 20 * 3600 * 1000)) continue;
        const phone = typeof event.phone === 'string' ? event.phone : '';
        const summary = `Contato ${attempts + 1}: ${event.summary ?? event.kind}`;
        store.update(tenantId, EVENTS, String(event.id), { attempts: attempts + 1, lastContactAt: new Date(now).toISOString() });
        store.create(tenantId, EVENTS, { agentId: row.agentId, kind: 'outreach_due', summary, phone, at: new Date(now).toISOString(), parentId: event.id });
        queued++;
        if (phone) {
          const result = await sendWhatsApp(tenantId, phone, summary, options.fetch ?? globalThis.fetch);
          if (result.ok) sent++;
        }
      }
    }
  }
  return { queued, sent };
}

const inboundSchema = z.object({
  event: z.enum(['checkout_abandoned', 'order_created', 'order_paid', 'shipped', 'payment_overdue']),
  phone: z.string().max(20).optional(), name: z.string().max(120).optional(), orderId: z.string().max(80).optional(),
  amountCents: z.number().int().min(0).max(100_000_000).optional(), status: z.string().max(40).optional(), summary: z.string().max(500).optional(),
}).strict();

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function commercialAgentTools(store: Store, tenantId: string, agentId: string) {
  const summary = commercialSummary(store, tenantId, agentId);
  if (!summary.enabled) return [];
  const names = ['comercial_fila', 'comercial_registrar', 'comercial_pix', 'comercial_boleto', 'comercial_link', 'comercial_whatsapp', ...summary.actions.map(action => action.name)];
  return [{
    type: 'function' as const, name: 'comercial_acao', strict: false,
    description: `Ações da plataforma ${summary.platform}. ${summary.rules} Ações: ${names.join(', ')}. Nunca peça número de cartão ou CVV; use comercial_link e envie o link no WhatsApp. Confirme com a pessoa antes de ações marcadas.`,
    parameters: { type: 'object', properties: { acao: { type: 'string', enum: names }, argumentos: { type: 'object', additionalProperties: true } }, required: ['acao'], additionalProperties: false },
  }];
}

export async function executeCommercialTool(store: Store, tenantId: string, agentId: string, args: { acao?: string; argumentos?: Record<string, unknown> }, options: { transport?: IntegrationTransport; fetch?: typeof fetch } = {}) {
  const action = String(args.acao ?? '');
  const payload = args.argumentos && typeof args.argumentos === 'object' ? args.argumentos : {};
  return executeCommercial(store, tenantId, agentId, action, payload, options);
}

function saveProfile(store: Store, tenantId: string, agentId: string, userId: string, input: z.infer<typeof inputSchema>) {
  integrationUrl(input.baseUrl);
  if (!store.get(tenantId, 'agents', agentId)) throw new DomainError(404, 'agent_not_found', 'Assistente não encontrado.');
  const existing = profileOf(store, tenantId, agentId);
  const previous = existing ? openSecrets(existing) : undefined;
  const inboundSecret = input.rotateInboundSecret || !previous ? randomBytes(24).toString('hex') : previous.inboundSecret;
  const secrets: Secrets = {
    secret: input.secret?.trim() || previous?.secret, username: input.username ?? previous?.username, clientId: input.clientId ?? previous?.clientId,
    tokenUrl: input.tokenUrl ?? previous?.tokenUrl, pagarmeSecret: input.pagarme?.secretKey?.trim() || previous?.pagarmeSecret, inboundSecret,
  };
  if (!secrets.secret && input.authType !== 'api_key') { /* api key may be added later; oauth and bearer need a secret on first save */ }
  if (!existing && !secrets.secret) throw new DomainError(422, 'secret_required', 'Informe a credencial da plataforma.');
  const record = { agentId, platformName: input.platformName, baseUrl: input.baseUrl, authType: input.authType, apiKeyHeader: input.apiKeyHeader || 'X-Api-Key', actions: input.actions, rules: rulesSchema.parse(input.rules ?? {}), lastTest: existing?.lastTest ?? null, pagarme: { accountId: input.pagarme?.accountId ?? (existing?.pagarme as { accountId?: string } | undefined)?.accountId ?? '', mode: input.pagarme?.mode ?? (existing?.pagarme as { mode?: string } | undefined)?.mode ?? 'test' }, configuredBy: userId };
  return store.transaction(() => {
    const row = existing ? store.update(tenantId, COLLECTION, String(existing.id), record)! : store.create(tenantId, COLLECTION, { ...record, encryptedSecrets: '' });
    let encrypted: string;
    try { encrypted = seal(secrets, secretContext(tenantId, String(row.id))); }
    catch { throw new DomainError(503, 'commercial_storage_unavailable', 'Chave de proteção das integrações indisponível.'); }
    return store.update(tenantId, COLLECTION, String(row.id), { encryptedSecrets: encrypted })!;
  });
}

function wrapper(fn: (request: FastifyRequest, reply: FastifyReply) => unknown) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try { return await fn(request, reply); }
    catch (error) {
      if (error instanceof DomainError || error instanceof MembershipError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      if (error instanceof z.ZodError) return reply.code(400).send({ error: { code: 'validation_error', message: 'Dados inválidos.' } });
      throw error;
    }
  };
}

export async function registerCommercial(app: FastifyInstance, store: Store, transport?: IntegrationTransport): Promise<void> {
  app.get('/api/v1/agents/:id/commercial', wrapper(async request => {
    const actor = requireRequestPermission(store, request, 'integrations:manage');
    const row = profileOf(store, actor.tenantId, String((request.params as { id: string }).id));
    if (!row) return { configured: false };
    return { configured: true, profile: publicProfile(row) };
  }));
  app.put('/api/v1/agents/:id/commercial', wrapper(async request => {
    const actor = requireRequestPermission(store, request, 'integrations:manage');
    const agentId = String((request.params as { id: string }).id);
    const parsed = inputSchema.parse(request.body);
    const first = !profileOf(store, actor.tenantId, agentId);
    const saved = saveProfile(store, actor.tenantId, agentId, actor.userId, parsed);
    return { profile: publicProfile(saved), ...(first || parsed.rotateInboundSecret ? { inboundSecret: openSecrets(saved).inboundSecret } : {}) };
  }));
  app.post('/api/v1/agents/:id/commercial/test', wrapper(async request => {
    const actor = requireRequestPermission(store, request, 'integrations:manage');
    const row = profileOf(store, actor.tenantId, String((request.params as { id: string }).id));
    if (!row) throw new DomainError(404, 'commercial_not_configured', 'Salve a integração antes de testar.');
    const secrets = openSecrets(row);
    const token = row.authType === 'oauth2' ? await oauthToken(secrets) : undefined;
    const sent = await deliver(String(row.baseUrl), { method: 'GET', headers: authHeaders(row, secrets, token) }, 8000, transport);
    const ok = sent.response.status >= 200 && sent.response.status < 400;
    const lastTest = { at: new Date().toISOString(), ok, status: sent.response.status, detail: `HTTP ${sent.response.status}` };
    const saved = store.update(actor.tenantId, COLLECTION, String(row.id), { lastTest });
    return { ok, status: sent.response.status, at: lastTest.at, detail: lastTest.detail, profile: saved ? publicProfile(saved) : publicProfile(row) };
  }));
  app.delete('/api/v1/agents/:id/commercial', wrapper(async request => {
    const actor = requireRequestPermission(store, request, 'integrations:manage');
    const row = profileOf(store, actor.tenantId, String((request.params as { id: string }).id));
    if (row) store.remove(actor.tenantId, COLLECTION, String(row.id));
    return { ok: true };
  }));
  await app.register(async scope => {
    scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
      (req as FastifyRequest & { rawBody?: Buffer }).rawBody = body as Buffer;
      try { done(null, JSON.parse((body as Buffer).toString('utf8') || '{}')); }
      catch (error) { done(error as Error, undefined); }
    });
    scope.post('/api/v1/commercial/inbound/:tenantId/:agentId', async (request, reply) => {
      const { tenantId, agentId } = request.params as { tenantId: string; agentId: string };
      const row = profileOf(store, tenantId, agentId);
      if (!row) return reply.code(404).send({ error: { code: 'not_found', message: 'Integração não encontrada.' } });
      const raw = (request as FastifyRequest & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(request.body ?? {}));
      let secrets: Secrets;
      try { secrets = openSecrets(row); } catch { return reply.code(503).send({ error: { code: 'commercial_storage_unavailable', message: 'Segredo indisponível.' } }); }
      const expected = `v1=${createHmac('sha256', secrets.inboundSecret).update(raw).digest('hex')}`;
      const got = String(request.headers['x-kloel-signature'] ?? '');
      if (!safeEqual(expected, got)) return reply.code(401).send({ error: { code: 'invalid_signature', message: 'Assinatura inválida.' } });
      try { rejectCardData(request.body); } catch (error) { if (error instanceof DomainError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } }); throw error; }
      const event = inboundSchema.parse(request.body);
      const saved = store.create(tenantId, EVENTS, { agentId, kind: event.event, summary: event.summary || event.event, phone: event.phone ?? null, name: event.name ?? null, orderId: event.orderId ?? null, amountCents: event.amountCents ?? null, status: event.event === 'order_paid' || event.event === 'shipped' ? 'closed' : 'open', at: new Date().toISOString(), attempts: 0 });
      return reply.code(202).send({ ok: true, id: saved.id });
    });
  });
  const timer = setInterval(() => { void runCommercialCadence(store).catch(() => undefined); }, 60 * 60 * 1000);
  timer.unref?.();
  app.addHook('onClose', async () => clearInterval(timer));
}

export function commercialServiceActor(store: Store, tenantId: string, userId: string) {
  return userId ? resolveMembershipActor(store, userId, tenantId) : undefined;
}
