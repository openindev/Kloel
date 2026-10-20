import type { FastifyInstance } from 'fastify';
import type { Store } from './store.js';
import { runConversationActions } from './call-actions.js';

/**
 * "Conversa encerrada" para chats (webchat e WhatsApp): sem mensagem nova por CHAT_IDLE_MINUTES (padrão 30),
 * ou quando o visitante clica em "Encerrar" no widget. Dispara as ações "Enviar e-mail" uma única vez (actionsRunAt).
 * - Primeira subida: baseline único (engine_migrations) marca como tratadas, sem enviar, as conversas que já tinham terminado.
 * - Conversa parada que não pode agir (assistente sem "Enviar e-mail") é resolvida e sai das candidatas; configurar a ação
 *   depois não envia para conversas que terminaram antes. Conversa vazia sai até chegar mensagem nova (lastMessageAt).
 * - A varredura anda por cursor em ordem (createdAt,id): conversas ainda ativas nunca prendem as seguintes.
 * As marcas ficam em chat_end_marks, fora do corpo da conversa: pular uma conversa não invalida trabalhos de "Após conversa".
 */
const idleMs = () => Math.max(1, Number(process.env.CHAT_IDLE_MINUTES || 30)) * 60_000;
const CHAT = "json_extract(body,'$.channel') IN ('webchat','whatsapp')", BASELINE = '2026-10-20-chat-end-actions-baseline-v1';
const ready = new WeakSet<Store>(), cursors = new WeakMap<Store, { c: string; id: string }>();

function agentFor(store: Store, tenant: string, conv: Record<string, unknown>): string | undefined {
  if (typeof conv.agentId === 'string' && conv.agentId) return conv.agentId;
  const ch = typeof conv.channelId === 'string' ? store.get(tenant, 'channels', conv.channelId) : undefined;
  return typeof ch?.agentId === 'string' ? ch.agentId : undefined;
}
function hasEmailActions(store: Store, tenant: string, agentId: string) {
  const row = store.list(tenant, 'agent-editor-states').find(r => r.agentId === agentId);
  const emails = (row?.state as { emails?: unknown[] } | undefined)?.emails;
  return Array.isArray(emails) && emails.length > 0;
}
const mark = (store: Store, tenant: string, id: string, reason: string, at = new Date().toISOString()) =>
  store.db.prepare('INSERT INTO chat_end_marks(tenant_id,conversation_id,reason,at) VALUES(?,?,?,?) ON CONFLICT(tenant_id,conversation_id) DO UPDATE SET reason=excluded.reason, at=excluded.at').run(tenant, id, reason, at);
/** Já tratada sem envio (baseline, sem ações…). 'vazia' não conta: a conversa volta se o visitante escrever. */
const resolved = (store: Store, tenant: string, id: string) => !!store.db.prepare("SELECT 1 FROM chat_end_marks WHERE tenant_id=? AND conversation_id=? AND reason!='vazia'").get(tenant, id);

/** Tabela de marcas + baseline da primeira subida. Idempotente entre reinícios e deploys (marcador em engine_migrations). */
export function initializeChatEnd(store: Store, now = Date.now()) {
  if (ready.has(store)) return;
  store.transaction(() => {
    store.db.exec(`CREATE TABLE IF NOT EXISTS engine_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chat_end_marks (tenant_id TEXT NOT NULL, conversation_id TEXT NOT NULL, reason TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY(tenant_id, conversation_id));`);
    if (store.db.prepare('SELECT version FROM engine_migrations WHERE version=?').get(BASELINE)) return;
    // Conversas que já terminaram (encerradas, ou paradas há CHAT_IDLE_MINUTES) antes desta versão nunca enviam e-mail retroativo.
    const at = new Date(now).toISOString(), cutoff = new Date(now - idleMs()).toISOString(), last = new Map<string, string>();
    for (const r of store.db.prepare("SELECT tenant_id AS t, json_extract(body,'$.conversationId') AS c, MAX(json_extract(body,'$.createdAt')) AS m FROM entities WHERE collection='messages' GROUP BY t, c").all() as { t: string; c: unknown; m: unknown }[]) if (typeof r.c === 'string' && typeof r.m === 'string') last.set(`${r.t}\n${r.c}`, r.m);
    for (const r of store.db.prepare(`SELECT tenant_id AS t, id, json_extract(body,'$.createdAt') AS c, json_extract(body,'$.lastMessageAt') AS l, json_extract(body,'$.endedAt') AS e, json_extract(body,'$.status') AS s FROM entities WHERE collection='conversations' AND ${CHAT} AND json_extract(body,'$.actionsRunAt') IS NULL`).all() as { t: string; id: string; c: unknown; l: unknown; e: unknown; s: unknown }[]) {
      const activity = [r.c, r.l, last.get(`${r.t}\n${r.id}`)].filter((x): x is string => typeof x === 'string').sort().at(-1) ?? '';
      if (r.e || r.s === 'closed' || activity <= cutoff) mark(store, r.t, r.id, 'baseline', at);
    }
    store.db.prepare('INSERT INTO engine_migrations(version,applied_at) VALUES(?,?)').run(BASELINE, at);
  });
  ready.add(store);
}

