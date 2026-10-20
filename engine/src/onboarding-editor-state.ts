import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Entity, Store } from './store.js';
import { MembershipError } from './memberships/service.js';
import { assertRequestContext, parseExpectedRequestContext, resolveSessionContext, sameRequestContext } from './request-context.js';
import { planSnapshot } from './billing/plans.js';

const states = 'onboarding-editor-states', operations = 'onboarding-editor-operations';
const key = z.string().uuid(), revision = z.number().int().nonnegative().safe().max(Number.MAX_SAFE_INTEGER - 1);
const label = z.string().trim().min(1).max(100).refine(value => !/[\u0000-\u001f\u007f]/.test(value)).nullable();
export const onboardingStateSchema = z.object({
  step: z.enum(['plan', 'billing', 'payment', 'name', 'sector', 'size', 'referral', 'done', 'test-call']),
  sector: label, size: label, referralSource: label, agentId: key.nullable(), conversationId: key.nullable(),
}).strict();
const inputSchema = z.object({ expectedTenantId: z.string().min(1).max(128), expectedRevision: revision, idempotencyKey: key,
  state: onboardingStateSchema, initialize: z.literal(true).optional(), complete: z.literal(true).optional() }).strict();
const defaults: z.infer<typeof onboardingStateSchema> = { step: 'plan', sector: null, size: null, referralSource: null, agentId: null, conversationId: null };
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (code: string, status = 409): never => { throw new MembershipError(status, code, 'Atualize a configuração inicial e consulte o resultado anterior antes de continuar.'); };

function authority(store: Store, request: FastifyRequest) {
  const expected = parseExpectedRequestContext(request);
  if (!expected || request.apiKey || request.headers.authorization) return fail('human_context_required', 400);
  assertRequestContext(store, request);
  const cookie = request.cookies?.kloel_session;
  const current = cookie ? resolveSessionContext(store, createHash('sha256').update(cookie).digest('hex')) : undefined;
  if (!current?.actor || current.identity.userId !== request.identity?.userId || !sameRequestContext(current.context, expected)) return fail('human_session_required', 401);
  return { context: current.context, userId: current.identity.userId, tenantId: current.actor.tenantId };
}
type Authority = ReturnType<typeof authority>;
function stateRow(store: Store, actor: Authority) {
  const rows = store.list(actor.tenantId, states).filter(row => row.userId === actor.userId);
  if (rows.length > 1) return fail('onboarding_state_invalid');
  return rows[0];
}
function view(actor: Authority, row?: Entity) {
  if (row && (!revision.safeParse(row.revision).success || Number(row.revision) < 1 || row.required !== true || typeof row.completed !== 'boolean'
    || row.completed && !z.string().datetime().safeParse(row.completedAt).success || !row.completed && row.completedAt !== null)) return fail('onboarding_state_invalid');
  return { tenantId: actor.tenantId, userId: actor.userId, revision: row ? Number(row.revision) : 0, required: row?.required === true,
    completed: row?.completed === true, completedAt: row?.completedAt as string | null ?? null,
    state: row ? onboardingStateSchema.parse(row.state) : { ...defaults } };
}
function validateReferences(store: Store, actor: Authority, state: z.infer<typeof onboardingStateSchema>) {
  const agent = state.agentId ? store.get(actor.tenantId, 'agents', state.agentId) : undefined;
  if (state.agentId && !agent) fail('onboarding_agent_unavailable');
  if (state.conversationId) {
    const conversation = store.get(actor.tenantId, 'conversations', state.conversationId);
    if (!agent || !conversation || conversation.agentId !== agent.id) fail('onboarding_conversation_unavailable');
  }
  return agent;
}
const receipt = (row: Entity) => ({ operationKey: String(row.key), status: 'succeeded' as const, revision: Number(row.revision), view: row.view });

/** Optional editor metadata: absence leaves existing users alone and never grants an entitlement. */
export async function registerOnboardingEditorState(app: FastifyInstance, store: Store) {
  const base = '/api/v1/onboarding/editor-state';
  app.get(base, async request => { const actor = authority(store, request); return view(actor, stateRow(store, actor)); });
  app.get(`${base}/operations/:key`, async request => {
    const actor = authority(store, request), operationKey = z.object({ key }).strict().parse(request.params).key;
    const row = store.list(actor.tenantId, operations).find(item => item.key === operationKey && item.userId === actor.userId);
    if (!row || !sameRequestContext(row.context as Authority['context'], actor.context)) return fail('onboarding_operation_not_found', 404);
    return receipt(row);
  });
  app.put(base, async request => {
    const input = inputSchema.parse(request.body), actor = authority(store, request);
    if (input.expectedTenantId !== actor.tenantId) return fail('context_mismatch');
    return store.transaction(() => {
      const current = authority(store, request);
      if (!sameRequestContext(current.context, actor.context)) return fail('context_changed_in_flight');
      const fingerprint = digest(input), old = store.list(actor.tenantId, operations).find(row => row.key === input.idempotencyKey && row.userId === actor.userId);
      if (old) {
        if (!sameRequestContext(old.context as Authority['context'], actor.context) || old.fingerprint !== fingerprint) return fail('onboarding_idempotency_conflict');
        return receipt(old);
      }
      const prior = stateRow(store, actor), previous = view(actor, prior);
      if (previous.revision !== input.expectedRevision) return fail('onboarding_revision_conflict');
      if (previous.completed) return fail('onboarding_already_completed');
      if (!prior && input.initialize !== true) return fail('onboarding_not_initialized');
      const agent = validateReferences(store, actor, input.state);
      if (input.complete) {
        if (!agent || !['done', 'test-call'].includes(input.state.step)) return fail('onboarding_agent_required');
        const plan = planSnapshot(store, actor.tenantId);
        if (plan.state !== 'eligible' || plan.stripeMode !== 'live') return fail('onboarding_live_subscription_required');
      }
      const next = { userId: actor.userId, revision: previous.revision + 1, required: true, completed: input.complete === true,
        completedAt: input.complete ? new Date().toISOString() : null, state: input.state };
      const saved = prior ? store.update(actor.tenantId, states, prior.id, next)! : store.create(actor.tenantId, states, next);
      const operation = store.create(actor.tenantId, operations, { userId: actor.userId, key: input.idempotencyKey, context: actor.context,
        fingerprint, revision: next.revision, view: view(actor, saved) });
      if (!sameRequestContext(authority(store, request).context, actor.context)) return fail('context_changed_in_flight');
      return receipt(operation);
    });
  });
}
