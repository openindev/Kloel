import test from 'node:test'
import assert from 'node:assert/strict'
import { createEngineClient, EngineError } from '../src/services/engine/http'

test('durable voice operation keys containing dots and colons retain their exact same-origin route', async () => {
  const paths: string[] = []
  const client = createEngineClient(async (url, init) => {
    paths.push(String(url)); assert.equal(init?.credentials, 'include'); assert.equal(init?.redirect, 'error')
    assert.equal(new URL(String(url), 'http://localhost').pathname, String(url))
    return Response.json({ ok: true })
  })
  for (const key of ['voice.local:operation-001', 'a' + ':'.repeat(127), 'agent..operation-123']) {
    const path = '/ai/realtime/operations/' + encodeURIComponent(key)
    for (const suffix of ['', '/cancel', '/heartbeat']) {
      await client(path + suffix, suffix ? { method: 'POST', body: {} } : undefined)
      assert.equal(paths.at(-1), '/api/v1' + path + suffix)
    }
  }
  assert.equal(paths.length, 9)
})

test('voice key path support does not admit traversal, encoded separators, other routes or URL destinations', async () => {
  let dispatched = 0
  const client = createEngineClient(async () => { dispatched++; return Response.json({}) })
  const base = '/ai/realtime/operations/'
  for (const path of [
    base + '..', base + '../auth/me', base + 'abcde%2ffgh', base + 'abcde%5cfgh',
    base + 'abcde%2efgh', base + 'abcde%253afgh', base + 'abcde%00fgh',
    base + 'abcde%23fgh', base + 'abcde%3ffgh', base + 'abcde%3afgh/../../auth/me',
    base + 'abcde%3afgh/unknown', base + 'a' + '%3A'.repeat(128), base + 'abc%3A',
    '/ai/chat/operations/voice%3Aoperation', '/account/profile.ext',
    'https://example.test/ai/realtime/operations/voice%3Aoperation', '//example.test/voice%3Aoperation',
  ]) await assert.rejects(client(path), (error: unknown) => error instanceof EngineError && error.code === 'invalid_path')
  assert.equal(dispatched, 0)
})
