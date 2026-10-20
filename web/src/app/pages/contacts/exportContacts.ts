import { format } from 'date-fns'
import type { Contact, SmartFieldDef } from '@/domain/types'
import '@/domain/ext/inbox-contacts'
import { downloadBlob, downloadFile, toCsv } from '../inbox/shared'
import { buildXlsx } from '../inbox/xlsx'
import { SOURCE_LABEL, labelText } from './lib'

/** Planilhas não executam conteúdo de contatos: fórmulas viram texto (telefones "+55…" continuam como estão). */
const safe = (value: string) => (/^[=+\-@\t\r]/.test(value) && !/^\+[\d\s().-]+$/.test(value) ? `'${value}` : value)

/** Linhas exportadas de Contatos (resultado atual da busca/dos filtros), com os campos inteligentes ao final. */
export function contactExportTable(contacts: Contact[], smartFields: SmartFieldDef[], members: { id: string; name: string }[]) {
  const header = ['Nome', 'Sobrenome', 'Telefones', 'E-mails', 'Empresa', 'Responsável', 'Notas', 'Origem', 'Bloqueado', 'WhatsApp IA', 'Criado em', 'Atualizado em', ...smartFields.map((f) => f.label)]
  const rows = contacts.map((c) => [
    c.firstName, c.lastName,
    c.phones.map((p) => (p.label ? `${p.value} (${labelText(p.label)})` : p.value)).join('; '),
    c.emails.map((e) => (e.label ? `${e.value} (${labelText(e.label)})` : e.value)).join('; '),
    c.company, c.ownerId ? members.find((m) => m.id === c.ownerId)?.name ?? '' : '', c.notes, SOURCE_LABEL[c.source],
    c.blocked ? 'Sim' : 'Não', c.whatsappAi && !c.blocked ? 'Sim' : 'Não',
    format(new Date(c.createdAt), 'dd/MM/yyyy HH:mm'), c.updatedAt ? format(new Date(c.updatedAt), 'dd/MM/yyyy HH:mm') : '',
    ...smartFields.map((f) => c.fields[f.id] ?? ''),
  ].map((v) => safe(String(v ?? ''))))
  return { header, rows }
}

export function exportContacts(kind: 'csv' | 'xlsx', contacts: Contact[], smartFields: SmartFieldDef[], members: { id: string; name: string }[], now = new Date()) {
  const { header, rows } = contactExportTable(contacts, smartFields, members)
  const name = `contatos-kloel-${format(now, 'yyyy-MM-dd')}`
  if (kind === 'csv') downloadFile(`${name}.csv`, toCsv(header, rows))
  else downloadBlob(`${name}.xlsx`, buildXlsx('Contatos', header, rows))
  return rows.length
}
