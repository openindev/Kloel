// Idiomas do assistente (select "Idioma", app.fonio.ai 2026-10-18)
export const LANGUAGES: { value: string; label: string }[] = [
  ['pt-BR', 'Português (Brasil)'], ['pt', 'Português'], ['multi', 'Multi (todos os idiomas)'], ['de', 'Alemão'], ['de-CH', 'Alemão suíço'], ['ar', 'Árabe'],
  ['bn', 'Bengali'], ['bg', 'Búlgaro'], ['yue', 'Cantonês'], ['ca', 'Catalão'], ['zh', 'Chinês (mandarim)'], ['ko', 'Coreano'], ['hr', 'Croata'],
  ['da', 'Dinamarquês'], ['sk', 'Eslovaco'], ['sl', 'Esloveno'], ['es', 'Espanhol'], ['et', 'Estoniano'], ['fi', 'Finlandês'], ['fr', 'Francês'],
  ['el', 'Grego'], ['hi', 'Hindi'], ['nl', 'Holandês'], ['hu', 'Húngaro'], ['en', 'Inglês'], ['en-US', 'Inglês (americano)'], ['en-GB', 'Inglês (britânico)'],
  ['it', 'Italiano'], ['ja', 'Japonês'], ['lt', 'Lituano'], ['no', 'Norueguês'], ['fa', 'Persa (farsi)'], ['pl', 'Polonês'], ['ro', 'Romeno'], ['ru', 'Russo'],
  ['sr', 'Sérvio'], ['sv', 'Sueco'], ['cs', 'Tcheco'], ['tr', 'Turco'], ['uk', 'Ucraniano'], ['ur', 'Urdu'],
].map(([value, label]) => ({ value: value!, label: label! }))
export const languageLabel = (v: string) => LANGUAGES.find((l) => l.value === v)?.label ?? v
// Idiomas da interface (Conta > Idioma)
export const UI_LANGUAGES = ['en', 'en-US', 'en-GB', 'de', 'fr', 'pl', 'it', 'pt-BR', 'pt-PT', 'nl', 'es']
