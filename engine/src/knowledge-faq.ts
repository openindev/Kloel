import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Store } from './store.js';
import { DomainError } from './domains.js';
import { requireRequestPermission } from './memberships/access.js';
import { MembershipError } from './memberships/service.js';

const CATEGORIES: [RegExp, string][] = [
  [/pre[cç]o|plano|r\$|mensal|anual/i, 'Preços e planos'],
  [/contato|telefone|e-mail|email|whatsapp|endere[cç]o|cep/i, 'Contato'],
  [/reembolso|devolu|cancel|troca|garantia/i, 'Políticas'],
  [/pagamento|pix|boleto|cart[aã]o|fatura/i, 'Pagamento'],
  [/hor[aá]rio|suporte|atend/i, 'Atendimento'],
];

export type FaqEntry = { question: string; answer: string; category: string; origin: string };

function cleanSource(text: string) {
  return text.replace(/o texto extra[ií]do da imagem é\s*:/gi, '\n').replace(/descri[cç][aã]o da imagem\s*:[^\n]*/gi, '\n').replace(/transcri[cç][aã]o\s*:/gi, '\n');
}
function factsOf(text: string) {
  return cleanSource(text).split(/\n+|(?<=[.!?])\s+/).map(part => part.replace(/\s+/g, ' ').trim()).filter(part => part.length >= 12 && (/\d|[?]/.test(part) || part.length >= 40)).slice(0, 24);
}
function questionFor(fact: string) {
  if (/troca|devolu/i.test(fact) && /\d+\s*dias/i.test(fact)) return 'Qual o prazo para troca?';
  if (/frete/i.test(fact) && /gr[aá]tis|gratuit/i.test(fact)) return 'Tem frete grátis?';
  if (/hor[aá]rio|segunda a sexta|atendimento/i.test(fact)) return 'Qual o horário de atendimento?';
  if (/r\$|pre[cç]o|custa|plano/i.test(fact)) return 'Qual o preço?';
  if (fact.endsWith('?')) return fact.slice(0, 180);
  return `O que a fonte informa sobre: ${fact.replace(/[.?!]+$/, '').slice(0, 120)}?`;
}
function answerFor(fact: string) {
  const days = fact.match(/(\d+)\s*dias/i);
  if (/troca|devolu/i.test(fact) && days) return `Até ${days[1]} dias após a entrega.`;
  const money = fact.match(/R\$\s*\d+(?:[.,]\d+)*/);
  if (/frete/i.test(fact) && /gr[aá]tis|gratuit/i.test(fact) && money) return `Sim, para compras acima de ${money[0].replace(/\s+/g, ' ')}.`;
  return fact.slice(0, 2000);
}
export function draftFaq(text: string, origin: string): FaqEntry[] {
  const out = factsOf(text).map(fact => ({ question: questionFor(fact), answer: answerFor(fact), category: CATEGORIES.find(([pattern]) => pattern.test(fact))?.[1] ?? 'Geral', origin }));
  if (!out.length && text.trim().length >= 20) out.push({ question: 'O que esta fonte informa?', answer: text.trim().slice(0, 2000), category: 'Geral', origin });
  return out;
}

