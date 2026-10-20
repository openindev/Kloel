import { parseHttpMetadata, type HttpMetadata } from './before-http'
import { EngineError } from './http'
import { parseBeforeFacts, type BeforeFacts } from './before-context'

export type BeforeVoiceIntent = { expectedRevision: number; expectedHttpRevision?: number; mode: 'live' | 'test'; testFacts?: BeforeFacts }
export type BeforeVoiceMetadata = {
  httpSource?: HttpMetadata; openingId: string; revision: number; mode: 'live' | 'test'; surface: 'voice_private' | 'voice_incoming'
  barrier: 'prepared' | 'waiting_session' | 'waiting_item' | 'ready' | 'active' | 'blocked' | 'unknown' | 'ended'
  greetingStatus: 'not_needed' | 'not_requested' | 'requested' | 'generation_completed' | 'generation_failed' | 'unknown'
  reasonCode: null | 'before_context_changed' | 'voice_authority_revoked' | 'voice_route_revoked' | 'voice_barrier_timeout' | 'voice_session_ack_mismatch' | 'voice_context_item_mismatch' | 'voice_unexpected_generation' | 'voice_activation_interrupted' | 'voice_greeting_failed' | 'voice_control_disconnected'
  automaticRetry: false; audioDelivery: 'unverified'; mediaStage: 'blocked' | 'greeting' | 'conversation'
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k))
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(v)
function invalid(): never { throw new EngineError(0, 'invalid_before_voice', 'O estado da preparação de voz não foi confirmado. Preserve a referência; nenhuma chamada será repetida.') }
export function parseBeforeVoiceIntent(raw: unknown): BeforeVoiceIntent {
  if (!object(raw) || Object.keys(raw).some(k => !['expectedRevision', 'expectedHttpRevision', 'mode', 'testFacts'].includes(k)) || !Number.isSafeInteger(raw.expectedRevision) || Number(raw.expectedRevision) < 1 || raw.expectedHttpRevision !== undefined && (!Number.isSafeInteger(raw.expectedHttpRevision) || Number(raw.expectedHttpRevision) < 1) || !['live', 'test'].includes(String(raw.mode)) || raw.mode === 'live' && raw.testFacts !== undefined) invalid()
  return { ...(raw.expectedHttpRevision === undefined ? {} : { expectedHttpRevision: Number(raw.expectedHttpRevision) }), expectedRevision: Number(raw.expectedRevision), mode: raw.mode as BeforeVoiceIntent['mode'], ...(raw.testFacts === undefined ? {} : { testFacts: parseBeforeFacts(raw.testFacts) }) }
}
export function parseBeforeVoiceMetadata(raw: unknown, previous?: BeforeVoiceMetadata, intent?: BeforeVoiceIntent): BeforeVoiceMetadata {
  if (!object(raw) || !exact(raw, ['openingId','revision','mode','surface','barrier','greetingStatus','reasonCode','automaticRetry','audioDelivery','mediaStage', ...(raw.httpSource === undefined ? [] : ['httpSource'])]) || !uuid(raw.openingId) || !Number.isSafeInteger(raw.revision) || Number(raw.revision) < 1 || !['live','test'].includes(String(raw.mode)) || !['voice_private','voice_incoming'].includes(String(raw.surface)) || raw.surface === 'voice_incoming' && raw.mode !== 'live'
    || !['prepared','waiting_session','waiting_item','ready','active','blocked','unknown','ended'].includes(String(raw.barrier)) || !['not_needed','not_requested','requested','generation_completed','generation_failed','unknown'].includes(String(raw.greetingStatus)) || !['blocked','greeting','conversation'].includes(String(raw.mediaStage)) || raw.automaticRetry !== false || raw.audioDelivery !== 'unverified'
    || raw.reasonCode !== null && !['before_context_changed','voice_authority_revoked','voice_route_revoked','voice_barrier_timeout','voice_session_ack_mismatch','voice_context_item_mismatch','voice_unexpected_generation','voice_activation_interrupted','voice_greeting_failed','voice_control_disconnected'].includes(String(raw.reasonCode))) invalid()
  if (raw.mediaStage === 'conversation' && (raw.barrier !== 'active' || !['generation_completed','not_needed'].includes(String(raw.greetingStatus)) || raw.reasonCode !== null)) invalid()
  if (raw.mediaStage === 'greeting' && (raw.reasonCode !== null || !['ready','waiting_session'].includes(String(raw.barrier)) || !['requested','generation_completed','not_needed'].includes(String(raw.greetingStatus)))) invalid()
  if (previous && ['openingId','revision','mode','surface'].some(k => raw[k] !== previous[k as keyof BeforeVoiceMetadata])) invalid()
  if (intent && (raw.revision !== intent.expectedRevision || raw.mode !== intent.mode || raw.surface !== 'voice_private')) invalid()
  if (raw.httpSource !== undefined) { const h = parseHttpMetadata(raw.httpSource, intent?.expectedHttpRevision, previous?.httpSource); if (raw.mediaStage !== 'blocked' && !['external','defaults'].includes(h.resolution)) invalid() }
  if (intent && (intent.expectedHttpRevision === undefined) !== (raw.httpSource === undefined) || previous?.httpSource && raw.httpSource === undefined) invalid()
  return structuredClone(raw) as BeforeVoiceMetadata
}
export const beforeVoiceLabels = {
  blocked: 'Áudio de entrada bloqueado; preparação ainda não liberada.',
  greeting: 'Saudação em preparação ou geração; microfone bloqueado.',
  conversation: 'Preparação confirmada; conversa por voz liberada.',
}
