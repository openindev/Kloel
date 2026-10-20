import { useEffect } from 'react'

export const SITE_TITLE = 'Kloel AI'

/**
 * Define o título da aba do navegador para páginas do site público: "<Página> | Kloel AI".
 * `full: true` usa o texto como está (ex.: home "Kloel AI — Assistente telefônico com IA").
 * Ao desmontar volta ao título padrão do index.html (não ao anterior: restaurar o anterior deixava o título de uma
 * página antiga em rotas que não definem o próprio). Rotas tratadas em src/RootLayout.tsx (/planos, /agendar-demo,
 * /criar-conta, /login, /recuperar-senha, /r/:code, /c/*) não chamam este hook, para não haver dois donos do título.
 */
export function usePageTitle(title: string, opts?: { full?: boolean }) {
  const full = !!opts?.full
  useEffect(() => {
    document.title = !title ? SITE_TITLE : full ? title : `${title} | ${SITE_TITLE}`
    return () => {
      document.title = SITE_TITLE
    }
  }, [title, full])
}
