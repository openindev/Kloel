import type { Agent, Organization } from '@/domain/types'
import type { WebchatSetup } from '@/domain/ext/mais-a'
import '@/domain/ext/mais-a'
import '@/domain/ext/engine-webchat'
import { chatGreetingOf } from '@/app/pages/agents/core/chatSettings'
import { renderMessage } from '@/app/pages/agents/core/variables'

/**
 * Chatbot de IA (Webchat) do assistente de chat — OBSERVADO na central de ajuda pública da Fonio (products/webchat, WC-08…WC-14):
 * "Widget do site" (sites permitidos + saudação + instalação), "Link hospedado" (slugs + URL + saudação) e "Personalizar"
 * (identidade, entrada de mensagem, tema e cores, prévia). Domínios e scripts são da Kloel e demonstrativos.
 */

export const GREETING_MAX = 500
export const DEFAULT_ACCENT = '#585DFE'

export function slugify(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function uuid(seed: string) {
  let h = 2166136261
  const out: string[] = []
  for (let i = 0; i < 32; i++) {
    h ^= seed.charCodeAt(i % seed.length) + i
    h = Math.imul(h, 16777619)
    out.push(((h >>> 0) % 16).toString(16))
  }
  const s = out.join('')
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-a${s.slice(17, 20)}-${s.slice(20, 32)}`
}

export function defaultWebchat(agent: Pick<Agent, 'id' | 'name' | 'webchat'>): WebchatSetup {
  return {
    allowedSites: [],
    widgetGreeting: '',
    hostedEnabled: false,
    hostedGreeting: '',
    avatar: 'feminino',
    avatarBorder: false,
    displayName: '',
    attachments: true,
    theme: 'light',
    accent: agent.webchat?.color && /^#[0-9a-f]{6}$/i.test(agent.webchat.color) ? agent.webchat.color : DEFAULT_ACCENT,
    accentMode: 'buttons',
    widgetId: uuid(agent.id),
  }
}

export function webchatOf(agent: Pick<Agent, 'id' | 'name' | 'webchat' | 'webchatSetup' | 'engineWebchat'>): WebchatSetup {
  const channel = agent.engineWebchat?.channels.length === 1 ? agent.engineWebchat.channels[0] : null
  return { ...defaultWebchat(agent), ...agent.webchatSetup, allowedSites: channel ? [...channel.configuration.allowedOrigins] : [], widgetGreeting: channel?.configuration.greeting ?? '', hostedEnabled: false, engineAvailable: channel?.readiness.available === true, ...(channel ? { widgetId: channel.id } : {}) }
}

export const widgetActive = (w: WebchatSetup) => w.engineAvailable === true
export const hostedActive = (w: WebchatSetup) => w.hostedEnabled && !!w.assistantSlug

export const hostedBase = (orgSlug: string) => `${window.location.origin}/w/${orgSlug}/`
export const hostedUrl = (orgSlug: string, assistantSlug: string) => `${hostedBase(orgSlug)}${assistantSlug}`
/** caminho local da página pública (rota /w/:orgSlug/:assistantSlug) */
export const hostedPath = (orgSlug: string, assistantSlug: string) => `/w/${orgSlug}/${assistantSlug}`

export function widgetScript(widgetId: string) {
  return `<script\n  type="module"\n  src="${window.location.origin}/widget/kloel.js"\n  data-kloel-webchat-widget-id="${widgetId}"\n></script>`
}

/** Origem exata (OBSERVADO WC-09: "Add each exact website origin … for example https://example.com"). */
export function validateOrigin(v: string, others: string[]) {
  const t = v.trim()
  if (!t) return 'Informe o endereço do site.'
  if (!/^https?:\/\/[^/?#\\]+\/?$/i.test(t)) return 'Use somente a origem do site, sem caminho, consulta ou fragmento.'
  try {
    const url = new URL(t)
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || t.includes('*') || !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return 'Use uma origem HTTPS sem caminho. HTTP é permitido apenas no localhost.'
    if (others.some(other => { try { return new URL(other.trim()).origin === url.origin } catch { return false } })) return 'Este site já está na lista.'
  } catch { return 'Informe uma origem válida, como https://exemplo.com.br.' }
  return undefined
}

export function validateAssistantSlug(slug: string, agentId: string, agents: Pick<Agent, 'id' | 'webchatSetup'>[]) {
  if (!slug) return 'Informe o slug do assistente.'
  if (slug.length < 3) return 'O slug precisa ter pelo menos 3 caracteres.'
  if (slug.length > 48) return 'O slug pode ter no máximo 48 caracteres.'
  if (!/^[a-z0-9-]+$/.test(slug)) return 'Use apenas letras minúsculas, números e hífens (sem espaços ou acentos).'
  if (slug.startsWith('-') || slug.endsWith('-')) return 'O slug não pode começar nem terminar com hífen.'
  if (agents.some((a) => a.id !== agentId && a.webchatSetup?.hostedEnabled && a.webchatSetup.assistantSlug === slug)) return 'Este slug já é usado por outro assistente da empresa.'
  return undefined
}

export const displayNameOf = (w: WebchatSetup, agent: Pick<Agent, 'name'>) => w.displayName.trim() || agent.name

/** Saudação vazia → a mensagem de saudação do assistente de chat (aba Canal/Geral), que por sua vez cai no padrão do idioma. */
export const defaultGreeting = (agent: Pick<Agent, 'name' | 'greeting' | 'language'>, companyName = '') => renderMessage(chatGreetingOf(agent), { agent: { name: agent.name }, companyName })

export type OrgLike = Pick<Organization, 'id' | 'slug' | 'name'>
