/** Validações compartilhadas do módulo "mais-b" (Usuários / Conta). */
import { COUNTRIES, PHONE_COUNTRIES } from '@/components/app/PhoneInput'

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

const PHONE_EXAMPLE = 'ex.: +55 11 90000-0123'
/** Caracteres aceitos ao digitar um telefone: dígitos, espaço, parênteses, hífen, ponto e o "+" inicial. */
const PHONE_CHARS = /^\+?[\d\s().-]+$/
/** Códigos de país conhecidos, do mais longo para o mais curto (+351 antes de +3x, +1 por último). */
const DIALS = [...new Set([...PHONE_COUNTRIES, ...COUNTRIES].map((c) => c.dial.replace('+', '')))].sort((a, b) => b.length - a.length)

export const isEmptyPhone = (v: string) => !v.trim() || /^\+\d{1,3}\s*$/.test(v.trim())

/** Telefone opcional: vazio (ou só o código do país) = sem telefone. */
export function phoneError(v: string) {
  const t = v.trim()
  if (isEmptyPhone(t)) return null
  if (!PHONE_CHARS.test(t)) return `Informe um telefone válido usando apenas números, espaços, parênteses e hífen (${PHONE_EXAMPLE}).`
  const digits = t.replace(/\D/g, '')
  if (digits.length < 10 || digits.length > 15) return `Informe um telefone válido com DDD (${PHONE_EXAMPLE}).`
  const national = brazilNational(t, digits)
  if (national !== null && national.length !== 10 && national.length !== 11) return `Informe um telefone brasileiro com DDD e 8 ou 9 dígitos (${PHONE_EXAMPLE}).`
  return null
}

/** Número nacional brasileiro (sem +55) quando o valor é do Brasil; null para outros países. */
function brazilNational(t: string, digits: string) {
  if (t.startsWith('+')) return digits.startsWith('55') ? digits.slice(2) : null
  // Sem "+": 10–11 dígitos = número nacional (DDD + número); 12–13 começando com 55 = já inclui o país.
  if (digits.length <= 11) return digits
  return digits.startsWith('55') ? digits.slice(2) : null
}

/**
 * Normaliza um telefone já validado para o formato salvo e exibido nas tabelas:
 * Brasil → "+55 11 90000-0123" / "+55 11 3000-0123"; outros países → "+<código> <número>".
 */
export function normalizePhone(v: string) {
  const t = v.trim()
  if (isEmptyPhone(t)) return ''
  const digits = t.replace(/\D/g, '')
  const national = brazilNational(t, digits)
  if (national !== null) {
    const ddd = national.slice(0, 2)
    const rest = national.slice(2)
    const cut = rest.length - 4
    return `+55 ${ddd} ${rest.slice(0, cut)}-${rest.slice(cut)}`
  }
  const dial = DIALS.find((d) => digits.startsWith(d)) ?? ''
  const num = digits.slice(dial.length)
  return dial ? `+${dial} ${num}` : `+${digits}`
}
