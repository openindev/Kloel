import test from 'node:test'
import assert from 'node:assert/strict'
import { createMessagingAdapter } from '../src/services/casca/messaging'
import { EngineError } from '../src/services/engine/http'
import type { EngineContext } from '../src/services/engine/session'

function fixture(responder: (path: string, options?: any) => Promise<unknown>) {
  const data = new Map<string, string>(), calls: { path: string; options: any }[] = []
  let current = true
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } }
  const context = { tenantId: 'tenant', generation: 1, assertCurrent() { if (!current) throw new Error('superseded') },
    async request(path: string, options?: any) { calls.push({ path, options }); return responder(path, options) },
  } as EngineContext
  const adapter = createMessagingAdapter(context, 'user', () => storage, () => '11111111-1111-4111-8111-111111111111')
  return { adapter, data, calls, expire() { current = false } }
}

test('WhatsApp uses the selected channel and only reports provider acceptance', async () => {
  const f = fixture(async () => ({ messageId: 'wamid.test', conversationId: 'conversation', status: 'accepted' }))
  const result = await f.adapter.send('whatsapp', '+5511999990000', 'Mensagem', { channelId: 'channel' })
  assert.equal(result.simulated, false)
  assert.equal(result.status, 'accepted')
  assert.equal(result.id, 'wamid.test')
  assert.equal(f.calls[0].path, '/whatsapp/send')
  assert.equal(f.calls[0].options.body.channelId, 'channel')
  assert.equal(f.data.size, 0)
})

test('missing channel does not silently select another account or send', async () => {
  const f = fixture(async () => assert.fail('unexpected request'))
  await assert.rejects(f.adapter.send('whatsapp', '+5511999990000', 'Mensagem'), /Escolha/)
  assert.equal(f.calls.length, 0)
})

test('an ambiguous WhatsApp write stores only a reference and retry performs GET only', async () => {
  const f = fixture(async path => {
    if (path === '/whatsapp/send') throw new EngineError(0, 'network_error', 'incerto')
    return { status: 'unknown', automaticRetry: false }
  })
  await assert.rejects(f.adapter.send('whatsapp', '+5511999990000', 'Conteúdo privado', { channelId: 'channel' }))
  const saved = [...f.data.values()].join('')
  assert.ok(!saved.includes('Conteúdo') && !saved.includes('5511999990000'))
  await assert.rejects(f.adapter.send('whatsapp', '+5511888880000', 'Outra mensagem', { channelId: 'channel' }), /anterior ainda/)
  assert.deepEqual(f.calls.map(c => c.path), ['/whatsapp/send', '/whatsapp/operations/11111111-1111-4111-8111-111111111111'])
  assert.equal(f.data.size, 1)
})

test('a recovered previous acceptance is not misattributed to the newly edited message', async () => {
  const f = fixture(async path => {
    if (path === '/whatsapp/send') throw new EngineError(0, 'network_error', 'incerto')
    return { status: 'succeeded', automaticRetry: false, result: { messageId: 'wamid.original', status: 'accepted' } }
  })
  await assert.rejects(f.adapter.send('whatsapp', '+5511999990000', 'Primeira', { channelId: 'channel' }))
  await assert.rejects(f.adapter.send('whatsapp', '+5511888880000', 'Segunda', { channelId: 'channel' }), /envio anterior foi confirmado/)
  assert.equal(f.calls.filter(c => c.path === '/whatsapp/send').length, 1)
  assert.equal(f.data.size, 0)
})

test('email sends an explicit subject without inventing one for an unrelated flow', async () => {
  const f = fixture(async () => ({ messageId: 'resend-id', conversationId: 'email-conversation', status: 'accepted' }))
  await assert.rejects(f.adapter.send('email', 'recipient@kloel.test', 'Mensagem'), /assunto/)
  const result = await f.adapter.send('email', 'recipient@kloel.test', 'Mensagem', { subject: 'Assunto' })
  assert.equal(result.conversationId, 'email-conversation')
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].options.body.subject, 'Assunto')
  assert.equal(f.data.size, 0)
})

test('late acceptance cannot be returned into a changed session and retains its reference', async () => {
  const f = fixture(async () => { f.expire(); return { messageId: 'accepted', status: 'accepted' } })
  await assert.rejects(f.adapter.send('email', 'recipient@kloel.test', 'Mensagem', { subject: 'Assunto' }), /superseded/)
  assert.equal(f.data.size, 1)
})

test('unsupported SMS never calls a provider', async () => {
  const f = fixture(async () => assert.fail('unexpected request'))
  await assert.rejects(f.adapter.send('sms', '+5511999990000', 'Mensagem'), /não está disponível/)
  assert.equal(f.calls.length, 0)
})
