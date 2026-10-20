import test from 'node:test'
import assert from 'node:assert/strict'
import { createProfileCommands } from '../src/services/casca/profile'
import type { EngineContext } from '../src/services/engine/session'
import type { Profile } from '../src/services/engine/types'
const profile: Profile = { id: 'user', email: 'test@example.invalid', firstName: 'Antes', lastName: '', phone: null, language: 'pt-BR', revision: 0, profileCreatedAt: null, updatedAt: null }
const draft = { firstName: 'Depois', lastName: '', phone: null, language: 'pt-BR' }
function fixture(responder: (options: any) => Promise<unknown>) {
  const calls: any[] = []; let current = true
  const context = { tenantId: 'tenant', generation: 1, assertCurrent() { if (!current) throw new Error('superseded') }, async request(_path: string, options: any) { calls.push(options); return responder(options) } } as EngineContext
  return { commands: createProfileCommands(context, profile), calls, expire() { current = false } }
}
test('profile write uses the original revision and returns only the confirmed profile', async () => {
  const f = fixture(async options => ({ ...profile, ...options.body, revision: 1 }))
  const saved = await f.commands.save(draft)
  assert.equal(saved.firstName, 'Depois'); assert.equal(f.calls[0].body.revision, 0)
})
test('lost profile result is recovered by GET without repeating PATCH', async () => {
  const f = fixture(async options => { if (options?.method) throw new Error('transport lost'); return { ...profile, ...draft, revision: 1 } })
  await assert.rejects(f.commands.save(draft), /transport lost/)
  assert.equal((await f.commands.save(draft)).revision, 1)
  assert.equal(f.calls.filter(call => call?.method === 'PATCH').length, 1)
})
test('a previous save is never reported as success for newly edited fields', async () => {
  const f = fixture(async options => { if (options?.method) throw new Error('transport lost'); return { ...profile, ...draft, revision: 1 } })
  await assert.rejects(f.commands.save(draft))
  await assert.rejects(f.commands.save({ ...draft, firstName: 'Outra alteração' }), /anterior foi salvo/)
  assert.equal(f.calls.filter(call => call?.method === 'PATCH').length, 1)
})
test('an unresolved previous write blocks another write even when the new fields differ', async () => {
  const f = fixture(async options => { if (options?.method) throw new Error('transport lost'); return profile })
  await assert.rejects(f.commands.save(draft))
  await assert.rejects(f.commands.save({ ...draft, firstName: 'Outra alteração' }), /anterior ainda/)
  assert.equal(f.calls.filter(call => call?.method === 'PATCH').length, 1)
})
test('profile result arriving after a session change is discarded', async () => {
  const f = fixture(async () => { f.expire(); return { ...profile, ...draft, revision: 1 } })
  await assert.rejects(f.commands.save(draft), /superseded/)
})
