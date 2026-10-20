import { EngineError } from './http'
import { sheetQueryInput, type SheetFilter, type SheetQueryInput, type SheetVariable } from './sheets-query'

export type SheetQueryDraft = { headers: boolean; filters: SheetFilter[]; variables: { name: string; type: SheetVariable['type']; value: string }[]; maxRows: string }
export const emptySheetQuery = (): SheetQueryDraft => ({ headers: false, filters: [], variables: [], maxRows: '50' })
export function queryFromDraft(sheetTitle: string, scanRange: string, draft: SheetQueryDraft): SheetQueryInput {
  const variables = draft.variables.map(v => {
    if (v.type === 'number' && (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(v.value) || !Number.isFinite(Number(v.value))) || v.type === 'boolean' && !['true', 'false'].includes(v.value)) throw new EngineError(400, 'invalid_sheets_query', 'Preencha os valores das variáveis com o tipo indicado.')
    return { ...v, value: v.type === 'number' ? Number(v.value) : v.type === 'boolean' ? v.value === 'true' : v.value }
  })
  if (!/^\d+$/.test(draft.maxRows)) throw new EngineError(400, 'invalid_sheets_query', 'Informe de 1 a 1000 linhas de resultado.')
  return sheetQueryInput({ sheetTitle, scanRange, headers: draft.headers, filters: draft.filters, variables, maxRows: Number(draft.maxRows) })
}
