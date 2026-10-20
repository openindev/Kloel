import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Entity, Store } from './store.js';
import { requireRequestPermission } from './memberships/access.js';
import { MembershipError } from './memberships/service.js';
import { allowedChatOrigin } from './conversation-replies-shared.js';
import { PUBLIC_CHAT_PATHS } from './public-chat.js';

/**
 * "Personalizar" do Chatbot de IA (Fonio WC-14): identidade (foto padrão ou enviada, borda, nome de exibição), entrada de mensagem
 * (anexos) e tema/cores, por assistente. O widget do site e o link hospedado leem a MESMA aparência pelo canal de webchat do assistente.
 * A foto enviada fica em coleção própria (bytes conferidos: PNG/JPEG/WebP quadrado de 128 a 1024 px, até 1 MB) e é servida num endereço
 * com o hash do conteúdo. Anexos do visitante (quando permitidos) ficam guardados para a equipe; a conversa recebe só a referência.
 */
export const APPEARANCES = 'webchat-appearances';
const AVATARS = 'webchat-avatars', ATTACHMENTS = 'webchat-attachments', AUDIT = 'webchat-appearance-audit';
export const WEBCHAT_AVATAR_PATH = '/api/v1/public/webchat/avatar';
export const WEBCHAT_APPEARANCE_PUBLIC_PATH = '/api/v1/public/webchat/appearance';
export const WEBCHAT_ATTACHMENTS_PATH = '/api/v1/public/webchat/attachments';
// Registro dos caminhos públicos: a checagem de Origin do app e a normalização do link hospedado tratam o upload como o chat público.
PUBLIC_CHAT_PATHS.add(WEBCHAT_ATTACHMENTS_PATH);
export const DEFAULT_LOOK = { avatar: 'feminino', avatarBorder: false, displayName: '', attachments: true, theme: 'light', accent: '#585dfe', accentMode: 'buttons' } as const;
const AVATAR_MAX = 1024 * 1024, ATTACHMENT_MAX = 2 * 1024 * 1024, ATTACHMENTS_PER_SESSION = 5, ATTACHMENTS_PER_DAY = 20, ATTACHMENT_DAYS = 90;
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const lookSchema = z.object({
  avatar: z.enum(['feminino', 'masculino', 'upload']), avatarBorder: z.boolean(),
  displayName: z.string().trim().max(60).refine(v => !/[\u0000-\u001f\u007f]/.test(v)), attachments: z.boolean(),
  theme: z.enum(['light', 'dark']), accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).transform(v => v.toLowerCase()), accentMode: z.enum(['buttons', 'header']),
}).strict();
export type Look = z.infer<typeof lookSchema>;
const putSchema = z.object({ expectedTenantId: identifier, agentId: identifier, expectedRevision: z.number().int().min(0), appearance: lookSchema,
  avatarUpload: z.object({ dataUrl: z.string().max(1_500_000) }).strict().nullable().optional() }).strict();
type Data = Record<string, any>;
class Fault extends Error { constructor(readonly status: number, readonly code: string, message: string) { super(message); } }
const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

