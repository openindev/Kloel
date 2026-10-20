import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Entity, Store } from '../store.js';
import { DomainError } from '../domains.js';
import { capture, hash, owned } from '../conversation-analysis/authority.js';
import { currentRequestActor } from '../memberships/access.js';
import { MembershipError } from '../memberships/service.js';
import { OAuthError } from '../oauth/client.js';
import { pinnedAddress } from '../ingestion/safe-url.js';
import { integrationUrl, type IntegrationTransport } from './transport.js';
import { seal } from '../oauth/crypto.js';
import { actionCollection, configureAction } from './service.js';

export const configurationOperations = 'integration-configuration-operations';
const uuid = z.string().uuid(), revision = z.number().int().nonnegative().safe();
const inputSchema = z.object({ expectedTenantId: z.string().min(1), idempotencyKey: uuid, actionId: uuid.nullable(), expectedRevision: revision, configuration: z.record(z.unknown()).optional(), enabled: z.boolean().optional(), purgeSecrets: z.boolean().optional(), executionTiming: z.enum(['during', 'after']).optional() }).strict().refine(v => (v.configuration !== undefined) !== (v.enabled !== undefined)).refine(v => v.enabled === undefined || v.executionTiming === undefined).refine(v => v.purgeSecrets !== true || v.enabled === false).refine(v => v.actionId === null ? v.expectedRevision === 0 && v.configuration !== undefined : v.expectedRevision > 0 && v.expectedRevision < Number.MAX_SAFE_INTEGER);
const fail = (code: string, status = 409): never => { throw new DomainError(status, code, 'A configuração ou a sessão mudou. Consulte a referência original antes de tentar novamente.'); };
const receipt = (row: Entity) => ({ key: row.key, kind: row.kind, tenantId: row.tenantId, actionId: row.actionId, expectedRevision: row.expectedRevision, revision: row.revision, status: 'succeeded' as const, automaticRetry: false as const, createdAt: row.createdAt });

/** Configuration only. DNS validation sends no HTTP request and never executes the registered workflow. */
export async function registerIntegrationConfigurations(app: FastifyInstance, store: Store, transport?: IntegrationTransport) {
  store.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS integration_configuration_key ON entities(tenant_id,json_extract(body,'$.key')) WHERE collection='${configurationOperations}'`);
  const safe = (fn: (r: FastifyRequest) => unknown | Promise<unknown>) => async (r: FastifyRequest, reply: any) => {
    reply.header('Cache-Control', 'no-store');
    try { currentRequestActor(store, r); return await fn(r); }
    catch (error) {
      if (error instanceof MembershipError || error instanceof DomainError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      if (error instanceof OAuthError) return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
      if (error instanceof z.ZodError) return reply.code(400).send({ error: { code: 'invalid_integration_configuration', message: 'Confira os dados da configuração.' } });
      throw error;
    }
  };
  const find = (tenant: string, key: string) => store.list(tenant, configurationOperations).find(row => row.key === key);
  app.get('/api/v1/integrations/configuration-operations/:key', safe(r => {
    const a = capture(store, r, ['integrations:manage']), key = uuid.parse((r.params as any).key), row = find(a.tenantId, key);
    if (!row || !owned(row, a)) return fail('integration_configuration_operation_not_found', 404);
    a.assertCurrent(); return receipt(row);
  }));
  app.post('/api/v1/integrations/action-configurations', safe(async r => {
    const a = capture(store, r, ['integrations:manage']), input = inputSchema.parse(r.body);
    if (input.expectedTenantId !== a.tenantId) fail('tenant_mismatch');
    const fingerprint = hash(input), kind = input.enabled !== undefined ? 'integration.action.set_enabled' : input.actionId ? 'integration.action.update' : 'integration.action.create';
    function prior() {
      const row = find(a.tenantId, input.idempotencyKey);
      if (!row) return null;
      if (!owned(row, a) || row.fingerprint !== fingerprint) fail('integration_configuration_idempotency_conflict');
      a.assertCurrent(); return { operation: receipt(row), replayed: true };
    }
    const replay = prior(); if (replay) return replay;
    const original = input.actionId ? store.get(a.tenantId, actionCollection, input.actionId) : null;
    if (input.actionId && (!original || original.revision !== input.expectedRevision)) fail('integration_configuration_changed');
    const originalHash = original ? hash(original) : null;
    if (input.enabled !== undefined) return store.transaction(() => {
      a.assertCurrent(); const replay = prior(); if (replay) return replay;
      const live = store.get(a.tenantId, actionCollection, input.actionId!);
      if (!live || live.revision !== input.expectedRevision || hash(live) !== originalHash) return fail('integration_configuration_changed');
      const patch: Record<string, unknown> = { enabled: input.enabled, revision: input.expectedRevision + 1 };
      if (input.purgeSecrets) {
        let encryptedConfig: string;
        try { encryptedConfig = seal({ url: 'https://deleted.invalid/removed', headers: {} }, `${live.tenantId}:${live.id}:integration-config`); }
        catch { throw new DomainError(503, 'integration_storage_unavailable', 'Chave de proteção das integrações indisponível.'); }
        Object.assign(patch, { encryptedConfig, configuredSecretHeaders: [], signed: false, agentIds: [], targetOrigin: 'https://deleted.invalid' });
      }
      store.update(a.tenantId, actionCollection, live.id, patch);
      const saved = store.create(a.tenantId, configurationOperations, { key: input.idempotencyKey, kind, actionId: live.id, expectedRevision: input.expectedRevision, revision: input.expectedRevision + 1, fingerprint, authority: a.scope });
      a.assertCurrent(); return { operation: receipt(saved), replayed: false };
    });
    const url = integrationUrl(z.string().max(8000).parse(input.configuration!.url));
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([pinnedAddress(url, transport?.resolve), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new DomainError(504, 'integration_configuration_dns_timeout', 'Não foi possível confirmar o destino. Nenhuma configuração foi salva.')), 5000); })]); }
    finally { clearTimeout(timeout); }
    a.assertCurrent(); const concurrentReplay = prior(); if (concurrentReplay) return concurrentReplay;
    const assertAccess = () => {
      a.assertCurrent();
      if (input.actionId) { const live = store.get(a.tenantId, actionCollection, input.actionId); if (!live || live.revision !== input.expectedRevision || hash(live) !== originalHash) fail('integration_configuration_changed'); }
      const existing = find(a.tenantId, input.idempotencyKey); if (existing) fail('integration_configuration_idempotency_conflict');
    };
    let saved: Entity | undefined;
    // configureAction owns the transaction. The callback records the receipt before that transaction commits.
    configureAction(store, r.actor, input.configuration, input.actionId ?? undefined, assertAccess, action => {
      a.assertCurrent();
      if (action.revision !== input.expectedRevision + 1) fail('integration_configuration_changed');
      store.update(a.tenantId, actionCollection, action.id, { executionTiming: input.executionTiming ?? original?.executionTiming ?? 'during' });
      saved = store.create(a.tenantId, configurationOperations, { key: input.idempotencyKey, kind, actionId: action.id, expectedRevision: input.expectedRevision, revision: action.revision, fingerprint, authority: a.scope });
      a.assertCurrent();
    });
    if (!saved) fail('integration_configuration_operation_not_found');
    return { operation: receipt(saved!), replayed: false };
  }));
}
