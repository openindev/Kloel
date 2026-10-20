import type { EngineContext } from './session'
import { EngineError } from './http'
import { integrationConfiguration, type IntegrationConfiguration } from './integrations'

export type IntegrationConfigAttempt = { key: string; actionId: string | null; expectedRevision: number; enabled?: boolean }
export type IntegrationConfigReceipt = { key: string; kind: 'integration.action.create' | 'integration.action.update' | 'integration.action.set_enabled'; tenantId: string; actionId: string; expectedRevision: number; revision: number; status: 'succeeded'; automaticRetry: false; createdAt: string }
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v)
export function validIntegrationConfigAttempt(a: unknown): a is IntegrationConfigAttempt {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return false
  const v = a as IntegrationConfigAttempt
  return Object.keys(v).sort().join(',') === (v.enabled === undefined ? 'actionId,expectedRevision,key' : 'actionId,enabled,expectedRevision,key') && (v.enabled === undefined || typeof v.enabled === 'boolean' && v.actionId !== null) && uuid(v.key) && Number.isSafeInteger(v.expectedRevision) && (v.actionId === null ? v.expectedRevision === 0 : uuid(v.actionId) && v.expectedRevision > 0 && v.expectedRevision < Number.MAX_SAFE_INTEGER)
}
function invalid(): never { throw new EngineError(0, 'invalid_integration_configuration_receipt', 'Não foi possível confirmar o salvamento desta integração. Consulte a referência original.') }
export function parseIntegrationConfigReceipt(raw: unknown, a: IntegrationConfigAttempt, tenant: string): IntegrationConfigReceipt {
  if (!validIntegrationConfigAttempt(a) || !raw || typeof raw !== 'object' || Array.isArray(raw)) invalid()
  const r = raw as IntegrationConfigReceipt
  if (Object.keys(r).sort().join(',') !== 'actionId,automaticRetry,createdAt,expectedRevision,key,kind,revision,status,tenantId' || r.key !== a.key || r.kind !== (a.enabled !== undefined ? 'integration.action.set_enabled' : a.actionId ? 'integration.action.update' : 'integration.action.create') || r.tenantId !== tenant || !uuid(r.actionId) || a.actionId !== null && a.actionId !== r.actionId || r.expectedRevision !== a.expectedRevision || r.revision !== a.expectedRevision + 1 || r.status !== 'succeeded' || r.automaticRetry !== false || typeof r.createdAt !== 'string' || !Number.isFinite(Date.parse(r.createdAt))) invalid()
  return structuredClone(r)
}
export function createIntegrationConfigurations(context: EngineContext) {
  return {
    async configure(a: IntegrationConfigAttempt, input: IntegrationConfiguration, executionTiming?: 'during' | 'after') {
      context.assertCurrent(); if (!validIntegrationConfigAttempt(a) || a.enabled !== undefined) invalid()
      const raw: any = await context.request('/integrations/action-configurations', { method: 'POST', body: { expectedTenantId: context.tenantId, idempotencyKey: a.key, actionId: a.actionId, expectedRevision: a.expectedRevision, configuration: integrationConfiguration(input), ...(executionTiming === undefined ? {} : { executionTiming }) } })
      context.assertCurrent(); if (!raw || Object.keys(raw).sort().join(',') !== 'operation,replayed' || typeof raw.replayed !== 'boolean') invalid()
      return parseIntegrationConfigReceipt(raw.operation, a, context.tenantId)
    },
    async setEnabled(a: IntegrationConfigAttempt) {
      context.assertCurrent(); if (!validIntegrationConfigAttempt(a) || a.enabled === undefined) invalid()
      const raw: any = await context.request('/integrations/action-configurations', { method: 'POST', body: { expectedTenantId: context.tenantId, idempotencyKey: a.key, actionId: a.actionId, expectedRevision: a.expectedRevision, enabled: a.enabled } })
      context.assertCurrent(); if (!raw || Object.keys(raw).sort().join(',') !== 'operation,replayed' || typeof raw.replayed !== 'boolean') invalid()
      return parseIntegrationConfigReceipt(raw.operation, a, context.tenantId)
    },
    async operation(a: IntegrationConfigAttempt) { context.assertCurrent(); if (!validIntegrationConfigAttempt(a)) invalid(); const raw = await context.request(`/integrations/configuration-operations/${a.key}`); context.assertCurrent(); return parseIntegrationConfigReceipt(raw, a, context.tenantId) },
  }
}
