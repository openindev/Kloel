/** Only these two bounded numeric fields may cross the provider/receipt boundary. */
export type GraphSendDiagnostics = { graphCode?: number; graphSubcode?: number };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const code = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 2147483647;
const maxBytes = 16 * 1024;
const maxReads = 128;
const deadlineMs = 1000;

export function graphSendDiagnostics(value: unknown): GraphSendDiagnostics {
  if (!object(value)) return {};
  return { ...(code(value.graphCode) ? { graphCode: value.graphCode } : {}), ...(code(value.graphSubcode) ? { graphSubcode: value.graphSubcode } : {}) };
}

/** A 4xx refusal is already observed. Failed/oversized/slow body reads cannot erase it. */
export async function readGraphSendDiagnostics(response: Response): Promise<GraphSendDiagnostics> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    reader = response.body?.getReader();
    if (!reader) return {};
    const bodyReader = reader;
    const reading = (async (): Promise<GraphSendDiagnostics> => {
      const chunks: Uint8Array[] = []; let size = 0;
      for (let reads = 0; reads < maxReads; reads++) {
        const chunk = await bodyReader.read();
        if (chunk.done) {
          const bytes = new Uint8Array(size); let offset = 0;
          for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
          const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
          if (!object(value) || !object(value.error)) return {};
          return graphSendDiagnostics({ graphCode: value.error.code, graphSubcode: value.error.error_subcode });
        }
        if (!(chunk.value instanceof Uint8Array) || (size += chunk.value.byteLength) > maxBytes) return {};
        chunks.push(chunk.value);
      }
      return {};
    })();
    const deadline = new Promise<GraphSendDiagnostics>(resolve => { timer = setTimeout(() => resolve({}), deadlineMs); });
    return await Promise.race([reading, deadline]);
  } catch { return {}; }
  finally {
    if (timer) clearTimeout(timer);
    // Stream disposal is best-effort; never await a provider-controlled cancel hook.
    try { void reader?.cancel().catch(() => undefined); } catch { /* no remote error retained */ }
    try { reader?.releaseLock(); } catch { /* pending read may still hold the lock */ }
  }
}

export function graphSendRefusal(diagnostics: GraphSendDiagnostics): { code: string; message: string } {
  switch (diagnostics.graphCode) {
    case 131030: return { code: 'provider_recipient_not_allowed', message: 'A Meta recusou o destinatário: confira a lista de destinatários permitidos do número de teste.' };
    case 131047: return { code: 'provider_template_required', message: 'A Meta exige um template aprovado porque a janela de atendimento está encerrada. Nenhuma mensagem foi repetida.' };
    case 190: return { code: 'provider_token_invalid', message: 'A Meta recusou o token de acesso. Confira a validade da credencial no servidor.' };
    case 10: case 200: case 131005: return { code: 'provider_permission_denied', message: 'A Meta recusou a autorização do envio. Confira as permissões do aplicativo e do número.' };
    default: return { code: 'provider_rejected', message: 'A Meta recusou a mensagem. Consulte o código numérico do recibo, quando disponível.' };
  }
}
