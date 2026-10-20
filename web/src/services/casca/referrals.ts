import { useEffect, useState } from 'react'
import type { EngineContext } from '../engine/session'

/** "Indique um amigo": the engine owns the code of each organization and confirms shared codes publicly. */
export type PublicReferral = { valid: true; referrerName: string; benefit: { percentOff: number; months: number } } | { valid: false }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const isReferralCode = (code: unknown): code is string => typeof code === 'string' && UUID.test(code.trim())

function parsePublic(raw: unknown): PublicReferral {
  const v = raw as Record<string, unknown> | null
  if (!v || v.valid !== true) return { valid: false }
  const benefit = v.benefit as Record<string, unknown> | undefined
  if (typeof v.referrerName !== 'string' || !v.referrerName.trim() || v.referrerName.length > 200) return { valid: false }
  if (!benefit || !Number.isInteger(benefit.percentOff) || !Number.isInteger(benefit.months)) return { valid: false }
  return { valid: true, referrerName: v.referrerName.trim(), benefit: { percentOff: Number(benefit.percentOff), months: Number(benefit.months) } }
}

/** Public lookup; a malformed code is rejected without a request. */
export async function lookupReferral(code: string): Promise<PublicReferral> {
  if (!isReferralCode(code)) return { valid: false }
  const response = await fetch(`/api/v1/public/referrals/${encodeURIComponent(code.trim().toLowerCase())}`, { credentials: 'omit', headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error('referral_lookup_failed')
  return parsePublic(await response.json())
}

export type ReferralState = { status: 'none' } | { status: 'loading' } | { status: 'error' } | ({ status: 'done' } & PublicReferral)

export function useReferral(code: string | null | undefined): ReferralState {
  const [state, setState] = useState<ReferralState>(code ? { status: 'loading' } : { status: 'none' })
  useEffect(() => {
    if (!code) { setState({ status: 'none' }); return }
    let active = true
    setState({ status: 'loading' })
    lookupReferral(code).then(r => { if (active) setState({ status: 'done', ...r }) }, () => { if (active) setState({ status: 'error' }) })
    return () => { active = false }
  }, [code])
  return state
}

/** Code of the current organization (authenticated). */
export async function loadReferralCode(context: EngineContext): Promise<string> {
  const raw = await context.request<{ code?: unknown }>('/referrals/code')
  context.assertCurrent()
  if (!isReferralCode(raw?.code)) throw new Error('Não foi possível carregar o link de indicação.')
  return raw.code.toLowerCase()
}
