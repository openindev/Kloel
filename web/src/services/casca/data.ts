import type { DemoDB } from '@/domain/types'
import { useStore } from '@/data/store'
import { emptyEngineDB, projectIdentity } from '@/data/engine-state'
import { captureEngineContext, engineSession, type EngineContext } from '@/services/engine/session'
import { readOnboardingProjection } from './onboarding'
import { loadReferralCode } from './referrals'

export type DataArea = 'agents' | 'conversations' | 'phones' | 'whatsapp' | 'scheduling' | 'contacts' | 'integrations' | 'email' | 'billing' | 'account' | 'users' | 'api-keys' | 'company' | 'campaigns' | 'overview' | 'admin'
export type DataSlice = Partial<Omit<DemoDB, 'session' | 'organizations' | 'ui'>>
export type AreaLoader = (context: EngineContext) => Promise<DataSlice>
const loaders = new Map<DataArea, AreaLoader>()
const reads = new Map<string, Promise<void>>()
let generation = -1
const onboardingReads = new Set<string>()
const referralReads = new Set<string>()

export function registerAreaLoader(area: DataArea, loader: AreaLoader) { loaders.set(area, loader) }

/** Per-slice write clock: an area read never replaces a slice published (save, create, delete…) after that read began. */
const written = new Map<string, number>(), complete = new Set<string>()
let clock = 0

/** Commit a whole confirmed response only while its original authority is still current. asOf: when its data was read (default: now). */
export function publishSlice(context: EngineContext, slice: DataSlice, asOf = ++clock) {
  context.assertCurrent()
  for (const name of Object.keys(slice)) written.set(name, Math.max(written.get(name) ?? 0, asOf))
  useStore.getState().mutate(db => ({ ...db, ...slice }))
}

/** Publica uma leitura completa iniciada em `started`: fatia gravada localmente depois disso é mais nova e fica; as demais passam a estar carregadas por inteiro. */
function commitRead(context: EngineContext, slice: DataSlice, started: number) {
  const fresh = Object.fromEntries(Object.entries(slice).filter(([name]) => (written.get(name) ?? 0) <= started)) as DataSlice
  publishSlice(context, fresh, started)
  for (const name of Object.keys(fresh)) complete.add(name)
}

/** A fatia já veio inteira de uma leitura nesta sessão (não só de gravações locais parciais). */
export const sliceLoaded = (name: keyof DataSlice) => complete.has(name)

export async function loadArea(area: DataArea, force = false): Promise<void> {
  const context = captureEngineContext()
  const key = `${context.generation}:${context.tenantId}:${area}`
  const existing = reads.get(key)
  if (existing && !force) return existing
  const loader = loaders.get(area)
  if (!loader) throw new Error('Não foi possível carregar esta área. Tente novamente.')
  const read = Promise.resolve().then(async () => {
    let last: { started: number; slice: DataSlice } | undefined
    for (let attempt = 1; ; attempt++) {
      const started = ++clock
      // Uma releitura que falha não descarta a leitura anterior, que era válida.
      try { last = { started, slice: await loader(context) } } catch (error) { if (last) return last; throw error }
      // Fatia ainda não carregada por inteiro e gravada durante a leitura (só a gravação local, parcial): lê a área de novo (até 3 leituras).
      if (attempt < 3 && Object.keys(last.slice).some(name => (written.get(name) ?? 0) > started && !complete.has(name))) continue
      return last
    }
  }).then(({ started, slice }) => {
    if (reads.get(key) !== read) return
    // Gravado depois que esta leitura começou = mais novo que ela: a leitura não sobrescreve (ex.: contato salvo enquanto as Atividades carregam).
    commitRead(context, slice, started)
  })
  reads.set(key, read)
  try { await read } finally { if (reads.get(key) === read) reads.delete(key) }
}

export function areaForPath(path: string): DataArea {
  if (path === '/app' || path === '/app/') return 'overview'
  if (/\/campaigns(?:\/|$)/.test(path)) return 'campaigns'
  // E-Mail IA first: its mailbox URLs end in /inbox (/app/email-agents/<id>/inbox) and must not load the Conversas area.
  if (/\/email-agents(?:\/|$)/.test(path)) return 'email'
  if (/\/agents(?:\/|$)/.test(path)) return 'agents'
  if (/\/inbox(?:\/|$)/.test(path)) return 'conversations'
  if (/\/phone-numbers(?:\/|$)/.test(path)) return 'phones'
  if (/\/whatsapp(?:\/|$)/.test(path)) return 'whatsapp'
  if (/\/scheduling(?:\/|$)/.test(path)) return 'scheduling'
  if (/\/contacts(?:\/|$)/.test(path)) return 'contacts'
  if (/\/integrations(?:\/|$)/.test(path)) return 'integrations'
  if (/\/(billing|change-plan|add-product|checkout|subscriptions|identity)(?:\/|$)/.test(path)) return 'billing'
  if (/\/account(?:\/|$)/.test(path)) return 'account'
  if (/\/users(?:\/|$)/.test(path)) return 'users'
  if (/\/api-keys(?:\/|$)/.test(path)) return 'api-keys'
  if (/\/company-settings(?:\/|$)/.test(path)) return 'company'
  return 'admin'
}

export function startEngineProjection() {
  const sync = () => {
    const session = engineSession.getSnapshot()
    const st = useStore.getState()
    if (generation !== session.generation || session.phase === 'anonymous' || session.phase === 'error') {
      generation = session.generation
      reads.clear()
      written.clear(); complete.clear()
      onboardingReads.clear()
      referralReads.clear()
      st.replace(emptyEngineDB(st.db.ui))
    }
    if (session.data && (session.phase === 'authenticated' || session.phase === 'organization_required')) {
      st.mutate(db => {
        const identity = projectIdentity(session.data!)
        return { ...db, ...identity,
          organizations: identity.organizations.map(org => { const previous=db.organizations.find(row=>row.id===org.id);return previous?{...previous,...org,onboardingCompleted:previous.onboardingCompleted,onboardingRequired:previous.onboardingRequired,onboardingCompletionConfirmed:previous.onboardingCompletionConfirmed}:org }),
          users: [...db.users.filter(user => !identity.users.some(current => current.id === user.id)), ...identity.users],
          memberships: [...db.memberships.filter(member => !identity.memberships.some(current => current.id === member.id)), ...identity.memberships],
        }
      })
      if (session.phase === 'authenticated' && session.validation === 'ready' && session.data.identity.tenantId) {
        const key=`${session.generation}:${session.data.identity.userId}:${session.data.identity.tenantId}`
        if(!onboardingReads.has(key)) {
          onboardingReads.add(key)
          const context=captureEngineContext()
          void readOnboardingProjection(context,session.data.identity.context).catch(()=>{onboardingReads.delete(key)})
        }
        if(!referralReads.has(key)) {
          referralReads.add(key)
          const context=captureEngineContext(), tenantId=session.data.identity.tenantId
          void loadReferralCode(context).then(code=>useStore.getState().patchOrg({ referralCode: code }, tenantId)).catch(()=>{referralReads.delete(key)})
        }
      }
    }
  }
  const unsubscribe = engineSession.subscribe(sync)
  sync()
  return unsubscribe
}