/** Tipo e dimensões lidos dos próprios bytes (não confia na extensão nem no tipo declarado). */
export function imageInfo(bytes: Buffer): { type: string; width: number; height: number } | undefined {
  if (bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47 && bytes.toString('ascii', 12, 16) === 'IHDR') return { type: 'image/png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (bytes.length > 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = bytes.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { type: 'image/webp', width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
    if (chunk === 'VP8L' && bytes[20] === 0x2f) { const b = bytes.readUInt32LE(21); return { type: 'image/webp', width: (b & 0x3fff) + 1, height: ((b >>> 14) & 0x3fff) + 1 }; }
    if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return { type: 'image/webp', width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    return undefined;
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let i = 2; i + 9 < bytes.length;) {
      if (bytes[i] !== 0xff) return undefined;
      const marker = bytes[i + 1];
      if (marker === 0xff) { i++; continue; }
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd8) { i += 2; continue; }
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { type: 'image/jpeg', height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
      i += 2 + bytes.readUInt16BE(i + 2);
    }
  }
  return undefined;
}
function avatarFrom(dataUrl: string) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new Fault(400, 'avatar_invalid', 'Use uma imagem PNG, JPEG ou WebP.');
  const bytes = Buffer.from(match[2], 'base64'), info = imageInfo(bytes);
  if (bytes.length > AVATAR_MAX) throw new Fault(400, 'avatar_too_large', 'A imagem pode ter no máximo 1 MB.');
  if (!info || info.type !== match[1]) throw new Fault(400, 'avatar_invalid', 'Use uma imagem PNG, JPEG ou WebP.');
  if (info.width !== info.height) throw new Fault(400, 'avatar_not_square', 'A imagem precisa ser quadrada.');
  if (info.width < 128 || info.width > 1024) throw new Fault(400, 'avatar_size', 'Use uma imagem entre 128 e 1024 px.');
  return { contentType: info.type, data: bytes.toString('base64'), hash: sha(bytes).slice(0, 32), size: bytes.length };
}

const lookRow = (store: Store, tenant: string, agentId: string) => store.list(tenant, APPEARANCES).find(r => r.agentId === agentId);
const avatarRow = (store: Store, tenant: string, agentId: string) => store.list(tenant, AVATARS).find(r => r.agentId === agentId);
/** Aparência gravada (ou o padrão da Fonio); só valores válidos chegam ao widget. */
export function lookOf(store: Store, tenant: string, agentId: string): Look & { avatarHash: string | null; revision: number } {
  const row = lookRow(store, tenant, agentId), parsed = lookSchema.safeParse(row?.look ?? DEFAULT_LOOK), avatar = avatarRow(store, tenant, agentId);
  const look = parsed.success ? parsed.data : { ...DEFAULT_LOOK };
  const avatarHash = avatar && typeof avatar.hash === 'string' ? avatar.hash : null;
  return { ...look, avatar: look.avatar === 'upload' && !avatarHash ? 'feminino' : look.avatar, avatarHash, revision: Number.isSafeInteger(row?.revision) ? Number(row!.revision) : 0 };
}
/** Aparência pública do canal (widget e link hospedado): nome resolvido e foto por endereço com hash. */
export function publicAppearance(store: Store, tenant: string, channel: Entity) {
  const agentId = String(channel.agentId), look = lookOf(store, tenant, agentId), agent = store.get(tenant, 'agents', agentId);
  return { displayName: (look.displayName || String(agent?.name ?? '') || 'Atendimento').slice(0, 100), avatar: look.avatar, avatarBorder: look.avatarBorder,
    avatarUrl: look.avatar === 'upload' && look.avatarHash ? `${WEBCHAT_AVATAR_PATH}?${new URLSearchParams({ tenantId: tenant, channelId: channel.id, v: look.avatarHash })}` : null,
    attachments: look.attachments, theme: look.theme, accent: look.accent, accentMode: look.accentMode };
}
function adminView(store: Store, tenant: string, agentId: string) {
  const look = lookOf(store, tenant, agentId), avatar = avatarRow(store, tenant, agentId), row = lookRow(store, tenant, agentId);
  const { avatarHash, revision, ...appearance } = look;
  return { agentId, revision, appearance, avatar: avatar && avatarHash ? { hash: avatarHash, dataUrl: `data:${avatar.contentType};base64,${avatar.data}`, size: Number(avatar.size ?? 0) } : null, updatedAt: row?.updatedAt ?? null };
}
/** Canal de webchat do assistente que atende este navegador (widget no site permitido ou link hospedado publicado). */
function servingChannel(store: Store, request: FastifyRequest) {
  const q = z.object({ tenantId: z.string().min(1).max(128), channelId: z.string().min(1).max(128) }).passthrough().parse(request.query);
  const channel = store.get(q.tenantId, 'channels', q.channelId);
  if (!channel || channel.type !== 'webchat' || channel.enabled !== true || !store.get(q.tenantId, 'agents', String(channel.agentId))) throw new Fault(404, 'chat_unavailable', 'Atendimento indisponível neste site.');
  return { tenantId: q.tenantId, channel };
}

