import { useEffect } from 'react'

/**
 * Páginas "não encontrada" (404 do SPA, artigo da ajuda ou solução inexistente): `<meta name="robots" content="noindex">`
 * enquanto montadas, removida ao desmontar. O motor já responde 404 às rotas que conhece como inválidas; isto cobre as que ele
 * serve com 200 e a navegação dentro do SPA. Marcada com `data-noindex` para o useRouteSeo (src/RootLayout.tsx) não apagá-la.
 */
export function useNoIndex() {
  useEffect(() => {
    const el = document.createElement('meta')
    el.setAttribute('name', 'robots'); el.setAttribute('content', 'noindex'); el.setAttribute('data-noindex', '')
    document.head.appendChild(el)
    return () => el.remove()
  }, [])
}
