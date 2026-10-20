import type { Store } from './store.js';

/**
 * Técnico tab → WhatsApp/webchat replies. The phone worker gets the same settings through phone-runtime.ts (editorRuntime);
 * chat assistants only show "Criatividade" and "Processamento preciso", so only those two reach the chat instructions.
 * Values come from the editor state the app saved; anything outside the validated shape is ignored.
 */
const EXTRACTION_NAME = /^[A-Za-z0-9_-]{1,64}$/;

export function chatTechnicalInstructions(store: Store, tenantId: string, agent: { id?: unknown; settings?: unknown }): string {
  const row = store.list(tenantId, 'agent-editor-states').find(r => r.agentId === agent.id);
  const t = ((row?.state as Record<string, any> | undefined)?.technical ?? {}) as Record<string, any>;
  const setting = (agent.settings as Record<string, unknown> | undefined)?.temperature;
  const temperature = [setting, t.temperature].find(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 2) as number | undefined;
  const fields = (Array.isArray(t.preciseExtraction) ? t.preciseExtraction : [])
    .filter((r: any) => r && typeof r.name === 'string' && EXTRACTION_NAME.test(r.name)).slice(0, 30)
    .map((r: any) => `${r.name} (ex.: ${String(r.example ?? '').replace(/\s+/g, ' ').slice(0, 200) || '-'})`);
  const lines: string[] = [];
  if (temperature !== undefined) lines.push(`Estilo: ${temperature < 0.5 ? 'respostas objetivas, previsíveis e fiéis ao roteiro.' : temperature < 1.2 ? 'respostas naturais e variadas.' : 'respostas criativas e espontâneas.'}`);
  if (fields.length) lines.push(`Durante a conversa, colete com precisão estas informações e confirme cada valor com a pessoa antes de usá-lo: ${fields.join('; ')}.`);
  return lines.length ? `\n${lines.join('\n')}` : '';
}
