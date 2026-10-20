import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { buildApp } from '../src/app.js';
import { chatTechnicalInstructions } from '../src/agent-technical.js';

function env(t: any, values: Record<string, string | undefined>) {
  const before = Object.fromEntries(Object.keys(values).map(k => [k, process.env[k]]));
  for (const [k, v] of Object.entries(values)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  t.after(() => { for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
}

test('the phone worker gets the Técnico settings the app saved, with ambient volume converted from the 0–2 slider', async t => {
  env(t, { INTERNAL_TOKEN: 'internal-test-token', PROVIDER_TENANT_ID: 'tenant-tech', KLOEL_PHONE_AGENT_ID: undefined });
  const store = new Store(), app = await buildApp(store); t.after(() => app.close());
  const agent = store.create('tenant-tech', 'agents', { name: 'Clara', prompt: 'p', initialMessage: 'Olá', language: 'pt-BR', voice: 'marin', tools: [], rules: [], settings: { temperature: 0.1, recordingEnabled: false }, channels: ['phone'], status: 'active' });
  env(t, { KLOEL_PHONE_AGENT_ID: agent.id });
  const save = (technical: Record<string, unknown>) => {
    for (const row of store.list('tenant-tech', 'agent-editor-states')) store.remove('tenant-tech', 'agent-editor-states', row.id);
    store.create('tenant-tech', 'agent-editor-states', { agentId: agent.id, state: { technical } });
  };
  const read = async () => (await app.inject({ method: 'GET', url: '/api/v1/internal/phone/agent', headers: { 'x-kloel-internal': 'internal-test-token' } })).json().technical;
  save({ ambientSound: 'office', ambientVolume: 1, sensitivity: 0.2, speechSpeed: 0.7, responseSpeed: 'patient', noInterruptions: true, protectGreeting: true, dtmf: true, maxCallDuration: 15, silenceTimeout: 30, technicalTerms: ['Caldas Novas'], preciseExtraction: [{ id: 'a', name: 'Email', example: 'maria@exemplo.com.br' }, { id: 'b', name: 'nome com espaço', example: 'x' }] });
  const tech = await read();
  assert.equal(tech.ambientVolume, 30, 'slider 1 (normal) plays the clip at 30%');
  assert.equal(tech.sensitivity, 0.2);
  assert.equal(tech.speechSpeed, 0.7);
  assert.equal(tech.responseSpeed, 'patient');
  assert.equal(tech.maxCallDuration, 15);
  assert.equal(tech.silenceTimeout, 30);
  assert.deepEqual(tech.technicalTerms, ['Caldas Novas']);
  assert.deepEqual(tech.preciseExtraction, [{ name: 'Email', example: 'maria@exemplo.com.br' }]);
  assert.equal(tech.noInterruptions && tech.protectGreeting && tech.dtmf, true);
  save({ ambientSound: 'office', ambientVolume: 0 }); assert.equal((await read()).ambientVolume, 0, 'volume 0 stays 0');
  save({ ambientSound: 'office', ambientVolume: 2 }); assert.equal((await read()).ambientVolume, 60);
  save({ ambientSound: 'office', ambientVolume: 50 }); assert.equal((await read()).ambientVolume, undefined, 'values outside the slider are ignored');
});

test('WhatsApp/webchat instructions carry Criatividade and Processamento preciso from the editor', () => {
  const store = new Store();
  const agent = store.create('t1', 'agents', { name: 'Clara', settings: { temperature: 0.9 } });
  assert.equal(chatTechnicalInstructions(store, 't1', { id: 'other', settings: {} }), '');
  store.create('t1', 'agent-editor-states', { agentId: agent.id, state: { technical: { temperature: 0.1, preciseExtraction: [{ id: 'a', name: 'CPF', example: '000.000.000-00' }, { id: 'b', name: 'inválido!', example: '' }] } } });
  const text = chatTechnicalInstructions(store, 't1', agent);
  assert.match(text, /Estilo: respostas naturais e variadas\./, 'the runtime temperature (agent settings) wins over the editor copy');
  assert.match(text, /colete com precisão estas informações e confirme cada valor com a pessoa antes de usá-lo: CPF \(ex\.: 000\.000\.000-00\)\./);
  assert.doesNotMatch(text, /inválido/);
  assert.match(chatTechnicalInstructions(store, 't1', { ...agent, settings: { temperature: 0.2 } }), /objetivas, previsíveis/);
  assert.match(chatTechnicalInstructions(store, 't1', { ...agent, settings: { temperature: 1.5 } }), /criativas e espontâneas/);
  assert.doesNotMatch(chatTechnicalInstructions(store, 't2', agent), /CPF/, 'another tenant never sees this editor state');
});
