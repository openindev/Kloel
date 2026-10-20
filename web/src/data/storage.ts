import type { DemoDB } from '@/domain/types'

/**
 * Persistência local da demonstração.
 * - Dados vivem apenas no localStorage deste navegador (chave STORAGE_KEY).
 * - Antes de qualquer restauração é feito um backup automático (até MAX_BACKUPS),
 *   para que o trabalho feito durante a demonstração nunca seja apagado sem cópia.
 */
export const STORAGE_KEY = 'kloel-demo:db:v1'
export const BACKUP_KEY = 'kloel-demo:backups:v1'
export const MAX_BACKUPS = 5

export interface BackupEntry {
  id: string
  createdAt: string
  reason: string
  db: DemoDB
}

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function loadDB(): DemoDB | null {
  const raw = safeGet(STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as DemoDB
  } catch {
    return null
  }
}

export function saveDB(db: DemoDB) {
  return safeSet(STORAGE_KEY, JSON.stringify(db))
}

export function listBackups(): BackupEntry[] {
  const raw = safeGet(BACKUP_KEY)
  if (!raw) return []
  try {
    return JSON.parse(raw) as BackupEntry[]
  } catch {
    return []
  }
}

export function pushBackup(db: DemoDB, reason: string) {
  const list = listBackups()
  const entry: BackupEntry = { id: `bk_${Date.now()}`, createdAt: new Date().toISOString(), reason, db }
  const next = [entry, ...list].slice(0, MAX_BACKUPS)
  // Se exceder a cota, mantém menos cópias.
  for (let n = next.length; n > 0; n--) {
    if (safeSet(BACKUP_KEY, JSON.stringify(next.slice(0, n)))) return entry
  }
  return entry
}

export function exportJSON(db: DemoDB) {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `kloel-demo-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function readJSONFile(file: File): Promise<DemoDB> {
  const text = await file.text()
  const parsed = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object' || !('schemaVersion' in parsed) || !('organizations' in parsed)) {
    throw new Error('Arquivo não é uma exportação válida da demonstração Kloel.')
  }
  return parsed as DemoDB
}
