const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const YES = new Set(['sim', 's', 'yes', 'y', 'true', '1'])

export type CommercialActionLine = { name: string; method: string; path: string; description: string; confirm: boolean; confirmLabel: string; sourceLine: string }

/** Keeps the typed line, including "não", and only interprets the last column as the confirmation flag. */
export function parseActionLines(text: string): CommercialActionLine[] {
  return text.split('\n').map(line => line.trim()).filter(Boolean).flatMap(line => {
    const parts = line.split('|')
    const left = (parts[0] ?? '').trim()
    const description = (parts[1] ?? '').trim()
    const confirmLabel = (parts[2] ?? '').trim()
    const [methodRaw, ...pathParts] = left.split(/\s+/)
    const method = methodRaw.toUpperCase()
    const path = pathParts.join(' ')
    if (!METHODS.includes(method) || !path.startsWith('/')) return []
    const confirm = YES.has(confirmLabel.toLowerCase())
    return [{ name: `${method} ${path}`.slice(0, 80), method, path, description, confirm, confirmLabel: confirmLabel || (confirm ? 'sim' : 'não'), sourceLine: line }]
  })
}

export function formatActionLines(actions: { method?: string; path?: string; description?: string; confirm?: boolean; confirmLabel?: string; sourceLine?: string }[]): string {
  return actions.map(action => action.sourceLine || `${action.method ?? ''} ${action.path ?? ''} | ${action.description ?? ''} | ${action.confirmLabel || (action.confirm ? 'sim' : 'não')}`).join('\n')
}
