import test from 'node:test'
import assert from 'node:assert/strict'
import { compileAgentRules } from '../src/services/casca/rules'
import { makeAgent } from '../src/data/seed/defaults'
import { agentPayload } from '../src/services/engine/agents'

test('all behavioral rule controls compile into the runtime instruction contract without inventing execution', () => {
  const agent = makeAgent('synthetic', 'Ana', 'voice', 'Empresa')
  agent.rules = { ...agent.rules, aiDisclosure: 'start_consent', style: 'empathetic', offTopic: { active: true, behavior: 'EXPLAIN_SCOPE', noteAndOffer: true, smallTalk: 'REDIRECT_FRIENDLY' }, angry: { active: true, behavior: 'SHOW_EMPATHY_OFFER_SOLUTION', offerTransfer: true }, sales: { active: true, reaction: 'DECLINE_AND_LOG', hangUp: true, handleCompetitors: true, competitorBehavior: 'STAY_NEUTRAL' }, pronunciation: [{ id: 'p1', term: 'Kloel', pronunciation: 'clô-el' }], custom: [{ id: 'c1', title: 'Horário', condition: 'Se perguntarem', instruction: 'Confirme o horário nas fontes.', active: false }] }
  const rules = compileAgentRules(agent), text = rules.map(r => r.instruction).join('\n')
  assert.doesNotThrow(() => agentPayload({ rules }))
  assert.match(text, /solicite consentimento/); assert.match(text, /empático/); assert.match(text, /quais assuntos/); assert.match(text, /compreensão/); assert.match(text, /pronúncia "clô-el"/)
  assert.match(text, /somente se houver ferramenta/); assert.match(text, /Não afirme ter desligado sem confirmação/)
  assert.equal(rules.find(r => r.name === 'Horário')?.enabled, false)
  assert.deepEqual(compileAgentRules(agent), rules)
})
test('web search instruction preserves source preferences but does not claim an enforced network allowlist', () => {
  const agent = makeAgent('synthetic', 'Ana', 'chat', 'Empresa')
  agent.webSearch = { enabled: true, instruction: 'Preços públicos', allowedDomains: ['https://example.test'] }
  const rule = compileAgentRules(agent).find(r => r.name === 'Pesquisa na web')!
  assert.match(rule.instruction, /Priorize estas fontes: https:\/\/example.test/)
  assert.match(rule.instruction, /Não afirme uma busca que não ocorreu/)
})