/** Encerra imediatamente (botão "Encerrar" do widget). */
export async function endChatConversation(store: Store, tenant: string, conversationId: string) {
  initializeChatEnd(store);
  const conv = store.get(tenant, 'conversations', conversationId); if (!conv || conv.actionsRunAt || resolved(store, tenant, conversationId)) return;
  const agentId = agentFor(store, tenant, conv); if (!agentId || !hasEmailActions(store, tenant, agentId)) { mark(store, tenant, conversationId, 'sem_acoes'); return; }
  if (!conv.endedAt) store.update(tenant, 'conversations', conversationId, { endedAt: new Date().toISOString(), endReason: 'visitor_ended' });
  const r = await runConversationActions(store, tenant, agentId, conversationId); console.log('chat_end_actions', r.ok, r.sent ?? 0, r.reason ?? '');
}

/** Última mensagem de cada conversa do lote (uma consulta por organização). */
function lastMessages(store: Store, rows: { tenant_id: string; id: string }[]) {
  const out = new Map<string, string>(), byTenant = new Map<string, string[]>();
  for (const r of rows) byTenant.set(r.tenant_id, [...(byTenant.get(r.tenant_id) ?? []), r.id]);
  for (const [tenant, ids] of byTenant) for (const r of store.db.prepare("SELECT json_extract(body,'$.conversationId') AS c, MAX(json_extract(body,'$.createdAt')) AS m FROM entities WHERE tenant_id=? AND collection='messages' AND json_extract(body,'$.conversationId') IN (SELECT value FROM json_each(?)) GROUP BY c").all(tenant, JSON.stringify(ids)) as { c: unknown; m: unknown }[]) if (typeof r.c === 'string' && typeof r.m === 'string') out.set(`${tenant}\n${r.c}`, r.m);
  return out;
}

export async function sweepIdleChats(store: Store, now = Date.now(), limit = 500) {
  initializeChatEnd(store, now);
  const at = new Date(now).toISOString(), since = new Date(now - 7 * 86400_000).toISOString(), cutoff = new Date(now - idleMs()).toISOString(), from = cursors.get(store) ?? { c: '', id: '' };
  const rows = store.db.prepare(`SELECT tenant_id, id, json_extract(body,'$.createdAt') AS c FROM entities e WHERE collection='conversations' AND ${CHAT} AND json_extract(body,'$.actionsRunAt') IS NULL
    AND json_extract(body,'$.createdAt') >= ? AND json_extract(body,'$.createdAt') <= ? AND (json_extract(body,'$.createdAt') > ? OR (json_extract(body,'$.createdAt') = ? AND id > ?))
    AND NOT EXISTS (SELECT 1 FROM chat_end_marks m WHERE m.tenant_id=e.tenant_id AND m.conversation_id=e.id AND (m.reason!='vazia' OR COALESCE(json_extract(e.body,'$.lastMessageAt'),'') <= m.at))
    ORDER BY json_extract(body,'$.createdAt'), id LIMIT ?`).all(since, cutoff, from.c, from.c, from.id, limit) as { tenant_id: string; id: string; c: string }[];
  // Lote cheio: a próxima volta continua depois da última linha; lote incompleto: recomeça do início.
  if (rows.length < limit) cursors.delete(store); else cursors.set(store, { c: rows.at(-1)!.c, id: rows.at(-1)!.id });
  const last = lastMessages(store, rows);
  let done = 0;
  for (const { tenant_id: tenant, id } of rows) {
    const conv = store.get(tenant, 'conversations', id); if (!conv || conv.actionsRunAt) continue;
    const t = last.get(`${tenant}\n${id}`);
    if (!t) { mark(store, tenant, id, 'vazia', at); continue; }
    if (t > cutoff) continue; // ainda ativa: o cursor segue adiante e ela volta na próxima passagem
    const agentId = agentFor(store, tenant, conv); if (!agentId || !hasEmailActions(store, tenant, agentId)) { mark(store, tenant, id, 'sem_acoes', at); continue; }
    store.update(tenant, 'conversations', id, { endedAt: conv.endedAt ?? t, endReason: conv.endReason ?? 'inactivity' });
    const r = await runConversationActions(store, tenant, agentId, id).catch(() => ({ ok: false, sent: 0, reason: 'erro' }));
    if (!store.get(tenant, 'conversations', id)?.actionsRunAt) mark(store, tenant, id, r.reason || 'sem_envio', at);
    console.log('chat_idle_actions', r.ok, r.sent ?? 0); done++;
  }
  return done;
}

export function registerChatEnd(_app: FastifyInstance, store: Store) {
  initializeChatEnd(store);
  if (process.env.NODE_ENV === 'test') return;
  let busy = false;
  const t = setInterval(() => { if (busy) return; busy = true; void sweepIdleChats(store).catch(() => 0).finally(() => { busy = false; }); }, 60_000); t.unref();
}
