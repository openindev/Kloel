import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Link } from 'react-router-dom'
import { createConversationIdentityReview, type ConversationIdentityReview } from '@/services/casca/conversation-identity-review'
import type { IdentityReason } from '@/services/engine/whatsapp-identity-review'
import type { Conversation } from '@/domain/types'
import { captureEngineContext, engineSession, usePermission } from '@/services/engine/session'
import { createConversationAutomation } from '@/services/casca/conversation-automation'
import { createConversationCapture } from '@/services/casca/conversation-capture'
import { refreshConversation } from '@/services/casca/conversations'
import { loadArea } from '@/services/casca/data'
import type { CaptureProposal } from '@/services/engine/crm-capture'
import { whatsappJobOnceResolved } from '@/services/engine/whatsapp-job-once'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { OpStatus } from '../phone-numbers/OpStatus'

export type ConversationOperation = 'recipient' | 'admission' | 'capture' | 'identity'
const titles = { identity: 'Revisar origem', recipient: 'Confirmar destinatário', admission: 'Responder com IA', capture: 'Revisar dados do contato' }
const reasons: Record<string, string> = {
  forbidden: 'Seu acesso não permite esta operação.', identity_review_required: 'A origem desta conversa precisa ser revisada.',
  human_takeover_required: 'Assuma o atendimento antes de confirmar o destinatário.', outside_window: 'O prazo para responder esta mensagem terminou.',
  source_unverified: 'É necessária uma nova mensagem com origem confirmada pelo WhatsApp.', source_not_text: 'Esta opção exige uma mensagem de texto.',
  conversation_not_open: 'Abra a conversa antes de continuar.', human_handoff: 'Devolva o atendimento ao assistente antes de preparar a resposta.',
  autoreply_must_be_disabled: 'Desative a resposta automática antes de preparar uma resposta única.', source_already_admitted: 'Esta mensagem já tem uma resposta preparada.',
  tools_not_allowed: 'A resposta única exige um assistente sem ferramentas.', agent_unavailable: 'O assistente desta conversa está pausado ou foi excluído. Ative-o em Assistentes para responder com IA.',
  provider_unavailable: 'A conexão com o WhatsApp oficial (Meta) não está configurada para esta organização. Conecte o número em WhatsApp.', send_requires_reconciliation: 'Consulte o envio pendente antes de continuar.',
  evidence_unavailable: 'Ainda não há uma entrega confirmada para revisar.', evidence_incomplete: 'A consulta de entregas não está completa.',
}
const identityReasons: Record<IdentityReason,string> = {
  forbidden:'Seu acesso permite consultar a origem, mas não confirmar esta revisão.', unsupported_channel:'Esta revisão está disponível apenas para conversas do WhatsApp.',
  not_required:'Esta conversa não exige revisão de origem.', already_reviewed:'A revisão para atendimento humano continua válida.',
  inbound_unverified:'É necessária uma nova mensagem com origem confirmada pelo WhatsApp.', inbound_ambiguous:'Há mais de uma origem possível. Aguarde uma origem confirmada.',
  channel_unavailable:'O número de WhatsApp desta conversa está desconectado ou desativado.', channel_changed:'O canal mudou desde a mensagem recebida.', invalid_timestamp:'Não foi possível confirmar o prazo desta mensagem.',
  outside_window:'O prazo para responder esta mensagem terminou.', human_takeover_required:'Assuma o atendimento desta conversa antes de confirmar.',
  quarantine_tag_required:'O bloqueio de IA precisa ser preservado para esta revisão.', collisions_incomplete:'Não foi possível consultar todos os históricos relacionados. A revisão está bloqueada.',
}
const collisionStatus = {open:'Aberta',pending:'Pendente',closed:'Encerrada',unknown:'Situação desconhecida'}
/** Por que a Kloel não aplicou sozinha (regras de identidade da captura automática). */
const proposalReasons: Record<string, string> = {
  capture_identity_requires_review: 'Conversas do chat do site não têm telefone verificado: confirme os dados para criar o contato.', identity_requires_review: 'Conversas do chat do site não têm telefone verificado: confirme os dados para criar o contato.',
  capture_link_requires_review: 'Encontramos um contato com o mesmo telefone: confirme antes de vincular.', capture_creation_gate_not_met: 'A conversa não trouxe nome e sobrenome (ou a captura de contatos está desligada); os campos só podem ir para um contato já vinculado.',
  capture_subject_requires_manual_resolution: 'Não ficou claro se os dados são da pessoa da conversa ou de outra pessoa.', capture_identity_conflict: 'Os dados correspondem a mais de um contato; vincule a conversa ao contato certo primeiro.',
  capture_no_empty_fields: 'Os campos já estavam preenchidos no contato.',
}
type WA = ReturnType<typeof createConversationAutomation>
type Capture = ReturnType<typeof createConversationCapture>

