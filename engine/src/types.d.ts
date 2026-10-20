import 'fastify';
import type { MembershipActor } from './memberships/service.js';
import type { ApiKeyContext } from './api-keys/service.js';
declare module 'fastify' {
  interface FastifyRequest { actor: MembershipActor; identity: { userId: string }; apiKey?: ApiKeyContext; }
}
