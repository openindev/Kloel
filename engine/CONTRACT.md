# Kloel engine — implementation contract

Standalone local backend; no modification of other Kloel projects or protected body. User's frontend is being built separately. No production deployment until local validation.

Stack: Node.js 22+, TypeScript, Fastify, Zod, node:sqlite. Local bind 127.0.0.1:4310. Prefix /api/v1. Production-grade claims require evidence, not merely code existence.

## Shared interfaces

Domain modules export `async function registerDomains(app: FastifyInstance, store: Store): Promise<void>` from src/domains.ts.
Provider modules export `async function registerProviders(app: FastifyInstance, store: Store): Promise<void>` from src/providers.ts.

Store exported from src/store.ts:
`list(tenantId: string, collection: string): Entity[]`
`get(tenantId: string, collection: string, id: string): Entity | undefined`
`create(tenantId: string, collection: string, data: Record<string, unknown>): Entity`
`update(tenantId: string, collection: string, id: string, data: Record<string, unknown>): Entity | undefined`
`remove(tenantId: string, collection: string, id: string): boolean`
`transaction<T>(fn: () => T): T`
Entity: `{ id: string; tenantId: string; createdAt: string; updatedAt: string; [key: string]: unknown }`.

Authentication hook sets `request.actor` = `{userId:string,tenantId:string,role:'owner'|'admin'|'member'}` on authenticated routes. Auth methods managed by core. Every /api/v1 route requires auth unless explicitly declared public by root. Provider callbacks must have individual signature checks. Do not create outbound real side effects without explicit endpoint plus appropriate permissions. Provider secrets server-only; credentials absent = 503 integration_not_configured, NEVER fake success. Environment config read from process.env; ignore .env in git. No secrets in logs or errors.

Response: data entities direct or `{items:[...]}`. Error: `{error:{code:string,message:string}}`. All paths used by plugins start /api/v1. Typed Fastify augmentation in src/types.d.ts. Node sqlite sync store handles tenant isolation and identifier ownership. Avoid direct filesystem writes by domain modules.

Providers owned by agent: src/providers.ts, src/providers/**, tests/providers*.test.ts. Domains owned by agent: src/domains.ts, src/domains/**, tests/domains*.test.ts. Root owns core/auth/server/store and project configuration. Contracts may evolve only with coordination. No mutation of provider dashboards by child agents. No browser use by child agents.
