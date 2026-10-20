import type { HelpArticle, HelpNavGroup, HelpTab, HelpTabId } from './types'
import { HELP_ALIASES, HELP_TABS, LEGAL_GROUP } from './nav'
import { GET_STARTED_ARTICLES } from './get-started'
import { PRODUCT_ARTICLES } from './product'
import { DEVELOPER_ARTICLES } from './developers'
import { INTEGRATION_ARTICLES_A } from './integrations-a'
import { INTEGRATION_ARTICLES_B } from './integrations-b'
import { PARTNER_ARTICLES } from './partner'
import { LEGAL_ARTICLES } from './legal'

export type { HelpArticle, HelpNavGroup, HelpTab, HelpTabId } from './types'
export { HELP_TABS, LEGAL_GROUP } from './nav'

export const ALL_ARTICLES: HelpArticle[] = [
  ...GET_STARTED_ARTICLES,
  ...PRODUCT_ARTICLES,
  ...DEVELOPER_ARTICLES,
  ...INTEGRATION_ARTICLES_A,
  ...INTEGRATION_ARTICLES_B,
  ...PARTNER_ARTICLES,
  ...LEGAL_ARTICLES,
]

export const articleKey = (a: Pick<HelpArticle, 'section' | 'slug'>) => `${a.section}/${a.slug}`

const BY_KEY = new Map<string, HelpArticle>(ALL_ARTICLES.map((a) => [articleKey(a), a]))

export function getArticle(key: string): HelpArticle | undefined {
  return BY_KEY.get(key) ?? BY_KEY.get(HELP_ALIASES[key] ?? '')
}

/** Resolve alias → chave canônica (ou undefined se a chave não existir). */
export function canonicalKey(key: string): string | undefined {
  if (BY_KEY.has(key)) return key
  const alias = HELP_ALIASES[key]
  return alias && BY_KEY.has(alias) ? alias : undefined
}

export const articleHref = (key: string) => `/ajuda/${key}`

export interface ArticleLocation {
  tab: HelpTab
  group: HelpNavGroup
  /** posição na sequência de leitura da aba (para anterior/próximo) */
  index: number
  sequence: string[]
}

const TAB_SEQUENCE = new Map<HelpTabId, string[]>(
  HELP_TABS.map((t) => [t.id, t.groups.filter((g) => !g.external).flatMap((g) => g.items)]),
)

/** Localiza a aba/grupo de um artigo. Documentos legais ficam na aba "Começar" (grupo Legal). */
export function locateArticle(key: string): ArticleLocation {
  for (const tab of HELP_TABS) {
    for (const group of tab.groups) {
      if (group.external) continue
      if (group.items.includes(key)) {
        const sequence = TAB_SEQUENCE.get(tab.id)!
        return { tab, group, index: sequence.indexOf(key), sequence }
      }
    }
  }
  const legalSeq = [...LEGAL_GROUP.items, 'legal/aviso-legal']
  return { tab: HELP_TABS[0]!, group: LEGAL_GROUP, index: legalSeq.indexOf(key), sequence: legalSeq }
}

export function tabForSection(section: string): HelpTab | undefined {
  return HELP_TABS.find((t) => t.groups.some((g) => !g.external && g.items.some((k) => k.startsWith(section + '/'))))
}

export function firstArticleOfSection(section: string): string | undefined {
  for (const tab of HELP_TABS) for (const g of tab.groups) for (const k of g.items) if (k.startsWith(section + '/') && BY_KEY.has(k)) return k
  const any = ALL_ARTICLES.find((a) => a.section === section)
  return any ? articleKey(any) : undefined
}

export function firstArticleOfTab(tab: HelpTab): string {
  return tab.groups.find((g) => !g.external)!.items[0]!
}

export const sidebarLabel = (key: string) => {
  const a = getArticle(key)
  return a ? a.sidebarTitle ?? a.title : key
}