export function registerWebchatAppearance(app: FastifyInstance, store: Store) {
  const wrap = (fn: (r: FastifyRequest, p: FastifyReply) => unknown) => async (r: FastifyRequest, p: FastifyReply) => {
    p.header('Cache-Control', 'no-store');
    try { return await fn(r, p); }
    catch (e) {
      if (e instanceof z.ZodError) return p.code(400).send({ error: { code: 'invalid_input', message: 'Confira os campos da personalização.' } });
      if (e instanceof Fault || e instanceof MembershipError) return p.code(e instanceof Fault ? e.status : e.statusCode).send({ error: { code: e.code, message: e.message } });
      throw e;
    }
  };
  app.get('/api/v1/webchat/appearance', wrap(req => {
    const actor = requireRequestPermission(store, req, 'channels:read'), { agentId } = z.object({ agentId: identifier }).strict().parse(req.query);
    if (!store.get(actor.tenantId, 'agents', agentId)) throw new Fault(404, 'not_found', 'Assistente não encontrado nesta organização.');
    return adminView(store, actor.tenantId, agentId);
  }));
  // Grava a aparência inteira (revisão esperada); `avatarUpload` ausente mantém a foto, null apaga, dataUrl substitui.
  app.put('/api/v1/webchat/appearance', { bodyLimit: 1_700_000 }, wrap(req => {
    const actor = requireRequestPermission(store, req, 'channels:write'), body = putSchema.parse(req.body ?? {});
    if (body.expectedTenantId !== actor.tenantId) throw new Fault(409, 'tenant_mismatch', 'A organização mudou. Atualize a página.');
    const upload = body.avatarUpload ? avatarFrom(body.avatarUpload.dataUrl) : body.avatarUpload;
    store.transaction(() => {
      const tenant = requireRequestPermission(store, req, 'channels:write').tenantId;
      if (!store.get(tenant, 'agents', body.agentId)) throw new Fault(404, 'not_found', 'Assistente não encontrado nesta organização.');
      const row = lookRow(store, tenant, body.agentId), current = lookOf(store, tenant, body.agentId), avatar = avatarRow(store, tenant, body.agentId);
      const nextHash = upload === undefined ? current.avatarHash : upload?.hash ?? null;
      if (current.revision !== body.expectedRevision) {
        // Mesma gravação repetida depois de uma resposta perdida: nada muda.
        if (JSON.stringify({ ...current, revision: 0 }) === JSON.stringify({ ...body.appearance, avatarHash: nextHash, revision: 0 })) return;
        throw new Fault(409, 'appearance_changed', 'A personalização mudou em outra janela. Atualize antes de salvar.');
      }
      if (body.appearance.avatar === 'upload' && !nextHash) throw new Fault(400, 'avatar_missing', 'Envie uma foto antes de escolhê-la.');
      if (upload === null && avatar) store.remove(tenant, AVATARS, avatar.id);
      if (upload) { if (avatar) store.update(tenant, AVATARS, avatar.id, upload); else store.create(tenant, AVATARS, { agentId: body.agentId, ...upload }); }
      const revision = current.revision + 1;
      if (row) store.update(tenant, APPEARANCES, row.id, { look: body.appearance, revision }); else store.create(tenant, APPEARANCES, { agentId: body.agentId, look: body.appearance, revision });
      store.create(tenant, AUDIT, { agentId: body.agentId, actorUserId: actor.userId, revision, avatar: upload === undefined ? 'kept' : upload ? 'replaced' : 'removed' });
    });
    return adminView(store, actor.tenantId, body.agentId);
  }));
  // Público (widget em sites de clientes): só para o site permitido do canal ou o link hospedado publicado.
  app.get(WEBCHAT_APPEARANCE_PUBLIC_PATH, { config: { cors: false } }, wrap((req, reply) => {
    const { tenantId, channel } = servingChannel(store, req), origin = req.headers.origin;
    if (origin !== undefined) { if (!allowedChatOrigin(channel, origin)) throw new Fault(403, 'chat_unavailable', 'Atendimento indisponível neste site.'); reply.header('Access-Control-Allow-Origin', origin).header('Vary', 'Origin'); }
    return publicAppearance(store, tenantId, channel);
  }));
  app.get(WEBCHAT_AVATAR_PATH, { config: { cors: false } }, wrap((req, reply) => {
    const { tenantId, channel } = servingChannel(store, req), avatar = avatarRow(store, tenantId, String(channel.agentId));
    if (!avatar || typeof avatar.data !== 'string') throw new Fault(404, 'not_found', 'Foto não encontrada.');
    return reply.type(String(avatar.contentType)).header('Cache-Control', 'public, max-age=86400').header('Cross-Origin-Resource-Policy', 'cross-origin').send(Buffer.from(avatar.data, 'base64'));
  }));

  /* ------------------------------------- anexos do visitante ("Permitir anexos") ------------------------------------- */
  const attachmentTypes: Record<string, (b: Buffer) => boolean> = {
    'image/png': b => imageInfo(b)?.type === 'image/png', 'image/jpeg': b => imageInfo(b)?.type === 'image/jpeg', 'image/webp': b => imageInfo(b)?.type === 'image/webp',
    'image/gif': b => b.toString('ascii', 0, 4) === 'GIF8', 'application/pdf': b => b.toString('ascii', 0, 5) === '%PDF-',
    'text/plain': b => !b.includes(0), 'text/csv': b => !b.includes(0),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': b => b.readUInt32BE(0) === 0x504b0304,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': b => b.readUInt32BE(0) === 0x504b0304,
  };
  const uploadSchema = z.object({ name: z.string().trim().min(1).max(120).refine(v => !/[\u0000-\u001f\u007f/\\]/.test(v)), contentType: z.string().max(120), dataBase64: z.string().max(2_900_000).regex(/^[A-Za-z0-9+/]+={0,2}$/) }).strict();
  /** Sessão do visitante (mesmo token Bearer do chat público) no canal e na origem em que foi aberta. */
  function visitor(req: FastifyRequest) {
    const { tenantId, channel } = servingChannel(store, req), origin = req.headers.origin;
    if (!allowedChatOrigin(channel, origin)) throw new Fault(403, 'chat_unavailable', 'Atendimento indisponível neste site.');
    const auth = req.headers.authorization;
    if (typeof auth !== 'string' || !/^Bearer [A-Za-z0-9_-]{43}$/.test(auth)) throw new Fault(401, 'chat_session_expired', 'Inicie uma nova conversa.');
    const tokenHash = sha(auth.slice(7)), session = store.list(tenantId, 'public-chat-sessions').find(s => s.tokenHash === tokenHash);
    if (!session || session.channelId !== channel.id || session.origin !== origin || session.status !== 'active' || Number(session.expiresAt) <= Date.now()) throw new Fault(401, 'chat_session_expired', 'Inicie uma nova conversa.');
    return { tenantId, channel, origin: origin as string, session };
  }
  app.options(WEBCHAT_ATTACHMENTS_PATH, { config: { cors: false } }, wrap((req, reply) => {
    const { channel } = servingChannel(store, req), origin = req.headers.origin;
    if (!allowedChatOrigin(channel, origin) || req.headers['access-control-request-method'] !== 'POST') throw new Fault(403, 'cors_rejected', 'Origem não permitida.');
    return reply.header('Access-Control-Allow-Origin', origin).header('Vary', 'Origin').header('Access-Control-Allow-Methods', 'POST').header('Access-Control-Allow-Headers', 'Authorization, Content-Type').header('Access-Control-Max-Age', '300').code(204).send();
  }));
  app.post(WEBCHAT_ATTACHMENTS_PATH, { config: { cors: false }, bodyLimit: 3_000_000 }, wrap((req, reply) => {
    const v = visitor(req); reply.header('Access-Control-Allow-Origin', v.origin).header('Vary', 'Origin');
    if (!lookOf(store, v.tenantId, String(v.channel.agentId)).attachments) throw new Fault(403, 'attachments_disabled', 'Este atendimento não recebe anexos.');
    const body = uploadSchema.parse(req.body ?? {}), bytes = Buffer.from(body.dataBase64, 'base64'), check = attachmentTypes[body.contentType];
    if (!bytes.length || bytes.length > ATTACHMENT_MAX) throw new Fault(400, 'attachment_too_large', 'O arquivo pode ter no máximo 2 MB.');
    if (!check || bytes.length < 4 || !check(bytes)) throw new Fault(400, 'attachment_type', 'Envie imagem (PNG, JPEG, WebP, GIF), PDF, texto, CSV, Word ou Excel.');
    return store.transaction(() => {
      const fresh = visitor(req), day = new Date().toISOString().slice(0, 10), rows = store.list(fresh.tenantId, ATTACHMENTS);
      for (const old of rows.filter(r => Date.parse(String(r.createdAt)) < Date.now() - ATTACHMENT_DAYS * 86400000)) store.remove(fresh.tenantId, ATTACHMENTS, old.id);
      if (rows.filter(r => r.sessionId === fresh.session.id).length >= ATTACHMENTS_PER_SESSION) throw new Fault(429, 'attachment_limit', 'Limite de anexos desta conversa atingido.');
      if (rows.filter(r => String(r.createdAt).slice(0, 10) === day).length >= ATTACHMENTS_PER_DAY) throw new Fault(429, 'attachment_daily_limit', 'O limite de anexos de hoje foi atingido.');
      const row = store.create(fresh.tenantId, ATTACHMENTS, { channelId: fresh.channel.id, agentId: String(fresh.channel.agentId), sessionId: fresh.session.id, conversationId: fresh.session.conversationId ?? null,
        name: body.name, contentType: body.contentType, size: bytes.length, sha256: sha(bytes), data: bytes.toString('base64'), downloadKey: randomBytes(18).toString('base64url') });
      const kb = Math.max(1, Math.round(bytes.length / 1024));
      // Texto que o visitante envia pelo chat: a equipe abre o arquivo em Conversas (sessão da equipe), a IA vê só o nome.
      return { id: row.id, name: body.name, size: bytes.length, contentType: body.contentType, message: `📎 Anexo: ${body.name} (${kb} KB)\n${attachmentLink(row.id)}` };
    });
  }));
  // Equipe: abre o anexo pelo link da conversa (sessão da organização com acesso a canais).
  app.get('/api/v1/webchat/attachments/:id', wrap((req, reply) => {
    const actor = requireRequestPermission(store, req, 'channels:read'), { id } = z.object({ id: identifier }).strict().parse(req.params), row = store.get(actor.tenantId, ATTACHMENTS, id);
    if (!row || typeof row.data !== 'string') throw new Fault(404, 'not_found', 'Anexo não encontrado.');
    const safeName = String(row.name).replace(/[^\p{L}\p{N}._ -]/gu, '_');
    return reply.type(String(row.contentType)).header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`).header('Content-Security-Policy', "default-src 'none'; sandbox").send(Buffer.from(row.data, 'base64'));
  }));
}
/** Link absoluto (Conversas) para o anexo; sem endereço público configurado, o caminho relativo do painel. */
export function attachmentLink(id: string) {
  const base = (process.env.APP_ORIGIN || process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  return `${base}/api/v1/webchat/attachments/${encodeURIComponent(id)}`;
}
export type AppearanceData = Data;
