/**
 * Phone-number provider abstraction.
 * - didlogic: the number included in a paid plan (DIDLOGIC_API_KEY). Inbound destination = LiveKit SIP URI.
 * - twilio:   extra numbers resold with markup (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN), BR Local Business bundle
 *             (TWILIO_BR_BUNDLE_SID, TWILIO_BR_ADDRESS_SID) attached to the Elastic SIP trunk to LiveKit (TWILIO_SIP_TRUNK_SID).
 * Every network call is bounded and returns provider-neutral shapes; no credential is ever returned to callers.
 */
export type NumberProviderName = 'didlogic' | 'twilio';
export type AvailableNumber = { phoneNumber: string; locality: string | null; region: string | null; provider: NumberProviderName; providerRef?: string };
export type PurchasedNumber = { phoneNumber: string; provider: NumberProviderName; providerNumberId: string; locality: string | null; monthlyCostUsd: number | null };
export class NumberProviderError extends Error { constructor(readonly statusCode: number, readonly code: string, message: string) { super(message); } }
const fail = (status: number, code: string, message: string): never => { throw new NumberProviderError(status, code, message); };
const e164 = (value: string) => { const d = String(value).replace(/\D/g, ''); return d ? `+${d}` : ''; };

/** Every provider request goes through here so tests swap the transport (never a real purchase/release in tests). */
export const numberHttp: { fetch: typeof fetch } = { fetch: (input, init) => fetch(input, init) };
async function call(url: string, init: RequestInit, timeoutMs = 20000) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await numberHttp.fetch(url, { ...init, signal: ac.signal });
    const text = await res.text(); let body: unknown = null; try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    return { status: res.status, ok: res.ok, body: body as Record<string, any> | null };
  } catch { return fail(502, 'number_provider_unreachable', 'O provedor de números não respondeu.'); }
  finally { clearTimeout(t); }
}

export interface NumberProvider {
  readonly name: NumberProviderName;
  configured(): boolean;
  search(input: { ddd?: string; limit: number }): Promise<AvailableNumber[]>;
  purchase(input: { phoneNumber?: string; ddd?: string; friendlyName: string }): Promise<PurchasedNumber>;
  /** Returns the number to the carrier (stops the monthly cost). Already gone at the carrier counts as released. */
  release(input: { providerNumberId: string; phoneNumber: string }): Promise<void>;
  /** pt-BR list of what is missing to buy with this provider; empty = configured. */
  missing(): string[];
}
const twilioAuth = () => {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim(), token = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!sid || !token) return fail(503, 'twilio_not_configured', 'A conta Twilio da plataforma não está configurada.');
  return { sid, authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64') };
};

