import test from 'node:test';
import assert from 'node:assert/strict';
import { afterConversationFixture, output } from './fixtures/after-conversation.js';

const ok = (r: any) => { assert.equal(r.statusCode, 200, r.body); return r.json(); };
type Scenario = { name: string; mutate: (p: any) => void; succeeds?: boolean };
const scenarios: Scenario[] = [
  ...['incomplete', 'failed', 'queued', 'in_progress', 'cancelled'].map(status => ({ name: `Response ${status} with valid JSON`, mutate: (p: any) => { p.status = status; } })),
  { name: 'missing terminal statuses', mutate: p => { delete p.status; delete p.output[0].status; } },
  { name: 'message incomplete', mutate: p => { p.output[0].status = 'incomplete'; } },
  { name: 'non-assistant message', mutate: p => { p.output[0].role = 'user'; } },
  { name: 'message missing role', mutate: p => { delete p.output[0].role; } },
  { name: 'completed Response contradicts error', mutate: p => { p.error = { code: 'server_error', message: 'private-provider-secret' }; } },
  { name: 'completed Response contradicts incomplete_details', mutate: p => { p.incomplete_details = { reason: 'max_output_tokens' }; } },
  { name: 'completed Response contradicts refusal', mutate: p => { p.refusal = 'private-provider-secret'; } },
  { name: 'valid text mixed with refusal content', mutate: p => { p.output[0].content.push({ type: 'refusal', refusal: 'private-provider-secret' }); } },
  { name: 'refusal attached to text', mutate: p => { p.output[0].content[0].refusal = 'private-provider-secret'; } },
  { name: 'completed analysis accompanied by tool call', mutate: p => { p.output.push({ type: 'function_call', name: 'unexpected_action', status: 'completed', arguments: '{}' }); } },
  { name: 'nonterminal reasoning item', mutate: p => { p.output.unshift({ type: 'reasoning', status: 'in_progress', summary: [] }); } },
  { name: 'terminal response and assistant message', mutate: () => {}, succeeds: true },
  { name: 'terminal response with opaque reasoning then completed assistant', mutate: p => { p.output.unshift({ id: 'rs_synthetic', type: 'reasoning', summary: [] }); }, succeeds: true },
];

for (const scenario of scenarios) test(`analysis envelope: ${scenario.name}`, async t => {
  const f = await afterConversationFixture(t); ok(await f.configureAfter());
  const { conversation } = await f.seedConversation();
  const close = ok(await f.close(conversation)).operation;
  f.analysisHooks.model = async body => {
    const input = JSON.parse(body.input[0].content);
    const payload = await output({ summary: { text: 'Resumo sintético terminal.', sourceMessageIds: [input.messages[0].id] }, tagProposals: [] }).json();
    scenario.mutate(payload); return Response.json(payload);
  };
  const record = await f.worker.runOne(f.actor.tenantId, close.closureId);
  const view = ok(await f.analyses(conversation.id)).items[0];
  assert.equal(record?.status, scenario.succeeds ? 'succeeded' : 'failed');
  assert.equal(view.status, scenario.succeeds ? 'succeeded' : 'failed');
  assert.equal(view.applicable, !!scenario.succeeds);
  if (scenario.succeeds) { assert.equal(view.reasonCode, null); assert.equal(view.result.summary.text, 'Resumo sintético terminal.'); }
  else { assert.equal(view.reasonCode, 'analysis_output_invalid'); assert.equal(view.result, null); }
  assert.equal(JSON.stringify(view).includes('private-provider-secret'), false);
  assert.equal(record?.dispatchCount, 1);
  assert.equal(f.store.list(f.actor.tenantId, 'after-analysis-budgets')[0].count, 1);
  await f.worker.runOne(f.actor.tenantId, close.closureId);
  ok(await f.operation(close.key));
  assert.equal(f.analysisCalls.length, 1, 'failed validation and receipt recovery never resend the model request');
  assert.equal(f.store.list(f.actor.tenantId, 'after-analysis-budgets')[0].count, 1);
});