async function modelFaq(text: string, origin: string, options: { fetch?: typeof fetch; apiKey?: string | null; model?: string | null }): Promise<FaqEntry[] | null> {
  const key = options.apiKey === undefined ? process.env.OPENAI_API_KEY : options.apiKey;
  const model = options.model === undefined ? process.env.OPENAI_MODEL : options.model;
  if (!key || !model) return null;
  const call = options.fetch ?? globalThis.fetch;
  try {
    const response = await call('https://api.openai.com/v1/responses', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45000), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, store: false, max_output_tokens: 4000, instructions: 'Extraia várias perguntas e respostas factuais em português do Brasil, uma por fato (prazo, frete, horário, preço, contato). A resposta é curta e direta, sem despejar o texto bruto. Não invente. Responda só JSON: {"items":[{"question":"","answer":"","category":"Preços e planos|Contato|Políticas|Pagamento|Atendimento|Geral"}]}. No máximo 24 itens.', input: [{ role: 'user', content: text.slice(0, 24000) }] }) });
    if (!response.ok) return null;
    const data = await response.json() as { output?: { type?: string; content?: { type?: string; text?: string }[] }[] };
    const raw = (data.output ?? []).flatMap(item => item.type === 'message' ? item.content ?? [] : []).filter(part => part.type === 'output_text').map(part => part.text ?? '').join('\n');
    const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as { items?: { question?: string; answer?: string; category?: string }[] };
    const items = (parsed.items ?? []).filter(item => item.question && item.answer).slice(0, 24).map(item => ({ question: String(item.question).slice(0, 180), answer: String(item.answer).slice(0, 2000), category: CATEGORIES.some(([, name]) => name === item.category) ? String(item.category) : 'Geral', origin }));
    return items.length ? items : null;
  } catch { return null; }
}

const tagFor = (sourceId: string) => `from:${sourceId}`.slice(0, 80);

export async function generateFaqForSource(store: Store, tenantId: string, sourceId: string, options: { fetch?: typeof fetch; apiKey?: string | null; model?: string | null } = {}) {
  const source = store.get(tenantId, 'knowledge', sourceId);
  if (!source || (source.type !== 'url' && source.type !== 'document')) throw new DomainError(404, 'source_not_found', 'Fonte não encontrada.');
  const content = String(source.content ?? '').trim();
  if (!content) throw new DomainError(422, 'empty_source', 'A fonte ainda não tem texto para gerar informações.');
  const origin = source.type === 'url' ? String(source.url ?? source.title ?? 'site').replace(/^https?:\/\//, '').slice(0, 60) : String(source.document && typeof source.document === 'object' ? (source.document as { filename?: string }).filename ?? source.title : source.title).slice(0, 60);
  const draft = draftFaq(content, origin);
  const items = await modelFaq(content, origin, options) ?? draft;
  const marker = tagFor(sourceId);
  const removedIds = store.list(tenantId, 'knowledge').filter(row => row.type === 'text' && Array.isArray(row.tags) && row.tags.includes('auto') && row.tags.includes(marker)).map(row => String(row.id));
  const created = store.transaction(() => {
    for (const id of removedIds) store.remove(tenantId, 'knowledge', id);
    return items.map(item => store.create(tenantId, 'knowledge', {
      title: item.question.slice(0, 200), type: 'text', content: item.answer, agentId: source.agentId ?? null,
      tags: ['auto', item.category.slice(0, 40), `origem:${origin}`.slice(0, 80), marker],
      ingestionStatus: 'extracted', indexed: false, chunkCount: 0,
    }));
  });
  return { created: created.length, pages: Number((source.extraction as { pageCount?: number } | null)?.pageCount ?? (source.type === 'url' ? 1 : 0)), removedIds, items: created };
}

const bodySchema = z.object({ agentId: z.string().min(1).max(128), sourceId: z.string().min(1).max(128) }).strict();

export async function registerKnowledgeFaq(app: FastifyInstance, store: Store): Promise<void> {
  app.post('/api/v1/knowledge/generate-info', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const actor = requireRequestPermission(store, request, 'knowledge:write');
      const input = bodySchema.parse(request.body);
      const source = store.get(actor.tenantId, 'knowledge', input.sourceId);
      if (!source || source.agentId !== input.agentId) throw new DomainError(404, 'source_not_found', 'Fonte não encontrada neste assistente.');
      const result = await generateFaqForSource(store, actor.tenantId, input.sourceId);
      return reply.send(result);
    } catch (error) {
      if (error instanceof DomainError || error instanceof MembershipError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      if (error instanceof z.ZodError) return reply.code(400).send({ error: { code: 'validation_error', message: 'Invalid request' } });
      throw error;
    }
  });
}
