import { create } from 'zustand'
import { useMemo } from 'react'
import type { CollectionKey, DemoDB, EntityOf, ID, UiPrefs, Organization, User, BillingProfile, ContactSettings } from '@/domain/types'
import { listBackups } from './storage'
import { uid } from '@/lib/utils'
import { emptyEngineDB } from './engine-state'

/**
 * In-memory projection of confirmed API responses, using the original shell model.
 * Commands belong to src/services/casca; this store never persists credentials or a demo database.
 */

type Updater<T> = Partial<T> | ((prev: T) => T)

interface StoreState {
  db: DemoDB
  /** substitui o banco inteiro (usado por restauração/importação) */
  replace: (db: DemoDB) => void
  /** aplica uma transformação imutável no banco */
  mutate: (fn: (db: DemoDB) => DemoDB) => void
  insert: <K extends CollectionKey>(key: K, item: Partial<EntityOf<K>>) => EntityOf<K>
  patch: <K extends CollectionKey>(key: K, id: ID, update: Updater<EntityOf<K>>) => void
  remove: <K extends CollectionKey>(key: K, id: ID | ID[]) => void
  setUi: (patch: Partial<UiPrefs>) => void
  setSession: (orgId: ID | null, userId: ID | null) => void
  patchOrg: (patch: Partial<Organization>, orgId?: ID) => void
  patchUser: (patch: Partial<User>, userId?: ID) => void
  patchBilling: (patch: Updater<BillingProfile>) => void
  patchContactSettings: (patch: Updater<ContactSettings>) => void
  resetDemo: (reason?: string) => void
}

const ORG_SCOPED = new Set<string>([
  'invites', 'agents', 'knowledgeEntries', 'knowledgeSources', 'conversations', 'tags', 'contacts', 'phoneNumbers',
  'whatsappAccounts', 'calendarConnections', 'eventTypes', 'bookings', 'emailInboxes', 'emailMessages', 'apiKeys',
  'integrationRequests', 'campaigns', 'subscriptions', 'invoices', 'referrals', 'memberships',
])

function initialDB(): DemoDB {
  return emptyEngineDB()
}

function applyUpdate<T>(prev: T, update: Updater<T>): T {
  return typeof update === 'function' ? (update as (p: T) => T)(prev) : { ...prev, ...update }
}

export const useStore = create<StoreState>()((set, get) => ({
  db: initialDB(),
  replace: (db) => set({ db }),
  mutate: (fn) => set((s) => ({ db: fn(s.db) })),
  insert: (key, item) => {
    const db = get().db
    const now = new Date().toISOString()
    const base: Record<string, unknown> = { id: uid(String(key).slice(0, 3)), createdAt: now }
    if (ORG_SCOPED.has(key as string) && db.session.orgId) base.orgId = db.session.orgId
    const entity = { ...base, ...item } as EntityOf<typeof key>
    set((s) => ({ db: { ...s.db, [key]: [...(s.db[key] as unknown[]), entity] } }))
    return entity
  },
  patch: (key, id, update) =>
    set((s) => ({
      db: {
        ...s.db,
        [key]: (s.db[key] as Array<{ id: ID }>).map((e) => (e.id === id ? applyUpdate(e as never, update as never) : e)),
      },
    })),
  remove: (key, id) => {
    const ids = new Set(Array.isArray(id) ? id : [id])
    set((s) => ({ db: { ...s.db, [key]: (s.db[key] as Array<{ id: ID }>).filter((e) => !ids.has(e.id)) } }))
  },
  setUi: (patch) => set((s) => ({ db: { ...s.db, ui: { ...s.db.ui, ...patch } } })),
  setSession: (orgId, userId) => set((s) => ({ db: { ...s.db, session: { orgId, userId } } })),
  patchOrg: (patch, orgId) =>
    set((s) => {
      const id = orgId ?? s.db.session.orgId
      return { db: { ...s.db, organizations: s.db.organizations.map((o) => (o.id === id ? { ...o, ...patch } : o)) } }
    }),
  patchUser: (patch, userId) =>
    set((s) => {
      const id = userId ?? s.db.session.userId
      return { db: { ...s.db, users: s.db.users.map((u) => (u.id === id ? { ...u, ...patch } : u)) } }
    }),
  patchBilling: (update) =>
    set((s) => {
      const orgId = s.db.session.orgId
      return {
        db: { ...s.db, billingProfiles: s.db.billingProfiles.map((b) => (b.orgId === orgId ? applyUpdate(b, update) : b)) },
      }
    }),
  patchContactSettings: (update) =>
    set((s) => {
      const orgId = s.db.session.orgId
      return {
        db: { ...s.db, contactSettings: s.db.contactSettings.map((c) => (c.orgId === orgId ? applyUpdate(c, update) : c)) },
      }
    }),
  resetDemo: (reason = 'Restauração manual dos dados de demonstração') => {
    throw new Error('A restauração de demonstração não está disponível nesta aplicação.')
  },
}))

// Business data stays in this tab's authenticated memory cache. No demo database,
// credentials or entity snapshots are read from or persisted to localStorage.

/* ------------------------------- Hooks ------------------------------- */

export const useDB = <T,>(selector: (db: DemoDB) => T) => useStore((s) => selector(s.db))
export const actions = () => useStore.getState()

export function useSession() {
  return useStore((s) => s.db.session)
}

export function useCurrentOrg(): Organization | undefined {
  const orgId = useStore((s) => s.db.session.orgId)
  const orgs = useStore((s) => s.db.organizations)
  return useMemo(() => orgs.find((o) => o.id === orgId), [orgs, orgId])
}

export function useCurrentUser(): User | undefined {
  const userId = useStore((s) => s.db.session.userId)
  const users = useStore((s) => s.db.users)
  return useMemo(() => users.find((u) => u.id === userId), [users, userId])
}

export function useCurrentRole() {
  const { orgId, userId } = useSession()
  const memberships = useStore((s) => s.db.memberships)
  return useMemo(() => memberships.find((m) => m.orgId === orgId && m.userId === userId)?.role ?? 'viewer', [memberships, orgId, userId])
}

/** Coleção filtrada pela organização atual (quando aplicável). */
export function useCollection<K extends CollectionKey>(key: K): EntityOf<K>[] {
  const all = useStore((s) => s.db[key]) as EntityOf<K>[]
  const orgId = useStore((s) => s.db.session.orgId)
  return useMemo(() => {
    if (!ORG_SCOPED.has(key as string)) return all
    return all.filter((e) => (e as unknown as { orgId?: ID }).orgId === orgId)
  }, [all, orgId, key])
}

export function useEntity<K extends CollectionKey>(key: K, id: ID | undefined): EntityOf<K> | undefined {
  const all = useStore((s) => s.db[key]) as unknown as Array<EntityOf<K> & { id: ID }>
  const orgId = useStore((s) => s.db.session.orgId)
  return useMemo(() => (id ? all.find((e) => e.id === id && (!ORG_SCOPED.has(key) || (e as { orgId?: string }).orgId === orgId)) : undefined), [all, id, orgId, key])
}

export function useBillingProfile() {
  const orgId = useStore((s) => s.db.session.orgId)
  const all = useStore((s) => s.db.billingProfiles)
  return useMemo(() => all.find((b) => b.orgId === orgId), [all, orgId])
}

export function useContactSettings() {
  const orgId = useStore((s) => s.db.session.orgId)
  const all = useStore((s) => s.db.contactSettings)
  return useMemo(() => all.find((b) => b.orgId === orgId), [all, orgId])
}

export function useUi() {
  return useStore((s) => s.db.ui)
}

export { listBackups }
