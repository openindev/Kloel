import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Link2, Search, UserPlus } from 'lucide-react'
import type { Contact, Conversation } from '@/domain/types'
import { useCollection, useCurrentUser, useDB } from '@/data/store'
import { usePermission } from '@/services/engine/session'
import { loadArea } from '@/services/casca/data'
import { updateConversationEditor } from '@/services/casca/conversations'
import { linkConversationToContact } from '@/services/casca/contacts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'

/** Pessoas da equipe (id do usuário → nome), a partir dos membros carregados; carrega a equipe uma vez se faltar. */
function useTeam() {
  const memberships = useCollection('memberships')
  const users = useDB((db) => db.users)
  const me = useCurrentUser()
  const canReadTeam = usePermission('team:read')
  useEffect(() => {
    if (canReadTeam && memberships.length === 0) void loadArea('users').catch(() => {})
  }, [canReadTeam, memberships.length])
  return useMemo(() => {
    const list = memberships
      .map((m) => users.find((u) => u.id === m.userId))
      .filter((u): u is NonNullable<typeof u> => !!u)
      .map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}`.trim() || u.email }))
    if (me && !list.some((m) => m.id === me.id)) list.unshift({ id: me.id, name: `${me.firstName} ${me.lastName}`.trim() || me.email })
    return list
  }, [memberships, users, me])
}

/** "Responsável" pela conversa: compartilhado com a equipe e confirmado pelo motor (só membros atuais). */
export function AssigneeSelect({ conversation, readOnly }: { conversation: Conversation; readOnly?: boolean }) {
  const team = useTeam()
  const me = useCurrentUser()
  const canWrite = usePermission('conversations:write')
  const [saving, setSaving] = useState(false)
  const current = conversation.assigneeUserId
  const loaded = !!conversation.engineConversation?.editor
  const change = async (value: string) => {
    const next = value === '__none' ? null : value
    if (saving || next === (current ?? null)) return
    setSaving(true)
    try {
      await updateConversationEditor(conversation, { assigneeUserId: next })
      toast.success(next ? `Responsável: ${team.find((m) => m.id === next)?.name ?? 'membro da equipe'}` : 'Conversa sem responsável')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível salvar o responsável.')
    } finally {
      setSaving(false)
    }
  }
  return (
    <Select value={current ?? '__none'} onValueChange={(v) => void change(v)} disabled={readOnly || !canWrite || !loaded || saving}>
      <SelectTrigger className="h-7 w-full px-2 text-[12px]" aria-label="Responsável pela conversa">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none">Sem responsável</SelectItem>
        {current && !team.some((m) => m.id === current) && <SelectItem value={current}>Membro removido</SelectItem>}
        {team.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.name}
            {m.id === me?.id ? ' (você)' : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const contactLabel = (c: Contact) => `${c.firstName} ${c.lastName}`.trim() || c.phones[0]?.value || c.emails[0]?.value || 'Contato sem nome'

/** "Criar contato" (formulário de Contatos já vinculado a esta conversa) e "Vincular a um contato" / "Trocar contato". */
export function ContactLinkActions({ conversation, contact: matched, readOnly }: { conversation: Conversation; contact?: Contact; readOnly?: boolean }) {
  // Correspondência só pelo telefone ainda não é vínculo: a pessoa confirma antes de a conversa entrar no contato.
  const contact = matched && conversation.contactId === matched.id ? matched : undefined
  const suggested = matched && !contact ? matched : undefined
  const contacts = useCollection('contacts')
  const canWriteContacts = usePermission('contacts:write'), canWriteConversations = usePermission('conversations:write'), canWrite = canWriteContacts && canWriteConversations
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [replace, setReplace] = useState<Contact | null>(null)
  if (readOnly || !canWrite) return null
  const needle = query.trim().toLocaleLowerCase('pt-BR'), digits = query.replace(/\D/g, '')
  const results = contacts
    .filter((c) => c.id !== contact?.id)
    .filter((c) => !needle || contactLabel(c).toLocaleLowerCase('pt-BR').includes(needle) || c.company.toLocaleLowerCase('pt-BR').includes(needle) || c.emails.some((e) => e.value.toLowerCase().includes(needle)) || (digits.length >= 3 && c.phones.some((p) => p.value.replace(/\D/g, '').includes(digits))))
    .slice(0, 8)
  const link = async (target: Contact, confirmReplace = false) => {
    if (busy) return
    if (contact && !confirmReplace) return setReplace(target)
    setBusy(true)
    try {
      await linkConversationToContact(target.id, conversation.id, !!contact)
      toast.success(`Conversa vinculada a ${contactLabel(target)}`)
      setOpen(false); setQuery('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível vincular a conversa.')
    } finally {
      setBusy(false)
    }
  }
  const phone = conversation.callerNumber ?? conversation.calleeNumber
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="conversation-contact-actions">
      {suggested && (
        <Button variant="outline" size="xs" className="h-7 gap-1 bg-white text-[11.5px]" disabled={busy} onClick={() => void link(suggested)}>
          <Link2 className="h-3 w-3" /> Vincular a {contactLabel(suggested)}
        </Button>
      )}
      {!contact && !suggested && (
        <Button asChild variant="outline" size="xs" className="h-7 gap-1 bg-white text-[11.5px]">
          <Link to={`/app/contacts?create=1&from=${encodeURIComponent(conversation.id)}${phone ? `&phone=${encodeURIComponent(phone)}` : ''}`}>
            <UserPlus className="h-3 w-3" /> Criar contato
          </Link>
        </Button>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="xs" className="h-7 gap-1 bg-white text-[11.5px]" disabled={busy}>
            <Link2 className="h-3 w-3" /> {contact ? 'Trocar contato' : 'Vincular a um contato'}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-2">
          <div className="relative mb-1.5">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nome, telefone ou e-mail" className="h-8 pl-7 text-xs" aria-label="Buscar contato para vincular" />
          </div>
          <ul className="max-h-56 overflow-y-auto" role="listbox" aria-label="Contatos">
            {results.length === 0 ? (
              <li className="px-2 py-3 text-center text-xs text-muted-foreground">{contacts.length ? 'Nenhum contato encontrado.' : 'Nenhum contato cadastrado ainda.'}</li>
            ) : (
              results.map((c) => (
                <li key={c.id}>
                  <button type="button" role="option" aria-selected={false} disabled={busy} onClick={() => void link(c)} className="flex w-full flex-col items-start rounded px-2 py-1.5 text-left hover:bg-accent">
                    <span className="truncate text-xs font-medium">{contactLabel(c)}</span>
                    <span className="truncate text-[11px] text-muted-foreground">{c.phones[0]?.value ?? c.emails[0]?.value ?? c.company}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </PopoverContent>
      </Popover>
      <ConfirmDialog
        open={!!replace}
        onOpenChange={(o) => !o && setReplace(null)}
        title="Trocar o contato desta conversa?"
        description={replace && contact ? `A conversa deixa de aparecer em ${contactLabel(contact)} e passa para ${contactLabel(replace)}.` : undefined}
        confirmLabel="Trocar contato"
        onConfirm={() => { const target = replace; setReplace(null); if (target) void link(target, true) }}
      />
    </div>
  )
}
