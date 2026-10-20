import { EngineError } from './http'
import type { EngineContext } from './session'
export type AfterConfiguration = { enabled: boolean; allowedTags: string[] }
export type AfterConfig = { agentId: string; revision: number; configuration: AfterConfiguration; authorization: { state: 'disabled' | 'active' | 'revoked'; reasonCode: string | null } }
export type AfterConfigAttempt = { kind: 'after.configure'; key: string; agentId: string; expectedRevision: number }
export type CloseAttempt = { kind: 'conversation.close'; key: string; conversationId: string; expectedVersion: string }
export type AfterAttempt = AfterConfigAttempt | CloseAttempt
export type AfterConfigOperation = { key: string; kind: 'after.configure'; tenantId: string; agentId: string; expectedRevision: number; revision: number; status: 'succeeded'; createdAt: string; automaticRetry: false }
export type CloseOperation = { key: string; kind: 'conversation.close'; tenantId: string; conversationId: string; closureId: string | null; epoch: number | null; status: 'closed'; createdAt: string; automaticRetry: false }
export type AfterOperation = AfterConfigOperation | CloseOperation
export type AnalysisResult = { summary: { text: string; sourceMessageIds: string[] }; tagProposals: { tag: string; sourceMessageIds: string[] }[]; provenance: { promptVersion: 1; model: string; generatedAt: string; inputDigest: string } }
export type AnalysisView = { id: string; conversationId: string; epoch: number; closedAt: string; sourceMessageCount: number; status: 'skipped' | 'queued' | 'running' | 'succeeded' | 'failed' | 'uncertain'; reasonCode: string | null; applicable: boolean; invalidatedReason: string | null; startedAt: string | null; completedAt: string | null; automaticRetry: false; result: AnalysisResult | null }
export type AnalysisPage = { items: AnalysisView[]; cursor: string | null; hasMore: boolean }
export const afterId = (v: unknown): v is string => typeof v === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(v)
const obj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const exact = (v: Record<string, any>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k))
const rev = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v))
const code = (v: unknown) => v === null || typeof v === 'string' && /^[a-z][a-z0-9_]{0,99}$/.test(v)
const reserved = new Set(['no_ai', 'human_handoff', 'manual_only', 'requires_review', '__proto__', 'constructor', 'prototype'])
const tag = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v === v.trim() && v.length <= 80 && !reserved.has(v.toLowerCase())
function invalid(message = 'Resposta de análise incompatível. Preserve a referência e consulte novamente.'): never { throw new EngineError(0, 'invalid_after_conversation', message) }
export function parseAfterConfiguration(raw: unknown): AfterConfiguration { if (!obj(raw) || !exact(raw, ['enabled', 'allowedTags']) || typeof raw.enabled !== 'boolean' || !Array.isArray(raw.allowedTags) || raw.allowedTags.length > 30 || raw.allowedTags.some(v => !tag(v)) || new Set(raw.allowedTags).size !== raw.allowedTags.length) invalid('Informe até 30 etiquetas distintas, sem etiquetas reservadas de automação.'); return structuredClone(raw) as AfterConfiguration }
export function validAfterAttempt(a: unknown): a is AfterAttempt { return obj(a) && afterId(a.key) && (a.kind === 'after.configure' ? exact(a, ['kind','key','agentId','expectedRevision']) && afterId(a.agentId) && rev(a.expectedRevision) && a.expectedRevision < Number.MAX_SAFE_INTEGER : a.kind === 'conversation.close' && exact(a, ['kind','key','conversationId','expectedVersion']) && afterId(a.conversationId) && hash(a.expectedVersion)) }
export function parseAfterOperation(raw: unknown, a: AfterAttempt, tenantId: string): AfterOperation {
  if (!validAfterAttempt(a) || !obj(raw) || raw.kind !== a.kind || raw.key !== a.key || raw.tenantId !== tenantId || !date(raw.createdAt) || raw.automaticRetry !== false) invalid()
  if (a.kind === 'after.configure') { if (!exact(raw, ['key','kind','tenantId','agentId','expectedRevision','revision','status','createdAt','automaticRetry']) || raw.agentId !== a.agentId || raw.expectedRevision !== a.expectedRevision || !rev(raw.revision) || raw.revision !== a.expectedRevision + 1 || raw.status !== 'succeeded') invalid() }
  else if (!exact(raw, ['key','kind','tenantId','conversationId','closureId','epoch','status','createdAt','automaticRetry']) || raw.conversationId !== a.conversationId || raw.status !== 'closed' || !(raw.closureId === null && raw.epoch === null || afterId(raw.closureId) && rev(raw.epoch) && raw.epoch > 0)) invalid()
  return structuredClone(raw) as AfterOperation
}
function sourceIds(v: unknown, max: number) { return Array.isArray(v) && v.length > 0 && v.length <= max && v.every(afterId) && new Set(v).size === v.length }
export function parseAnalysisPage(raw: unknown, conversationId: string): AnalysisPage {
  if (!afterId(conversationId) || !obj(raw) || !exact(raw,['items','cursor','hasMore']) || !Array.isArray(raw.items) || raw.items.length > 20 || typeof raw.hasMore !== 'boolean' || raw.cursor !== null && !afterId(raw.cursor) || raw.items.length && raw.cursor !== raw.items.at(-1)?.id || raw.hasMore && !raw.items.length) invalid()
  const ids = new Set(), epochs = new Set(); let previous = Infinity
  for (const v of raw.items) {
    if (!obj(v) || !exact(v,['id','conversationId','epoch','closedAt','sourceMessageCount','status','reasonCode','applicable','invalidatedReason','startedAt','completedAt','automaticRetry','result']) || !afterId(v.id) || ids.has(v.id) || v.conversationId !== conversationId || !rev(v.epoch) || !v.epoch || v.epoch >= previous || epochs.has(v.epoch) || !date(v.closedAt) || !rev(v.sourceMessageCount) || !['skipped','queued','running','succeeded','failed','uncertain'].includes(v.status) || !code(v.reasonCode) || !code(v.invalidatedReason) || typeof v.applicable !== 'boolean' || v.applicable && (v.status !== 'succeeded' || v.invalidatedReason !== null) || v.startedAt !== null && !date(v.startedAt) || v.completedAt !== null && !date(v.completedAt) || v.automaticRetry !== false) invalid()
    ids.add(v.id); epochs.add(v.epoch); previous = v.epoch
    if (v.status !== 'succeeded') { if (v.result !== null || v.applicable) invalid(); continue }
    const r = v.result; if (!obj(r) || !exact(r,['summary','tagProposals','provenance']) || !obj(r.summary) || !exact(r.summary,['text','sourceMessageIds']) || typeof r.summary.text !== 'string' || !r.summary.text.trim() || r.summary.text.length > 2000 || !sourceIds(r.summary.sourceMessageIds,20) || !Array.isArray(r.tagProposals) || r.tagProposals.length > 10 || new Set(r.tagProposals.map((p:any)=>p?.tag)).size !== r.tagProposals.length) invalid()
    for (const p of r.tagProposals) if (!obj(p) || !exact(p,['tag','sourceMessageIds']) || !tag(p.tag) || !sourceIds(p.sourceMessageIds,8)) invalid()
    const p = r.provenance; if (!obj(p) || !exact(p,['promptVersion','model','generatedAt','inputDigest']) || p.promptVersion !== 1 || typeof p.model !== 'string' || !p.model || p.model.length > 200 || !date(p.generatedAt) || !hash(p.inputDigest)) invalid()
  }
  return structuredClone(raw) as AnalysisPage
}
export function createAfterConversationService(context: EngineContext) {
  async function request(path: string, options?: Parameters<EngineContext['request']>[1]): Promise<any> { context.assertCurrent(); const r = await context.request(path, options); context.assertCurrent(); options?.signal?.throwIfAborted(); return r }
  return {
    async config(agentId: string, signal?: AbortSignal): Promise<AfterConfig> { if (!afterId(agentId)) invalid(); const r = await request(`/agents/${agentId}/after-conversation`,{signal}); if (!obj(r) || !exact(r,['agentId','revision','configuration','authorization']) || r.agentId !== agentId || !rev(r.revision) || !obj(r.authorization) || !exact(r.authorization,['state','reasonCode']) || !['disabled','active','revoked'].includes(r.authorization.state) || !code(r.authorization.reasonCode)) invalid(); return { agentId, revision:r.revision, configuration:parseAfterConfiguration(r.configuration), authorization:structuredClone(r.authorization) } as AfterConfig },
    async configure(a: AfterConfigAttempt, configuration: AfterConfiguration): Promise<AfterConfigOperation> { if (!validAfterAttempt(a) || a.kind !== 'after.configure') invalid(); const r = await request(`/agents/${a.agentId}/after-conversation`,{method:'PUT',body:{expectedTenantId:context.tenantId,expectedRevision:a.expectedRevision,idempotencyKey:a.key,configuration:parseAfterConfiguration(configuration)}}); if (!obj(r) || !exact(r,['operation','replayed']) || typeof r.replayed !== 'boolean') invalid(); return parseAfterOperation(r.operation,a,context.tenantId) as AfterConfigOperation },
    async close(a: CloseAttempt): Promise<CloseOperation> { if (!validAfterAttempt(a) || a.kind !== 'conversation.close') invalid(); const r=await request(`/conversations/${a.conversationId}/close`,{method:'POST',body:{expectedTenantId:context.tenantId,expectedVersion:a.expectedVersion,idempotencyKey:a.key}}); if (!obj(r) || !exact(r,['operation','replayed']) || typeof r.replayed !== 'boolean') invalid(); return parseAfterOperation(r.operation,a,context.tenantId) as CloseOperation },
    async operation(a: AfterAttempt): Promise<AfterOperation> { if (!validAfterAttempt(a)) invalid(); return parseAfterOperation(await request(a.kind === 'after.configure' ? `/after-conversation/config-operations/${a.key}` : `/conversation-close-operations/${a.key}`),a,context.tenantId) },
    async analyses(conversationId: string, cursor?: string, signal?: AbortSignal) { if (!afterId(conversationId) || cursor !== undefined && !afterId(cursor)) invalid(); return parseAnalysisPage(await request(`/conversations/${conversationId}/analyses${cursor ? `?cursor=${encodeURIComponent(cursor)}`:''}`,{signal}),conversationId) },
  }
}