export const twilioProvider: NumberProvider = {
  name: 'twilio',
  configured: () => !!(process.env.TWILIO_ACCOUNT_SID?.trim() && process.env.TWILIO_AUTH_TOKEN?.trim() && process.env.TWILIO_BR_BUNDLE_SID?.trim()),
  missing: () => [...(!process.env.TWILIO_ACCOUNT_SID?.trim() || !process.env.TWILIO_AUTH_TOKEN?.trim() ? ['conta Twilio da plataforma (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)'] : []), ...(!process.env.TWILIO_BR_BUNDLE_SID?.trim() ? ['cadastro regulatório de números do Brasil na Twilio (TWILIO_BR_BUNDLE_SID)'] : [])],
  async search({ ddd, limit }) {
    const sid = process.env.TWILIO_ACCOUNT_SID!.trim(), auth = 'Basic ' + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN!.trim()}`).toString('base64');
    const q = new URLSearchParams({ VoiceEnabled: 'true', PageSize: String(limit) }); if (ddd) q.set('Contains', `+55${ddd}*`);
    const r = await call(`https://api.twilio.com/2010-04-01/Accounts/${sid}/AvailablePhoneNumbers/BR/Local.json?${q}`, { headers: { authorization: auth } });
    if (!r.ok) fail(502, 'twilio_search_failed', 'A Twilio não retornou números disponíveis.');
    return (r.body?.available_phone_numbers ?? []).slice(0, limit).map((n: any) => ({ phoneNumber: e164(n.phone_number), locality: n.locality ?? null, region: n.region ?? null, provider: 'twilio' as const }))
      .filter((n: AvailableNumber) => !ddd || n.phoneNumber.startsWith(`+55${ddd}`));
  },
  async purchase({ phoneNumber, ddd, friendlyName }) {
    let target = phoneNumber, locality: string | null = null;
    if (!target) { const first = (await twilioProvider.search({ ddd, limit: 1 }))[0]; target = first?.phoneNumber; locality = first?.locality ?? null; }
    if (!target) return fail(409, 'number_unavailable', 'Nenhum número disponível para este DDD.');
    const sid = process.env.TWILIO_ACCOUNT_SID!.trim(), auth = 'Basic ' + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN!.trim()}`).toString('base64');
    const form = new URLSearchParams({ PhoneNumber: target, FriendlyName: friendlyName.slice(0, 64), BundleSid: process.env.TWILIO_BR_BUNDLE_SID!.trim() });
    if (process.env.TWILIO_BR_ADDRESS_SID?.trim()) form.set('AddressSid', process.env.TWILIO_BR_ADDRESS_SID.trim());
    if (process.env.TWILIO_SIP_TRUNK_SID?.trim()) form.set('TrunkSid', process.env.TWILIO_SIP_TRUNK_SID.trim());
    const r = await call(`https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json`, { method: 'POST', headers: { authorization: auth, 'content-type': 'application/x-www-form-urlencoded' }, body: form });
    if (!r.ok || typeof r.body?.sid !== 'string') fail(502, 'twilio_purchase_failed', `A Twilio recusou a compra${r.body?.message ? `: ${String(r.body.message).slice(0, 160)}` : '.'}`);
    return { phoneNumber: e164(r.body!.phone_number), provider: 'twilio', providerNumberId: r.body!.sid, locality, monthlyCostUsd: 4.25 };
  },
  async release({ providerNumberId }) {
    if (!/^PN[0-9a-fA-F]{32}$/.test(providerNumberId)) return fail(409, 'number_release_unverified', 'O identificador do número na Twilio é inválido.');
    const { sid, authorization } = twilioAuth();
    const r = await call(`https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers/${providerNumberId}.json`, { method: 'DELETE', headers: { authorization } });
    if (!r.ok && r.status !== 404) fail(502, 'twilio_release_failed', 'A Twilio não confirmou a liberação do número. Tente novamente.');
  },
};

// DIDlogic public API (docs.didlogic.com): v2 buy catalog + v1 destinations, Bearer auth.
const didlogicBase = () => (process.env.DIDLOGIC_API_URL?.trim() || 'https://api.didlogic.com').replace(/\/$/, '');
const didlogicAuth = () => ({ authorization: `Bearer ${process.env.DIDLOGIC_API_KEY!.trim()}`, accept: 'application/json' });
let didlogicCountry: string | null = null;
async function didlogicBrCountry() {
  if (process.env.DIDLOGIC_BR_COUNTRY_ID?.trim()) return process.env.DIDLOGIC_BR_COUNTRY_ID.trim();
  if (didlogicCountry) return didlogicCountry;
  const r = await call(`${didlogicBase()}/v2/buy/countries`, { headers: didlogicAuth() });
  if (r.status === 403) fail(503, 'didlogic_purchase_api_disabled', 'A compra via API está desativada na conta DIDlogic.');
  const br = (r.body?.countries ?? []).find((c: any) => String(c.short_name).toUpperCase() === 'BR');
  if (!r.ok || !br) return fail(502, 'didlogic_country_unavailable', 'A DIDlogic não oferece números do Brasil nesta conta.');
  return (didlogicCountry = String(br.id));
}
async function didlogicCities(country: string) {
  const r = await call(`${didlogicBase()}/v2/buy/countries/${encodeURIComponent(country)}/cities`, { headers: didlogicAuth() });
  if (!r.ok) fail(502, 'didlogic_search_failed', 'A DIDlogic não retornou cidades disponíveis.');
  // area_code is the national prefix (e.g. "11" or "1130"); the DDD is its first two digits.
  return (r.body?.cities ?? []).filter((c: any) => Number(c.count) > 0).map((c: any) => ({ id: String(c.id), name: String(c.name ?? ''), ddd: String(c.area_code ?? '').replace(/\D/g, '').replace(/^55/, '').slice(0, 2) }));
}
export const didlogicProvider: NumberProvider = {
  name: 'didlogic',
  configured: () => !!process.env.DIDLOGIC_API_KEY?.trim(),
  missing: () => process.env.DIDLOGIC_API_KEY?.trim() ? [] : ['conta DIDlogic da plataforma (DIDLOGIC_API_KEY)'],
  async search({ ddd, limit }) {
    const country = await didlogicBrCountry(), cities = (await didlogicCities(country)).filter((c: { ddd: string }) => !ddd || c.ddd === ddd);
    const out: AvailableNumber[] = [];
    for (const city of cities.slice(0, 5)) {
      if (out.length >= limit) break;
      const r = await call(`${didlogicBase()}/v2/buy/countries/${encodeURIComponent(country)}/cities/${encodeURIComponent(city.id)}/dids?page=1&per_page=${limit}`, { headers: didlogicAuth() });
      if (!r.ok) continue;
      const rows: any[] = r.body?.dids?.dids ?? [];
      // Numbers that require documents can't be auto-activated; skip them.
      for (const n of rows) if (!String(n.required_documents ?? '').trim() && out.length < limit) out.push({ phoneNumber: e164(n.number), locality: n.city ?? city.name, region: null, provider: 'didlogic', providerRef: String(n.id ?? '') });
    }
    return out;
  },
  async purchase({ phoneNumber, ddd }) {
    let target = phoneNumber;
    if (!target) target = (await didlogicProvider.search({ ddd, limit: 1 }))[0]?.phoneNumber;
    if (!target) return fail(409, 'number_unavailable', 'Nenhum número disponível para este DDD.');
    const r = await call(`${didlogicBase()}/v2/buy/dids`, { method: 'POST', headers: { ...didlogicAuth(), 'content-type': 'application/json' }, body: JSON.stringify({ number: target.replace(/^\+/, '') }) });
    const purchased = r.body?.purchase?.purchases?.[0];
    if (!r.ok || !purchased) fail(502, 'didlogic_purchase_failed', 'A DIDlogic recusou a compra.');
    const sip = process.env.LIVEKIT_SIP_INBOUND_URI?.trim();
    if (sip) {
      // Inbound destination → LiveKit SIP (transport 1 = SIP address). Failure is logged; the number stays owned.
      const form = new URLSearchParams({ 'destination[callhunt]': '0', 'destination[active]': '1', 'destination[transport]': '1', 'destination[destination]': `${String(purchased.number)}@${sip.replace(/^sip:/, '')}` });
      const d = await call(`${didlogicBase()}/v1/purchases/${encodeURIComponent(String(purchased.number))}/destinations`, { method: 'POST', headers: { ...didlogicAuth(), 'content-type': 'application/x-www-form-urlencoded' }, body: form }).catch(() => null);
      if (!d?.ok) console.log('didlogic_destination_failed', JSON.stringify({ number: purchased.number, status: d?.status ?? null }));
    }
    return { phoneNumber: e164(purchased.number), provider: 'didlogic', providerNumberId: String(purchased.id), locality: purchased.area ?? null, monthlyCostUsd: typeof purchased.monthly_fee === 'number' ? purchased.monthly_fee : null };
  },
  // numbers_purchase_destroy (DIDlogic OpenAPI: DELETE /api/v2/numbers/purchase?did_numbers[]=): cancels the purchase and returns the DID to inventory.
  async release({ phoneNumber }) {
    if (!process.env.DIDLOGIC_API_KEY?.trim()) return fail(503, 'didlogic_not_configured', 'A conta DIDlogic da plataforma não está configurada.');
    const digits = phoneNumber.replace(/\D/g, '');
    const r = await call(`${didlogicBase()}/v2/numbers/purchase?${new URLSearchParams({ 'did_numbers[]': digits })}`, { method: 'DELETE', headers: didlogicAuth() });
    if (r.status === 404) return;
    const done = (r.body?.dids ?? []).some((d: any) => String(d?.number ?? '').replace(/\D/g, '') === digits);
    if (!r.ok || !done) fail(502, 'didlogic_release_failed', r.status === 422 ? 'A DIDlogic não permite cancelar este número agora (fora do inventário cancelável ou em período mínimo).' : 'A DIDlogic não confirmou a liberação do número. Tente novamente.');
  },
};

export const numberProviders: Record<NumberProviderName, NumberProvider> = { didlogic: didlogicProvider, twilio: twilioProvider };
