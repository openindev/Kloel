import { whatsappChannelUIFixture } from './engine-whatsapp-channel-fixture'
export async function metaConnectionFixture(t: any) {
  const previous = { META_APP_ID: process.env.META_APP_ID, META_WABA_ID: process.env.META_WABA_ID }
  process.env.META_APP_ID = '10001'; process.env.META_WABA_ID = '20002'
  t.after(() => { for (const [k, v] of Object.entries(previous)) if (v === undefined) delete process.env[k]; else process.env[k] = v })
  const f = await whatsappChannelUIFixture(t)
  const responses: Record<string, any> = {
    debug_token: { data: { app_id: '10001', is_valid: true, scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'], expires_at: 0, data_access_expires_at: Math.floor(Date.now() / 1000) + 3600 } },
    '20002/phone_numbers': { data: [{ id: '12345' }] },
    '12345': { id: '12345', status: 'CONNECTED', quality_rating: 'GREEN', account_mode: 'SANDBOX' },
  }
  f.hooks.provider = url => Response.json(responses[new URL(url).pathname.replace('/v25.0/', '')])
  return { ...f, responses }
}
