/** Países do diálogo "Adicionar número de telefone" (17 opções, mesma ordem e grafia da conta ao vivo: fonio-live2/E-numeros/00-numeros-dom-resumo.txt). */
export const PURCHASE_COUNTRIES = [
  { id: 'de-national', code: 'de', label: 'Alemanha (nacional) (+4932)' },
  { id: 'de-mobile', code: 'de', label: 'Alemanha móvel (+4915)' },
  { id: 'at-national', code: 'at', label: 'Áustria (nacional) (+43720)' },
  { id: 'at-vienna', code: 'at', label: 'Áustria (Viena) (+431)' },
  { id: 'be-geo', code: 'be', label: 'Bélgica (geográfico) (+32)' },
  { id: 'be-national', code: 'be', label: 'Bélgica (nacional) (+3278)' },
  { id: 'br', code: 'br', label: 'Brasil (+55)' },
  { id: 'us', code: 'us', label: 'Estados Unidos (+1)' },
  { id: 'fr', code: 'fr', label: 'França (+339)' },
  { id: 'it', code: 'it', label: 'Itália (+39)' },
  { id: 'nl', code: 'nl', label: 'Países Baixos (+31)' },
  { id: 'pl-geo', code: 'pl', label: 'Polônia (+4858)' },
  { id: 'pl-mobile', code: 'pl', label: 'Polônia (móvel) (+48)' },
  { id: 'gb-geo', code: 'gb', label: 'Reino Unido (geográfico) (+44)' },
  { id: 'gb-national', code: 'gb', label: 'Reino Unido (nacional) (+4433)' },
  // OBSERVADO (fonio-live2/E-numeros/04 + dump): esta opção aparece em inglês na Fonio — mantida igual.
  { id: 'es', code: 'es', label: 'Spain (+3487)' },
  { id: 'ch', code: 'ch', label: 'Suíça (+41)' },
] as const

export const countryShort = (label: string) => label.replace(/\s*\(\+\d+\)\s*$/, '')

/**
 * DDIs conhecidos → código ISO da bandeira. Inclui os países do seletor do PhoneInput (COUNTRIES) e os da compra de
 * números; o prefixo mais longo vence (+351 Portugal antes de +3…, +1 EUA/Canadá).
 */
const DIAL_CODES: [string, string][] = [
  ['+55', 'br'], ['+351', 'pt'], ['+1', 'us'], ['+54', 'ar'], ['+52', 'mx'], ['+34', 'es'], ['+49', 'de'], ['+44', 'gb'],
  ['+43', 'at'], ['+32', 'be'], ['+33', 'fr'], ['+39', 'it'], ['+31', 'nl'], ['+48', 'pl'], ['+41', 'ch'], ['+56', 'cl'],
  ['+57', 'co'], ['+51', 'pe'], ['+598', 'uy'], ['+595', 'py'], ['+591', 'bo'], ['+353', 'ie'], ['+45', 'dk'], ['+46', 'se'],
  ['+47', 'no'], ['+358', 'fi'], ['+81', 'jp'], ['+86', 'cn'], ['+91', 'in'], ['+61', 'au'], ['+27', 'za'], ['+244', 'ao'], ['+258', 'mz'],
]

/** País (ISO, minúsculo) do número pelo DDI digitado; "xx" (bandeira neutra) quando o DDI não é reconhecido. */
export function countryFromPhone(phone: string) {
  const p = '+' + phone.replace(/\D/g, '')
  return [...DIAL_CODES].sort((a, b) => b[0].length - a[0].length).find(([dial]) => p.startsWith(dial))?.[1] ?? 'xx'
}

/** Código ISO (para a bandeira) a partir de PhoneNumber.country (ISO ou legado em maiúsculas). */
export const flagCode = (country: string) => country.toLowerCase().slice(0, 2)