/** As ações adicionais usam o menu e o diálogo já presentes na casca; não substituem a conversa. */
export function ConversationOperationDialog({ conversation, operation, onClose }: { conversation: Conversation; operation: ConversationOperation; onClose: () => void }) {
  const canManage = usePermission('integrations:manage'), canWrite = usePermission('conversations:write')
  const canEditContact = usePermission('contacts:write')
  const setup = useMemo(() => {
    const context = captureEngineContext('conversations:read'), c = engineSession.getSnapshot().data!.identity.context
    if (!c.membershipId || !c.tenantId) throw Error('Selecione uma organização.')
    const identity = { userId: c.userId, tenantId: c.tenantId, membershipId: c.membershipId, authorityVersion: c.authorityVersion }
    return { context, wa: createConversationAutomation(context, conversation.id, identity, sessionStorage), capture: createConversationCapture(context, conversation.id, c, sessionStorage), identity: createConversationIdentityReview(context, conversation.id, identity, sessionStorage) }
  }, [conversation.id])
  const [identity, setIdentity] = useState<ConversationIdentityReview>()
  const [recipient, setRecipient] = useState<Awaited<ReturnType<WA['recipient']>>>()
  const [admission, setAdmission] = useState<Awaited<ReturnType<WA['admission']>>>()
  const [capture, setCapture] = useState<Awaited<ReturnType<Capture['list']>>>()
  const [proposal, setProposal] = useState<CaptureProposal>(), [fields, setFields] = useState<string[]>([])
  const [evidence, setEvidence] = useState(''), [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const mounted = useRef(true), lock = useRef(false)
  const fresh = () => { setup.context.assertCurrent(); if (!mounted.current) throw Error('Consulta encerrada.') }
  const load = async () => {
    setLoading(true); setError('')
    try {
      if (operation === 'identity') { const result = await setup.identity.read(); fresh(); setIdentity(result) }
      else if (operation === 'recipient') { const result = await setup.wa.recipient(); fresh(); setRecipient(result) }
      else if (operation === 'admission') { const result = await setup.wa.admission(); fresh(); setAdmission(result) }
      else { const result = await setup.capture.list(); fresh(); setCapture(result) }
      setConfirmed(false); setEvidence('')
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Não foi possível consultar.') }
    finally { if (mounted.current) setLoading(false) }
  }
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false } }, [])
  const execute = async (action: () => Promise<unknown>, message?: string) => {
    if (lock.current || loading) return; lock.current = true; setBusy(true); setError('')
    try {
      await action(); fresh()
      if (operation === 'capture') { setProposal(undefined); setFields([]) }
      await refreshConversation(conversation.id); fresh()
      if (message) toast.success(message)
      await load()
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Não foi possível confirmar. Consulte a tentativa.') }
    finally { lock.current = false; if (mounted.current) setBusy(false) }
  }
  const selectProposal = async (id: string) => {
    if (lock.current) return; lock.current = true; setBusy(true); setError(''); setProposal(undefined); setFields([])
    try { const value = await setup.capture.proposal(id); fresh(); setProposal(value) }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Não foi possível consultar a proposta.') }
    finally { lock.current = false; if (mounted.current) setBusy(false) }
  }
  const state = operation === 'recipient' ? recipient?.state : admission?.state
  const receipt = recipient?.receipt, prepared = admission?.prepared, execution = admission?.execution
  const evidenceItems = state?.evidence.complete ? state.evidence.items : []
  let capturePending = false, identityPending = false, storageError = ''
  try { if (proposal) capturePending = setup.capture.pending(proposal.id); if(operation === 'identity') identityPending = setup.identity.pending() } catch { storageError = 'Não foi possível ler a tentativa preservada. Novas alterações estão bloqueadas.' }
  const ready = !loading && !busy && !error && !storageError
  const hasRecipient = recipient?.reply?.canReply === true
  // Somente propostas ainda pendentes (aplicadas, descartadas ou expiradas saem da lista; o motor guarda o histórico).
  const openRows = (capture?.rows ?? []).filter(row => row.status === 'proposed')
  return <Dialog open onOpenChange={open => !open && !lock.current && onClose()}>
    <DialogContent className="sm:max-w-[560px]">
      <DialogHeader><DialogTitle>{titles[operation]}</DialogTitle><DialogDescription>{conversation.title}</DialogDescription></DialogHeader>
      <OpStatus status={loading ? 'running' : error || storageError ? 'error' : 'idle'} progress={{ label: 'Consultando…', percent: 0 }} error={error || storageError} onRetry={() => { if (!lock.current) void load() }} />
      {!loading && operation !== 'capture' && operation !== 'identity' && state && <div className="space-y-4 text-sm">
        {!prepared && !hasRecipient && state.reasonCode && <p className="text-muted-foreground">{reasons[state.reasonCode] ?? `Esta ação não pode ser feita na situação atual da conversa (${state.reasonCode.replaceAll('_', ' ')}). Atualize a conversa e tente novamente.`}</p>}
        {receipt && <p>{hasRecipient ? 'Destinatário confirmado para a próxima resposta.' : 'A confirmação anterior já foi usada ou expirou. Use “Nova confirmação” antes da próxima resposta.'}</p>}
        {operation === 'recipient' && !receipt && <>
          <p>Confira a origem {state.origin?.display ?? '—'} e escolha a entrega cujo destinatário você reconhece.</p>
          <Select value={evidence} onValueChange={value => { setEvidence(value); setConfirmed(false) }} disabled={!ready}>
            <SelectTrigger><SelectValue placeholder="Selecione uma entrega confirmada" /></SelectTrigger>
            <SelectContent>{evidenceItems.map(item => <SelectItem key={item.evidenceId} value={item.evidenceId}>{item.origin.display} → {item.destination.display} · {new Date(item.observedAt).toLocaleString('pt-BR')}</SelectItem>)}</SelectContent>
          </Select>
        </>}
        {operation === 'admission' && !prepared && <>
          <p>Prepare uma resposta única para a mensagem recebida de {state.origin?.display ?? '—'}. O envio exige uma confirmação separada.</p>
          {evidenceItems.length > 0 && <Select value={evidence || 'inbound'} onValueChange={value => { setEvidence(value === 'inbound' ? '' : value); setConfirmed(false) }} disabled={!ready}>
            <SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="inbound">Origem da mensagem recebida</SelectItem>{evidenceItems.map(item => <SelectItem key={item.evidenceId} value={item.evidenceId}>{item.origin.display} → {item.destination.display}</SelectItem>)}</SelectContent>
          </Select>}
        </>}
        {prepared && <p>{execution ? execution.status === 'sent' && execution.localLink === 'linked' ? 'Resposta aceita pelo WhatsApp.' : whatsappJobOnceResolved(execution) ? 'A resposta não foi enviada.' : 'O resultado do envio ainda precisa ser confirmado.' : 'Resposta preparada. Confirme abaixo para gerar e enviar uma vez.'}</p>}
        {(!receipt && operation === 'recipient' || !prepared && operation === 'admission' || prepared && !execution) && <Label className="flex items-start gap-2 font-normal leading-5"><Checkbox checked={confirmed} onCheckedChange={value => setConfirmed(value === true)} disabled={!ready} />{operation === 'recipient' ? 'Reconheço a correspondência entre a origem e o destinatário selecionado.' : prepared ? 'Confirmo a geração e o envio desta resposta única.' : 'Confirmo a preparação desta resposta.'}</Label>}
      </div>}
      {!loading && operation === 'identity' && identity && <div className="space-y-4 text-sm">
        <p>Origem recebida: <strong>{identity.state.destination?.display ?? '—'}</strong></p>
        {identity.state.windowExpiresAt && <p className="text-muted-foreground">Prazo da mensagem: {new Date(identity.state.windowExpiresAt).toLocaleString('pt-BR')}.</p>}
        <p>{identity.state.reviewState === 'valid' ? 'Revisão válida para atendimento humano.' : identity.state.reviewState === 'stale' ? 'A revisão anterior não corresponde mais à origem atual.' : identity.state.reviewState === 'required' ? 'Esta origem aguarda uma revisão humana.' : 'Esta conversa não possui revisão pendente.'}</p>
        {identity.state.reasonCode && <p className="text-muted-foreground">{identityReasons[identity.state.reasonCode]}</p>}
        {identity.receipt && <p className="text-muted-foreground">A decisão anterior foi registrada. Confira acima se ela continua válida.</p>}
        <div className="max-h-[340px] space-y-3 overflow-y-auto rounded-lg border p-3" aria-label="Históricos relacionados">
          {!identity.state.collisions.complete && <p>Não foi possível consultar todos os históricos.</p>}
          {identity.state.collisions.complete && !identity.state.collisions.items.length && <p className="text-muted-foreground">Nenhum histórico relacionado nesta revisão.</p>}
          {identity.state.collisions.items.map((item,index) => <div key={item.conversationId} className="space-y-1">
            <p>{collisionStatus[item.status]}{item.noAi ? ' · IA bloqueada' : ''}{item.humanHandoff ? ' · Atendimento humano' : ''}</p>
            <Link className="text-brand underline underline-offset-2" to={`/app/inbox?id=${encodeURIComponent(item.conversationId)}`} onClick={onClose}>Ver conversa relacionada {index + 1}</Link>
          </div>)}
        </div>
        <p className="text-muted-foreground">Os históricos e bloqueios atuais serão preservados. A revisão permite apenas atendimento humano; não envia mensagens nem ativa respostas de IA.</p>
        {identity.state.canReview && !identityPending && <Label className="flex items-start gap-2 font-normal leading-5"><Checkbox checked={confirmed} onCheckedChange={value => setConfirmed(value === true)} disabled={!ready} />Revisei a origem e os históricos relacionados e confirmo o atendimento humano nesta conversa.</Label>}
      </div>}
      {!loading && operation === 'capture' && capture && <div className="space-y-4">
        {!openRows.length ? <p className="text-sm text-muted-foreground">{capture.rows.length ? `Nenhuma proposta pendente nesta conversa (${capture.rows.length === 1 ? '1 já revisada' : `${capture.rows.length} já revisadas`}).` : 'Nenhuma proposta de dados para esta conversa.'}</p> : <Select value={proposal?.id ?? ''} onValueChange={id => void selectProposal(id)} disabled={busy}>
          <SelectTrigger><SelectValue placeholder="Selecione uma proposta" /></SelectTrigger><SelectContent>{openRows.map((row, i) => <SelectItem key={row.id} value={row.id}>Proposta {i + 1} · {new Date(row.createdAt).toLocaleString('pt-BR')}</SelectItem>)}</SelectContent>
        </Select>}
        {proposal?.reason && proposalReasons[proposal.reason] && <p className="text-xs text-muted-foreground">{proposalReasons[proposal.reason]}</p>}
        {proposal && <div className="max-h-[340px] space-y-3 overflow-y-auto rounded-lg border p-3 text-sm">
          <p className="text-muted-foreground">{proposal.targetContactId ? 'Revise as alterações do contato existente.' : 'Revise os dados para criar o contato.'}</p>
          {!proposal.evidenceAvailable && <p>As evidências desta proposta não estão disponíveis.</p>}
          {proposal.diff.map(field => <div key={field.fieldId} className="space-y-1">
            <Label className="flex items-start gap-2 font-normal"><Checkbox checked={fields.includes(field.fieldId)} disabled={busy || !proposal.evidenceAvailable || capturePending || !!storageError} onCheckedChange={value => setFields(previous => value ? [...previous, field.fieldId] : previous.filter(id => id !== field.fieldId))} /><span><strong>{capture.settings.definitions.find(d => d.id === field.fieldId)?.label ?? ({ firstName: 'Nome', lastName: 'Sobrenome', company: 'Empresa', jobTitle: 'Cargo', address: 'Endereço' } as Record<string, string>)[field.fieldId] ?? 'Campo'}</strong>: {String(field.value)}</span></Label>
            {field.evidence.map((source, i) => <blockquote key={i} className="ml-6 border-l-2 pl-2 text-xs text-muted-foreground">{source.quote}</blockquote>)}
          </div>)}
        </div>}
      </div>}
      <DialogFooter>
        <Button variant="secondary" disabled={busy} onClick={onClose}>Fechar</Button>
        {operation === 'identity' && (identityPending ? <Button disabled={loading || busy || !!storageError} onClick={() => void execute(async () => { const result = await setup.identity.read(); fresh(); setIdentity(result) })}>Consultar tentativa</Button> : <Button disabled={!ready || !canWrite || !canManage || !identity?.state.canReview || !confirmed} onClick={() => void execute(async () => { const result = await setup.identity.apply(identity!.state); fresh(); setIdentity(result) }, 'Revisão de origem registrada')}>Confirmar atendimento humano</Button>)}
        {operation === 'recipient' && (receipt ? <Button disabled={!ready || hasRecipient} onClick={() => void execute(() => setup.wa.resetRecipient())}>Nova confirmação</Button> : <Button disabled={!ready || !canWrite || !canManage || !recipient?.state.canAttest || !evidence || !confirmed} onClick={() => void execute(() => setup.wa.attest(recipient!.state, evidence), 'Destinatário confirmado')}>Confirmar destinatário</Button>)}
        {operation === 'admission' && (prepared ? <>
          {execution && whatsappJobOnceResolved(execution) && admission.state.sourceMessageId !== prepared.sourceMessageId ? <Button disabled={!ready || !canWrite || !canManage} onClick={() => void execute(() => setup.wa.resetCompletedAdmission())}>Nova mensagem</Button> : <Button disabled={!ready || !canWrite || !canManage || !execution && !confirmed} onClick={() => void execute(() => setup.wa.run(prepared))}>{execution ? 'Consultar tentativa' : 'Gerar e enviar'}</Button>}
        </> : <Button disabled={!ready || !canWrite || !canManage || !admission?.state.canAdmit || !confirmed} onClick={() => void execute(() => setup.wa.prepare(admission!.state, evidence || undefined))}>Preparar resposta</Button>)}
        {operation === 'capture' && proposal && (capturePending ? <Button disabled={!ready} onClick={() => void execute(async () => { await setup.capture.consult(proposal.id); await loadArea('contacts', true) }, 'Alteração consultada')}>Consultar tentativa</Button> : <>
          <Button variant="outline" disabled={!ready || !canEditContact} onClick={() => void execute(() => setup.capture.dismiss(proposal), 'Proposta descartada')}>Descartar</Button>
          <Button disabled={!ready || !canEditContact || !fields.length || !proposal.evidenceAvailable} onClick={() => void execute(async () => { await setup.capture.apply(proposal, fields); await loadArea('contacts', true) }, 'Revisão dos dados concluída')}>Aplicar campos</Button>
        </>)}
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
