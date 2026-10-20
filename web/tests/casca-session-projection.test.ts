import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyEngineDB, projectIdentity } from '../src/data/engine-state'
import { useStore } from '../src/data/store'
import { publishSlice } from '../src/services/casca/data'
import type { BootstrapData } from '../src/services/engine/types'
import type { EngineContext } from '../src/services/engine/session'

const data: BootstrapData = {
  identity: { userId: 'user-a', email: 'test@kloel.test', tenantId: 'tenant-a', role: 'owner', permissions: [],
    context: { userId: 'user-a', tenantId: 'tenant-a', membershipId: 'member-a', authorityVersion: 'a'.repeat(64) },
    organizations: [{ id: 'org-a', tenantId: 'tenant-a', name: 'Empresa', status: 'active', createdAt: '2026-10-19T00:00:00Z', membershipId: 'member-a', role: 'owner', joinedAt: '2026-10-19T00:00:00Z' }] },
  profile: { id: 'user-a', email: 'test@kloel.test', firstName: 'Nome', lastName: '', language: 'pt-BR', phone: null, revision: 0, profileCreatedAt: null, updatedAt: null },
  settings: { name: 'Empresa atual', timezone: 'America/Sao_Paulo' },
}

test('connected cache starts empty, including customers, credentials and conversations', () => {
  const db = emptyEngineDB()
  for (const value of Object.values(db)) if (Array.isArray(value)) assert.equal(value.length, 0)
  assert.deepEqual(db.session, { userId: null, orgId: null })
  assert.throws(() => useStore.getState().resetDemo(), /não está disponível/)
})

test('identity projection uses tenant scope and verified membership instead of local demo accounts', () => {
  const result = projectIdentity(data)
  assert.equal(result.session.orgId, 'tenant-a')
  assert.equal(result.organizations[0].id, 'tenant-a')
  assert.equal(result.organizations[0].name, 'Empresa atual')
  assert.equal(result.memberships[0].id, 'member-a')
  assert.equal(result.memberships[0].role, 'admin')
  assert.equal(result.users[0].password, '')
  assert.equal(result.users[0].id, data.identity.userId)
})

test('late projection cannot overwrite cache after its authority has changed', () => {
  const before = emptyEngineDB()
  useStore.getState().replace(before)
  const context = { assertCurrent() { throw new Error('superseded') } } as EngineContext
  assert.throws(() => publishSlice(context, { agents: [{ id: 'foreign' }] as never }), /superseded/)
  assert.equal(useStore.getState().db, before)
})

test('confirmed projections preserve session and UI preferences', () => {
  const db = { ...emptyEngineDB(), ...projectIdentity(data) }
  db.ui.sidebarCollapsed = true
  useStore.getState().replace(db)
  const context = { assertCurrent() {} } as EngineContext
  publishSlice(context, { contacts: [] })
  assert.equal(useStore.getState().db.session.orgId, 'tenant-a')
  assert.equal(useStore.getState().db.ui.sidebarCollapsed, true)
})
