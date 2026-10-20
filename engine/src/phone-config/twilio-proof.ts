import { z } from 'zod';

export class PhoneConfigError extends Error {
  constructor(readonly status: number, readonly code: string, message = 'Consulte o cadastro atual e revise esta operação antes de continuar.') { super(message); }
}
const accountSid = z.string().regex(/^AC[0-9a-fA-F]{32}$/);
const numberSid = z.string().regex(/^PN[0-9a-fA-F]{32}$/);
const e164 = z.string().regex(/^\+[1-9]\d{7,14}$/);
const answer = z.object({ incoming_phone_numbers: z.array(z.object({ sid: numberSid, account_sid: accountSid, phone_number: e164,
  capabilities: z.object({ voice: z.boolean(), sms: z.boolean().optional() }) })).max(100), next_page_uri: z.null() });
export type OwnershipProof = { checkedAt: string; capabilities: ('voice' | 'sms')[]; assertCurrent: () => void };

/** Read-only, fixed-host proof. No caller-ID endpoint, redirects or provider writes. */
export async function verifyPhoneOwnership(tenantId: string, number: string, providerNumberId: string, assertAccess: () => void): Promise<OwnershipProof> {
  assertAccess();
  const account = process.env.TWILIO_ACCOUNT_SID?.trim(), token = process.env.TWILIO_AUTH_TOKEN?.trim(), boundTenant = process.env.PROVIDER_TENANT_ID?.trim();
  if (!accountSid.safeParse(account).success || !token || !boundTenant) throw new PhoneConfigError(503, 'phone_provider_not_configured', 'Configure a conta de telefonia no servidor.');
  if (boundTenant !== tenantId) throw new PhoneConfigError(403, 'phone_provider_tenant_mismatch', 'A conta de telefonia não pertence a esta organização.');
  if (!numberSid.safeParse(providerNumberId).success || !e164.safeParse(number).success) throw new PhoneConfigError(409, 'phone_ownership_unconfirmed', 'O cadastro legado precisa de um SID válido para receber novo roteamento.');
  const assertCurrent = () => {
    assertAccess();
    if (process.env.TWILIO_ACCOUNT_SID?.trim() !== account || process.env.TWILIO_AUTH_TOKEN?.trim() !== token || process.env.PROVIDER_TENANT_ID?.trim() !== boundTenant)
      throw new PhoneConfigError(409, 'phone_provider_changed', 'A configuração do provedor mudou durante a consulta.');
  };
  const url = new URL(`https://api.twilio.com/2010-04-01/Accounts/${account}/IncomingPhoneNumbers.json`);
  url.search = new URLSearchParams({ PhoneNumber: number, PageSize: '100' }).toString();
  let response: Response;
  try {
    assertCurrent();
    response = await fetch(url, { method: 'GET', headers: { authorization: `Basic ${Buffer.from(`${account}:${token}`).toString('base64')}`, accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  } catch { assertCurrent(); throw new PhoneConfigError(502, 'phone_ownership_unconfirmed', 'Não foi possível confirmar a propriedade do número. Nenhuma configuração local foi gravada por esta consulta.'); }
  assertCurrent();
  if (response.status !== 200 || response.redirected || response.url && response.url !== url.href) throw new PhoneConfigError(502, 'phone_ownership_unconfirmed');
  let value: unknown;
  try {
    const reader = response.body?.getReader(); if (!reader) throw new Error('body');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const part = await reader.read(); assertCurrent(); if (part.done) break;
        size += part.value.byteLength; if (size > 262144) throw new Error('body_limit'); chunks.push(part.value);
      }
      value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  } catch { assertCurrent(); throw new PhoneConfigError(502, 'phone_ownership_unconfirmed'); }
  assertCurrent();
  const parsed = answer.safeParse(value);
  if (!parsed.success || parsed.data.incoming_phone_numbers.length !== 1) throw new PhoneConfigError(502, 'phone_ownership_unconfirmed');
  const found = parsed.data.incoming_phone_numbers[0];
  if (found.account_sid !== account || found.sid !== providerNumberId || found.phone_number !== number || !found.capabilities.voice) throw new PhoneConfigError(502, 'phone_ownership_unconfirmed');
  return { checkedAt: new Date().toISOString(), capabilities: found.capabilities.sms ? ['voice', 'sms'] : ['voice'], assertCurrent };
}
