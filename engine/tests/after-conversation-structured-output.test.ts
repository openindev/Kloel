import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterConversationFixture, output } from './fixtures/after-conversation.js';

const ok = (r: any) => { assert.equal(r.statusCode, 200, r.body); return r.json(); };
const expectedFormat = {
  type: 'json_schema', name: 'after_conversation_analysis', strict: true,
  schema: {
    type: 'object', additionalProperties: false, required: ['summary', 'tagProposals'],
    properties: {
      summary: {
        type: 'object', additionalProperties: false, required: ['text', 'sourceMessageIds'],
        properties: { text: { type: 'string' }, sourceMessageIds: { type: 'array', items: { type: 'string' } } },
      },
      tagProposals: {
        type: 'array', items: {
          type: 'object', additionalProperties: false, required: ['tag', 'sourceMessageIds'],
          properties: { tag: { type: 'string' }, sourceMessageIds: { type: 'array', items: { type: 'string' } } },
        },
      },
    },
  },
};
const valueFor = (body: any) => {
  const input = JSON.parse(body.input[0].content);
  return { summary: { text: 'Resumo sintético válido.', sourceMessageIds: [input.messages[0].id] }, tagProposals: [] as Array<{ tag: string; sourceMessageIds: string[] }> };
};

// Mechanism counterexample only: this controlled provider is not the unexplained live failure.
test('strict request format prevents a controlled transport from returning fenced JSON', async t => {
  const f = await afterConversationFixture(t); ok(await f.configureAfter());
  const { conversation } = await f.seedConversation(), op = ok(await f.close(conversation)).operation;
  f.analysisHooks.model = async body => {
    const p = await output(valueFor(body)).json();
    if (JSON.stringify(body.text?.format) !== JSON.stringify(expectedFormat)) p.output[0].content[0].text = '```json\n' + p.output[0].content[0].text + '\n```';
    return Response.json(p);
  };
  const row = await f.worker.runOne(f.actor.tenantId, op.closureId);
  assert.equal(row?.status, 'succeeded', 'the strict format is requested before the single model dispatch');
  const request = f.analysisCalls[0]; assert.deepEqual(request.text, { format: expectedFormat });
  assert.deepEqual(Object.keys(request).sort(), ['input', 'instructions', 'max_output_tokens', 'model', 'store', 'text']);
  assert.equal(request.store, false); assert.equal(request.max_output_tokens, 3000);
  assert.equal(row?.reasonDetail, null);
  await f.worker.runOne(f.actor.tenantId, op.closureId); ok(await f.operation(op.key));
  assert.equal(f.analysisCalls.length, 1); assert.equal(row?.dispatchCount, 1);
});

type Scenario = { name: string; detail: string; mutate?: (p: any, value: ReturnType<typeof valueFor>) => void; response?: () => Response };
const scenarios: Scenario[] = [
  { name: 'missing provider body', detail: 'provider_body_missing', response: () => new Response(null) },
  { name: 'oversized provider body', detail: 'provider_body_too_large', response: () => new Response('x'.repeat(65537)) },
  { name: 'invalid provider JSON', detail: 'provider_json_invalid', response: () => new Response('private-provider-text') },
  { name: 'incomplete response with valid result', detail: 'response_envelope_invalid', mutate: p => { p.status = 'incomplete'; } },
  { name: 'refusal contradicting completed response', detail: 'response_envelope_invalid', mutate: p => { p.refusal = 'private-provider-text'; } },
  { name: 'unexpected tool output', detail: 'output_items_invalid', mutate: p => { p.output.push({ type: 'function_call', arguments: 'private-provider-text' }); } },
  { name: 'refusal content accompanying valid JSON', detail: 'assistant_message_invalid', mutate: p => { p.output[0].content.push({ type: 'refusal', refusal: 'private-provider-text' }); } },
  { name: 'oversized output text', detail: 'output_text_invalid', mutate: p => { p.output[0].content[0].text = 'x'.repeat(32769); } },
  { name: 'fences still rejected after structured request', detail: 'output_json_invalid', mutate: p => { p.output[0].content[0].text = '```json\n' + p.output[0].content[0].text + '\n```'; } },
  { name: 'unexpected result property', detail: 'result_schema_invalid', mutate: (_p, v) => { (v as any).private = 'private-provider-text'; } },
  { name: 'invalid source UUID', detail: 'result_schema_invalid', mutate: (_p, v) => { v.summary.sourceMessageIds = ['private-provider-text']; } },
  { name: 'source UUID absent from original input', detail: 'source_references_invalid', mutate: (_p, v) => { v.summary.sourceMessageIds = [randomUUID()]; } },
  { name: 'duplicate source reference', detail: 'source_references_invalid', mutate: (_p, v) => { v.summary.sourceMessageIds.push(v.summary.sourceMessageIds[0]); } },
  { name: 'unapproved tag', detail: 'tag_proposals_invalid', mutate: (_p, v) => { v.tagProposals = [{ tag: 'private-provider-text', sourceMessageIds: v.summary.sourceMessageIds }]; } },
  { name: 'duplicate tag proposal', detail: 'tag_proposals_invalid', mutate: (_p, v) => { const tag = { tag: 'interessado', sourceMessageIds: v.summary.sourceMessageIds }; v.tagProposals = [tag, tag]; } },
];

for (const scenario of scenarios) test(`sanitized internal output stage: ${scenario.name}`, async t => {
  const f = await afterConversationFixture(t); ok(await f.configureAfter());
  const { conversation } = await f.seedConversation(), op = ok(await f.close(conversation)).operation;
  f.analysisHooks.model = async body => {
    if (scenario.response) return scenario.response();
    const value = valueFor(body), p = await output(value).json(), original = p.output[0].content[0].text;
    scenario.mutate?.(p, value);
    if (p.output[0].content[0].text === original) p.output[0].content[0].text = JSON.stringify(value);
    return Response.json(p);
  };
  const row = await f.worker.runOne(f.actor.tenantId, op.closureId);
  assert.equal(row?.status, 'failed'); assert.equal(row?.reasonCode, 'analysis_output_invalid');
  assert.equal(row?.reasonDetail, scenario.detail); assert.equal(row?.result, null);
  const publicResult = ok(await f.analyses(conversation.id)).items[0], receipt = ok(await f.operation(op.key));
  assert.equal(publicResult.reasonCode, 'analysis_output_invalid'); assert.equal(publicResult.result, null);
  assert.equal(Object.hasOwn(publicResult, 'reasonDetail'), false); assert.equal(Object.hasOwn(receipt, 'reasonDetail'), false);
  assert.equal(JSON.stringify([row, publicResult, receipt]).includes('private-provider-text'), false);
  await f.worker.runOne(f.actor.tenantId, op.closureId); f.worker.recover(); await f.worker.tick();
  assert.equal(f.analysisCalls.length, 1); assert.equal(row?.dispatchCount, 1);
  assert.equal(f.store.list(f.actor.tenantId, 'after-analysis-budgets')[0].count, 1);
});

test('empty allowedTags still requests a valid structural schema and accepts a valid empty proposal list', async t => {
  const f = await afterConversationFixture(t); ok(await f.configureAfter(true, 0, []));
  const { conversation } = await f.seedConversation(), op = ok(await f.close(conversation)).operation;
  assert.equal((await f.worker.runOne(f.actor.tenantId, op.closureId))?.status, 'succeeded');
  assert.deepEqual(f.analysisCalls[0].text?.format, expectedFormat);
  assert.deepEqual(ok(await f.analyses(conversation.id)).items[0].result.tagProposals, []);
});
