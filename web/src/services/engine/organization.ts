import { EngineError } from './http'
import type { EngineContext } from './session'

export interface OrganizationSettings {
  name: string; legalName: string; country: string; locale: string; timezone: string
  website: string | null; supportEmail: string | null; currency: 'BRL'
  notifications: { newConversation: boolean; appointmentCreated: boolean; usageWarnings: boolean }
}
export interface OrganizationSnapshot { tenantId: string; version: string; settings: OrganizationSettings }
export interface OrganizationAttempt { version: string; fingerprint: string }
export type OrganizationRecovery = 'corresponds' | 'conflict' | 'unknown'
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const versionPattern = /^[a-f0-9]{64}$/
function invalid(message = 'As configurações da empresa recebidas são inválidas. Atualize a tela.'): never { throw new EngineError(0, 'invalid_data', message) }
function text(value: unknown, max: number) { if (typeof value !== 'string' || value.length > max) invalid(); return value }

/** Keep one canonical, allowlisted value for requests and lost-response comparison. */
export function organizationSettings(value: unknown): OrganizationSettings {
  if (!object(value) || !object(value.notifications)) invalid()
  const name = text(value.name, 200).trim(), legalName = text(value.legalName, 300), country = text(value.country, 2)
  const locale = text(value.locale, 50), timezone = text(value.timezone, 100)
  if (!name || !/^[A-Z]{2}$/.test(country) || value.currency !== 'BRL') invalid('Confira nome, país e moeda da empresa.')
  try { new Intl.Locale(locale); new Intl.DateTimeFormat('en', { timeZone: timezone }) } catch { invalid('Informe um idioma e um fuso horário válidos.') }
  const website = value.website == null || value.website === '' ? null : text(value.website, 4000)
  if (website !== null) { try { if (!['http:', 'https:'].includes(new URL(website).protocol)) invalid() } catch { invalid('Informe um site HTTP ou HTTPS válido.') } }
  const supportEmail = value.supportEmail == null || value.supportEmail === '' ? null : text(value.supportEmail, 254).trim().toLowerCase()
  if (supportEmail !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail)) invalid('Informe um e-mail de suporte válido.')
  const { newConversation, appointmentCreated, usageWarnings } = value.notifications
  if ([newConversation, appointmentCreated, usageWarnings].some(v => typeof v !== 'boolean')) invalid()
  return { name, legalName, country, locale, timezone, website, supportEmail, currency: 'BRL', notifications: { newConversation, appointmentCreated, usageWarnings } }
}
export async function organizationFingerprint(value: OrganizationSettings) {
  const data = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(organizationSettings(value))))
  return [...new Uint8Array(data)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
export async function organizationRecovery(attempt: OrganizationAttempt, current: OrganizationSnapshot): Promise<OrganizationRecovery> {
  if (!versionPattern.test(attempt.version) || !versionPattern.test(attempt.fingerprint)) invalid()
  if (await organizationFingerprint(current.settings) === attempt.fingerprint) return 'corresponds'
  return current.version === attempt.version ? 'unknown' : 'conflict'
}
export function organizationClient(context: EngineContext) {
  const parse = (raw: unknown): OrganizationSnapshot => {
    if (!object(raw) || raw.tenantId !== context.tenantId || typeof raw.version !== 'string' || !versionPattern.test(raw.version)) invalid()
    return { tenantId: context.tenantId, version: raw.version, settings: organizationSettings(raw) }
  }
  return {
    async get(signal?: AbortSignal) { context.assertCurrent(); const raw = await context.request('/organization-settings', { signal }); context.assertCurrent(); return parse(raw) },
    async save(baseline: OrganizationSnapshot, value: OrganizationSettings) {
      context.assertCurrent()
      if (baseline.tenantId !== context.tenantId || !versionPattern.test(baseline.version)) invalid()
      const settings = organizationSettings(value)
      const raw = await context.request('/organization-settings', { method: 'PUT', body: { ...settings, expectedVersion: baseline.version } })
      context.assertCurrent()
      const result = parse(raw)
      if (JSON.stringify(result.settings) !== JSON.stringify(settings)) invalid('O retorno não corresponde às configurações enviadas. Consulte o estado atual.')
      return result
    },
  }
}
