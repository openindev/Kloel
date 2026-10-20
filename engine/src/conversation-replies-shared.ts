import type { Entity } from './store.js';
import { canonicalWebchatOrigin, hostedChatOrigin, hostedLinkPublished } from './webchat-origins.js';

export function allowedChatOrigin(channel: Entity, origin: unknown): origin is string {
  if (typeof origin !== 'string' || canonicalWebchatOrigin(origin) !== origin) return false;
  // A origem da própria Kloel só atende o link hospedado publicado deste canal (nunca entra em allowedOrigins).
  if (hostedLinkPublished(channel) && origin === hostedChatOrigin()) return true;
  const values = (channel.configuration as Record<string, unknown> | undefined)?.allowedOrigins;
  return Array.isArray(values) && values.length > 0 && values.length <= 50
    && values.every(value => canonicalWebchatOrigin(value) !== undefined)
    && values.some(value => canonicalWebchatOrigin(value) === origin);
}

export function chatMode(conversation: Entity): 'ai' | 'human' | 'closed' {
  if (conversation.status === 'closed') return 'closed';
  return conversation.status === 'pending' || conversation.webchatHuman === true || Array.isArray(conversation.tags) && conversation.tags.some(tag => tag === 'human_handoff' || tag === 'no_ai') ? 'human' : 'ai';
}
export function chatGeneration(conversation: Entity): number {
  return typeof conversation.replyRevision === 'number' && Number.isSafeInteger(conversation.replyRevision) && conversation.replyRevision >= 0 ? conversation.replyRevision : 0;
}

/** Public projection deliberately excludes internal notes, local-only messages and identity details. */
export function publicMessage(message: Entity) {
  if (message.kind === 'internal_note' || typeof message.content !== 'string') return null;
  const visitor = message.role === 'user' && (message.source === 'public_widget' || message.source === 'manual' && message.deliveryStatus === 'received');
  const human = message.role === 'assistant' && message.source === 'webchat' && message.authorType === 'human';
  const ai = message.role === 'assistant' && message.source === 'openai';
  if (!visitor && !human && !ai) return null;
  return { id: message.id, role: visitor ? 'user' : 'assistant', authorType: visitor ? 'visitor' : human ? 'human' : 'ai', content: message.content, createdAt: message.createdAt };
}
