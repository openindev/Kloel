import test from 'node:test'
import assert from 'node:assert/strict'
import { areaForPath } from '../src/services/casca/data'

test('each app URL loads the data area of its own page', () => {
  assert.equal(areaForPath('/app'), 'overview')
  assert.equal(areaForPath('/app/email-agents'), 'email')
  assert.equal(areaForPath('/app/email-agents/mbx_1/inbox'), 'email', 'mailbox inbox is E-Mail IA, not Conversas')
  assert.equal(areaForPath('/app/inbox'), 'conversations')
  assert.equal(areaForPath('/app/agents/agt_1/general'), 'agents')
  assert.equal(areaForPath('/app/scheduling'), 'scheduling')
  assert.equal(areaForPath('/app/billing/portal'), 'billing')
})
