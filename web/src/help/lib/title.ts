import { useEffect } from 'react'

/** Sufixo do título da aba em todas as rotas /ajuda/* (o RootLayout não define títulos para a central). */
export const HELP_TITLE_SUFFIX = 'Central de ajuda Kloel AI'

export function helpDocumentTitle(page: string) {
  return `${page} | ${HELP_TITLE_SUFFIX}`
}

/** Define `document.title` = "<página> | Central de ajuda Kloel AI" enquanto a página estiver montada. */
export function useHelpTitle(page: string) {
  useEffect(() => {
    document.title = helpDocumentTitle(page)
  }, [page])
}
