import { useEffect, useState } from 'react'
import { captureEngineContext, useEngineSession } from '@/services/engine/session'
import { searchConversations } from '@/services/casca/conversation-search'
export function useConversationSearch(query: string, enabled = true) {
  const session = useEngineSession(), q = enabled ? query.trim() : ''
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ key: string; state: 'loading' | 'error' | 'ready'; ids: Set<string> | null }>({ key: '', state: 'ready', ids: null })
  const key = `${session.generation}:${q}`
  useEffect(() => {
    const abort = new AbortController()
    if (!q) { setResult({ key, state: 'ready', ids: null }); return }
    setResult({ key, state: 'loading', ids: null })
    const timer = setTimeout(() => {
      void (async () => {
        try { const context = captureEngineContext(), ids = await searchConversations(context, q, abort.signal); context.assertCurrent(); if (!abort.signal.aborted) setResult({ key, state: 'ready', ids }) }
        catch { if (!abort.signal.aborted) setResult({ key, state: 'error', ids: null }) }
      })()
    }, 200)
    return () => { clearTimeout(timer); abort.abort() }
  }, [key, q, attempt])
  return { state: !q ? 'ready' as const : result.key !== key ? 'loading' as const : result.state, ids: result.key === key ? result.ids : null, retry: () => setAttempt(value => value + 1) }
}
