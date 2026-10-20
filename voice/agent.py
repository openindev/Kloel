"""Isolated Portuguese voice pilot. No CRM access or persistent call recording."""
import asyncio
import logging
import os
from pathlib import Path

from dotenv import dotenv_values, load_dotenv
from livekit import agents, rtc
from livekit.agents import Agent, AgentServer, AgentSession, room_io, function_tool, RunContext
import booking
import engine_client
from livekit import api as lkapi
from livekit.plugins import openai
from livekit.plugins.openai.tools import CodeInterpreter, WebSearch
from livekit.agents import BackgroundAudioPlayer, AudioConfig, BuiltinAudioClip
from livekit.agents.beta.tools import send_dtmf_events
from input_gate import InputNoiseGate, floor_for, gate_session

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / '.env.local', override=False)
# Reuse the explicitly selected Kloel configuration without copying its secrets.
if source := os.environ.get('KLOEL_ENGINE_ENV'):
    values = dotenv_values(source)
    for key in ('OPENAI_API_KEY', 'OPENAI_REALTIME_MODEL'):
        if values.get(key):
            os.environ.setdefault(key, str(values[key]))

AGENT_NAME = 'kloel-phone-pilot'
TWILIO_ROOM_PREFIX = 'kloel-tw-'
VOICE_MODEL = 'gpt-live-1'
BACKEND_MODEL = 'gpt-6-astra'
KNOWLEDGE = (ROOT / 'knowledge.md').read_text() if (ROOT / 'knowledge.md').exists() else ''
INSTRUCTIONS = (
    'Você é Joana, secretária e consultora comercial virtual da Kloel. Converse em português brasileiro, '
    'de forma natural e simpática. Delegue pesquisas, cálculos e pedidos que exijam raciocínio ao assistente de apoio, '
    'que tem pesquisa na web e Python. Use os resultados na conversa naturalmente.\n'
    'Objetivo: entender o negócio da pessoa, mostrar como a Kloel resolve o problema dela e vender um plano; '
    'se ela ainda não estiver pronta, agendar uma demonstração com o Daniel. Deixe claro, com educação e sem pressão, '
    'que a demonstração é para quem pretende contratar a Kloel. Para agendar, colete nome, empresa, e-mail e o '
    'melhor dia e horário (fuso de São Paulo), confirme os dados e use a ferramenta agendar_demo. '
    'Nunca invente preços, recursos ou integrações: use apenas a base de conhecimento abaixo ou pesquisa.\n\n'
    + KNOWLEDGE
)
BACKEND_OPTIONS = {
    'model': BACKEND_MODEL,
    'reasoning': {'effort': 'high'},
    'text': {'verbosity': 'low'},
    'tool_choice': 'auto',
    'instructions': (
        'Resolva o pedido da pessoa usando o contexto da conversa. Pesquise na web '
        'quando solicitado ou quando precisar de informação atual e use Python quando '
        'útil para cálculos e análises. Retorne fatos, fontes e conclusões claras para '
        'Joana comunicar por voz. Só afirme ações e consultas realmente realizadas.'
    ),
}


SALES_GOAL = (
    'Objetivo: entender o negócio da pessoa, mostrar com entusiasmo e precisão como a Kloel resolve o problema dela e vender um plano; '
    'se ela ainda não estiver pronta, agendar uma demonstração com o Daniel. Deixe claro, com educação e sem pressão, que a demonstração '
    'é para quem pretende contratar a Kloel. Antes de agendar, colete nome, empresa, telefone e e-mail, registre com registrar_lead (isso envia automaticamente um e-mail e um WhatsApp de confirmação para a pessoa) e confirme os dados em voz alta. '
    'Use agendar_demo apenas depois disso. Nunca invente preços, recursos ou integrações: use apenas a base de conhecimento ou pesquisa. '
    'Se a pessoa pedir para desligar ou encerrar, despeça-se em uma frase curta e chame encerrar_ligacao imediatamente. '
    'WhatsApp: em toda ligação, depois de entender a necessidade (e antes de encerrar), peça para a pessoa mandar um "oi" no WhatsApp oficial da Kloel, '
    'mais cinco cinco, onze, cinco dois oito seis, três oito zero quatro (diga o número devagar e por extenso, assim), para continuar o atendimento por lá. '
    'Se ela disser que mandou, chame verificar_whatsapp para confirmar que chegou do número dela e diga que a Joana do WhatsApp já vai responder. '
    'Se ela não puder mandar, preferir que você mande, ou se a mensagem não chegou, ofereça e chame enviar_whatsapp com uma mensagem curta e personalizada. '
    'Fale o resultado real da ferramenta: se o envio falhar (por exemplo, modelo ainda não aprovado), diga com honestidade que não conseguiu enviar agora e peça para ela mandar o oi. '
    'WhatsApp DURANTE a ligação: quando a pessoa tiver a janela de WhatsApp aberta (o status inicial indicar janela_whatsapp_aberta, ou verificar_whatsapp retornar window24h=true, ou ela disser que mandou o oi), '
    'use enviar_whatsapp de forma PROATIVA, sem pedir permissão a cada vez, para mandar mensagens curtas ligadas ao que você está explicando: '
    'o plano e o preço que você acabou de citar; o link da página do recurso em https://www.kloel.ai que você mencionou; os próximos passos combinados; e a confirmação do agendamento com data, hora e link do Google Meet assim que agendar_demo der certo. '
    'Regras: no máximo uma mensagem por assunto (passe o assunto em topico), 1 a 3 frases, tom natural de pessoa, sem repetir o que já mandou, só fatos confirmados (preços e links da base de conhecimento). '
    'O envio é em segundo plano: chame a ferramenta e CONTINUE falando normalmente; diga no máximo algo curto como "te mandei no WhatsApp". O resumo final é enviado automaticamente quando a ligação termina, não mande você mesma. '
    'Se a ligação for uma mensagem automática (por exemplo, um código de verificação sendo ditado), fique em silêncio e apenas escute até o fim.'
)


def build_instructions(cfg=None, routed=False):
    cfg = cfg if cfg is not None else engine_client.agent()
    if not cfg:
        return INSTRUCTIONS
    rules = '\n'.join(f"- {r.get('instruction')}" for r in cfg.get('rules', []) if isinstance(r, dict) and r.get('enabled', True))
    tech = cfg.get('technical') or {}
    extra = ''
    if tech.get('technicalTerms'): extra += '\nTermos técnicos (pronuncie e reconheça exatamente assim): ' + ', '.join(tech['technicalTerms']) + '.'
    if tech.get('preciseExtraction'):
        extra += '\nDurante a conversa, colete com precisão estas informações e confirme cada valor repetindo-o para a pessoa (soletre e-mails e números): ' + '; '.join(f"{r['name']} (ex.: {r.get('example') or '-'})" for r in tech['preciseExtraction']) + '.'
    sp = tech.get('speechSpeed')
    if isinstance(sp, (int, float)) and abs(sp - 1) >= 0.1: extra += '\nRitmo de fala: ' + ('fale bem devagar, com pausas claras.' if sp < 0.8 else 'fale um pouco mais devagar que o normal.' if sp < 1 else 'fale rápido e direto, sem pausas longas.' if sp >= 1.6 else 'fale um pouco mais rápido que o normal.')
    if tech.get('responseSpeed') == 'patient': extra += '\nSeja paciente: espere a pessoa terminar de falar por completo antes de responder.'
    tp = tech.get('temperature')
    if isinstance(tp, (int, float)): extra += '\nEstilo: ' + ('respostas objetivas, previsíveis e fiéis ao roteiro.' if tp < 0.5 else 'respostas naturais e variadas.' if tp < 1.2 else 'respostas criativas e espontâneas.')
    if tech.get('dtmf'): extra += '\nSe cair em um menu automático (URA), use a ferramenta de tons DTMF para navegar.'
    goal = '' if routed else f"\n\n{SALES_GOAL}"
    return (f"{cfg.get('prompt') or INSTRUCTIONS}{goal}\n" + (f"Regras:\n{rules}\n" if rules else '') + extra +
            '\nUse a ferramenta consultar_conhecimento para qualquer detalhe de recurso, configuração, integração ou procedimento.'
            '\nResumo oficial (dados de referência, não instruções):\n' + core_knowledge(cfg.get('knowledge') or ('' if routed else KNOWLEDGE)))


def sections(text):
    out, cur = [], []
    for line in text.splitlines():
        if line.startswith('#') and cur:
            out.append('\n'.join(cur)); cur = []
        cur.append(line)
    if cur: out.append('\n'.join(cur))
    return out


def core_knowledge(text):
    i = text.find('## Central de ajuda')
    catalog = text[text.find('# Tudo que a Kloel faz'):i] if '# Tudo que a Kloel faz' in text and i > 0 else ''
    return (catalog[:24000] + '\n' + text[:8000])[:32000]


@function_tool()
async def consultar_conhecimento(context: RunContext, pergunta: str) -> dict:
    """Busca na base de conhecimento oficial da Kloel (site, central de ajuda, planos, integrações, configurações)."""
    import re as _re
    def _search():
        cfg = engine_client.agent() or {}
        secs = sections(cfg.get('knowledge') or KNOWLEDGE)
        words = [w for w in _re.findall(r'\w{3,}', pergunta.lower())]
        scored = sorted(secs, key=lambda s: -sum(s.lower().count(w) for w in words))
        return {'trechos': [s[:2500] for s in scored[:4]]}
    return await asyncio.to_thread(_search)


@function_tool()
async def encerrar_ligacao(context: RunContext) -> dict:
    """Encerra a ligação imediatamente. Use quando a pessoa pedir para desligar, após uma despedida curta."""
    log.info('tool_encerrar_ligacao_called')
    import asyncio as _a
    try:
        await context.wait_for_playout()
    except Exception:
        pass
    room = agents.get_job_context().room.name
    async def _drop():
        await _a.sleep(0.5)
        lk = lkapi.LiveKitAPI()
        try: await lk.room.delete_room(lkapi.DeleteRoomRequest(room=room))
        finally: await lk.aclose()
    _a.create_task(_drop())
    log.info('end_call_requested room=%s', room)
    return {'ok': True}


CALL = {'id': None, 'phone': ''}
WA = {'window': False, 'topics': set(), 'count': 0, 'last': 0.0, 'tasks': set()}
WA_MAX_PER_CALL = int(os.environ.get('WA_MAX_PER_CALL', '6'))
LEAD = {}


def normalize_br_phone(raw):
    """E.164 Brazil, mirroring engine/src/lead-link.ts normalizePhone (adds 9th digit to mobiles)."""
    import re as _re
    raw = str(raw or '').strip()
    if raw.lower().startswith('sip:') or raw.lower().startswith('tel:'): raw = raw[4:]
    raw = raw.split('@')[0]
    d = _re.sub(r'\D', '', raw)
    if not d: return ''
    if not raw.startswith('+'):
        if d.startswith('00'): d = d[2:]
        elif d.startswith('0') and len(d) in (11, 12): d = d[1:]  # 0 + DDD + number (national trunk prefix)
        if len(d) in (10, 11) and not d.startswith('55'): d = '55' + d
    if len(d) < 10: return ''  # short/anonymous caller IDs are not usable
    if d.startswith('55'):
        ddd, rest = d[2:4], d[4:]
        if len(rest) == 8 and rest[0] in '6789': d = '55' + ddd + '9' + rest
    return '+' + d


def _sip_candidates(p):
    a = p.attributes or {}
    out = [a.get('sip.phoneNumber'), a.get('sip.fromUser'), a.get('sip.from'), a.get('sip.callerNumber')]
    ident = p.identity or ''
    if ident.startswith('sip_'): out.append(ident[4:])
    return [x for x in out if x]


def caller_phone():
    try:
        room = agents.get_job_context().room
        for p in room.remote_participants.values():
            if p.kind == rtc.ParticipantKind.PARTICIPANT_KIND_SIP:
                for c in _sip_candidates(p):
                    n = normalize_br_phone(c)
                    if n: return n
        import re as _re
        m = _re.match(r'^kloel-(?:br|phone)-_(\+?\d+)_', room.name or '')
        if m:
            n = normalize_br_phone(m.group(1))
            if n: return n
    except Exception:
        pass
    return CALL.get('phone') or ''


def _log_sip_debug(ctx):
    try:
        for p in ctx.room.remote_participants.values():
            if p.kind == rtc.ParticipantKind.PARTICIPANT_KIND_SIP:
                a = p.attributes or {}
                mask = lambda v: (v[:3] + '***' + v[-2:]) if len(v) > 6 else ('*' * len(v))
                log.info('sip_participant identity=%s attrs=%s', mask(p.identity or ''),
                         {k: (mask(v) if 'phone' in k.lower() or 'from' in k.lower() or 'to' in k.lower() else v) for k, v in a.items() if k.startswith('sip.')})
    except Exception as e:
        log.info('sip_debug_failed %s', e)


@function_tool()
async def verificar_whatsapp(context: RunContext) -> dict:
    """Verifica se já chegou mensagem no WhatsApp oficial da Kloel vinda do número desta ligação."""
    import asyncio as _a
    phone = caller_phone()
    if not phone: return {'ok': False, 'reason': 'numero_do_chamador_desconhecido'}
    r = await _a.to_thread(engine_client.safe, 'POST', 'whatsapp/status', {'phone': phone})
    if (r or {}).get('window24h'): WA['window'] = True
    log.info('whatsapp_status ok=%s received=%s window=%s', bool(r), (r or {}).get('received'), (r or {}).get('window24h'))
    return r or {'ok': False, 'reason': 'indisponivel'}


@function_tool()
async def enviar_whatsapp(context: RunContext, mensagem: str, nome: str = '', topico: str = '') -> dict:
    """Envia em segundo plano uma mensagem de WhatsApp do número oficial da Kloel para o número desta ligação (não pausa a fala).
    mensagem: texto curto em português (1 a 3 frases). topico: assunto curto (ex.: plano_preco, link_recurso, proximos_passos, agendamento), no máximo uma mensagem por tópico."""
    phone = caller_phone()
    if not phone: return {'ok': False, 'reason': 'numero_do_chamador_desconhecido'}
    key = (topico or mensagem[:40]).strip().lower()
    if key in WA['topics']: return {'ok': False, 'reason': 'ja_enviado_sobre_este_topico', 'instrucao': 'Não mande de novo; continue a conversa.'}
    if WA['count'] >= WA_MAX_PER_CALL: return {'ok': False, 'reason': 'limite_de_mensagens_da_ligacao'}
    WA['topics'].add(key); WA['count'] += 1
    send_whatsapp_bg(phone, mensagem, nome, key)
    return {'ok': True, 'status': 'enviando_em_segundo_plano', 'instrucao': 'Continue falando normalmente; no máximo diga que mandou no WhatsApp.'}


def fmt_when(iso: str) -> str:
    try:
        from datetime import datetime
        d = datetime.fromisoformat(iso)
        return d.strftime('%d/%m às %H:%M') + ' (horário de Brasília)'
    except Exception:
        return iso


def send_whatsapp_bg(phone: str, mensagem: str, nome: str = '', topico: str = ''):
    body = {'phone': phone, 'text': mensagem[:1000]}
    if nome: body['name'] = nome[:120]
    if CALL['id']: body['callId'] = CALL['id']
    async def _run():
        r = await asyncio.to_thread(engine_client.safe, 'POST', 'whatsapp/send', body)
        log.info('whatsapp_send topic=%s ok=%s mode=%s reason=%s', topico, (r or {}).get('ok'), (r or {}).get('mode'), (r or {}).get('reason'))
        if not (r or {}).get('ok'): WA['topics'].discard(topico); WA['count'] = max(0, WA['count'] - 1)
    t = asyncio.create_task(_run()); WA['tasks'].add(t); t.add_done_callback(WA['tasks'].discard)


@function_tool()
async def registrar_lead(context: RunContext, nome: str, telefone: str = '', email: str = '', empresa: str = '', observacoes: str = '') -> dict:
    """Registra ou atualiza o lead no CRM da Kloel. telefone em formato +55DDDNUMERO."""
    import asyncio as _a
    body = {'name': nome, 'company': empresa, 'notes': observacoes}
    telefone = telefone or caller_phone()
    if telefone: body['phone'] = telefone
    if CALL['id']: body['callId'] = CALL['id']
    if email: body['email'] = email
    r = await _a.to_thread(engine_client.safe, 'POST', 'leads', body)
    log.info('lead_saved ok=%s', bool(r))
    if not r: return {'ok': False, 'reason': 'crm_indisponivel'}
    LEAD.update({k: v for k, v in (('nome', nome), ('empresa', empresa), ('telefone', telefone), ('email', email)) if v})
    out = dict(r)
    if email or telefone:
        import random as _r
        conf = {'name': nome[:200], 'code': f'{_r.randint(0, 9999):04d}'}
        if email: conf['email'] = email
        if telefone and telefone.startswith('+'): conf['phone'] = telefone
        c = await _a.to_thread(engine_client.safe, 'POST', 'confirm', conf) or {}
        sent = [k for k in ('email', 'whatsapp') if (c.get(k) or {}).get('ok')]
        if sent: LEAD['confirmacao'] = sent
        log.info('lead_confirmation sent=%s', sent)
        out['confirmacao_enviada'] = sent or 'falhou'
    faltando = [k for k in ('nome', 'empresa', 'telefone', 'email') if not LEAD.get(k)]
    out['dados_faltando'] = faltando
    return out


@function_tool()
async def agendar_demo(context: RunContext, nome: str, inicio_iso: str, email: str = '', empresa: str = '', telefone: str = '', observacoes: str = '') -> dict:
    """Agenda uma demonstração da Kloel com o Daniel no Google Agenda, com link do Google Meet.
    inicio_iso: data e hora de início em ISO 8601 no fuso America/Sao_Paulo, ex. 2026-10-21T15:00:00."""
    import asyncio as _a
    faltando = [k for k in ('nome', 'empresa', 'telefone', 'email') if not LEAD.get(k)]
    if faltando or not LEAD.get('confirmacao'):
        log.info('demo_booking_blocked missing=%s confirmed=%s', faltando, bool(LEAD.get('confirmacao')))
        return {'ok': False, 'reason': 'dados_incompletos', 'faltando': faltando, 'confirmacao_enviada': bool(LEAD.get('confirmacao')),
                'instrucao': 'Colete os dados que faltam, confirme com a pessoa e chame registrar_lead antes de agendar.'}
    email = email or LEAD['email']; empresa = empresa or LEAD['empresa']; telefone = telefone or LEAD['telefone']
    try:
        r = await _a.to_thread(booking.book_demo, nome, telefone, inicio_iso, email, empresa, observacoes)
    except Exception as e:
        log.info('demo_booking_failed type=%s', type(e).__name__)
        return {'ok': False, 'reason': 'agenda_indisponivel'}
    log.info('demo_booking ok=%s', r.get('ok'))
    if r.get('ok') and WA['window'] and 'agendamento' not in WA['topics'] and (telefone or caller_phone()):
        link = r.get('meet') or r.get('meetLink') or r.get('hangoutLink') or r.get('link') or ''
        WA['topics'].add('agendamento'); WA['count'] += 1
        send_whatsapp_bg(caller_phone() or telefone, f"Prontinho, {nome.split(' ')[0]}! Sua demonstração da Kloel com o Daniel está confirmada para {fmt_when(r.get('start') or inicio_iso)}." + (f" Link do Google Meet: {link}" if link else '') + ' Qualquer coisa, é só me chamar por aqui 😊', nome, 'agendamento')
        r = {**r, 'whatsapp_confirmacao': 'enviando_em_segundo_plano'}
    return r


def backend_tools():
    return [WebSearch(), CodeInterpreter(container={'type': 'auto'})]

# This pilot streams inference to OpenAI. Admit one call independently of the
# unrelated CPU training workloads on this shared Mac; reject further jobs.
server = AgentServer(host=os.environ.get('HOST','127.0.0.1'), port=int(os.environ.get('PORT','0')), num_idle_processes=int(os.environ.get('NUM_IDLE_PROCESSES', '4')),
                     initialize_process_timeout=60,
                     load_fnc=lambda worker: float(len(worker.active_jobs)) / float(os.environ.get('MAX_CONCURRENT_CALLS', '8')),
                     load_threshold=1.0, log_level='INFO', drain_timeout=30)
log = logging.getLogger('kloel.pilot')


class ObservedLiveModel(openai.realtime.GPTLiveModel):
    """Record tool completion metadata, never callers' speech or tool content."""

    def __init__(self, *, input_floor: float = 0.0, **kwargs):
        super().__init__(**kwargs)
        self.input_gate = InputNoiseGate(input_floor)

    def session(self):
        live_session = gate_session(super().session(), self.input_gate)

        @live_session.on('openai_client_event_queued')
        def configuration_event(event):
            if event.get('type') == 'session.start':
                backend = event.get('session', {}).get('delegation', {}).get('responses', {})
                log.info('backend_config model=%s tools=%s', backend.get('model'),
                         [tool.get('type') for tool in backend.get('tools', [])])

        @live_session.on('openai_server_event_received')
        def provider_event(event):
            if event.get('type') != 'response.event':
                return
            response_event = event.get('event', {})
            event_type = response_event.get('type', '')
            if 'web_search_call' in event_type or 'code_interpreter_call' in event_type:
                log.info('backend_tool_event type=%s', event_type)
            if response_event.get('type') == 'response.output_item.done':
                item = response_event.get('item', {})
                if item.get('type') in ('web_search_call', 'code_interpreter_call'):
                    log.info('backend_tool type=%s status=%s', item.get('type'), item.get('status'))
            elif response_event.get('type') in ('response.completed', 'response.failed'):
                response = response_event.get('response', {})
                log.info('backend_response event=%s model=%s',
                         response_event.get('type'), response.get('model'))

        return live_session


VOICEMAIL_RE = None
TRANSFER = {'targets': [], 'free': False, 'room': '', 'identity': ''}


@function_tool
async def transferir_ligacao(context: RunContext, destino: str) -> dict:
    """Transfere a ligação atual para outra pessoa/número. destino: o nome/rótulo de um destino configurado ou, se permitido, um número em formato +55DDDNUMERO."""
    d = (destino or '').strip()
    tgt = next((t for t in TRANSFER['targets'] if d and (d.lower() in (t.get('label') or '').lower() or d == t.get('destination'))), None)
    if not tgt and len(TRANSFER['targets']) == 1 and not TRANSFER['free']: tgt = TRANSFER['targets'][0]
    to = (tgt or {}).get('destination') or ''
    if not to and TRANSFER['free']:
        to = normalize_br_phone(d) or ''
    if not to: return {'ok': False, 'motivo': 'destino_nao_permitido', 'destinos': [t.get('label') for t in TRANSFER['targets']]}
    if tgt and tgt.get('id'):
        chk = await asyncio.to_thread(engine_client.safe, 'POST', 'transfer/check', {'id': tgt['id']})
        if chk is not None and not chk.get('ok'):
            log.info('call_transfer blocked reason=%s', chk.get('reason'))
            asyncio.get_event_loop().run_in_executor(None, engine_client.safe, 'POST', 'transfer/failed', {'id': tgt['id'], 'phone': CALL.get('phone') or '', 'reason': chk.get('reason') or 'indisponivel', **({'callId': CALL['id']} if CALL.get('id') else {})})
            return {'ok': False, 'motivo': chk.get('reason'), 'orientacao': 'Explique que não é possível transferir agora, ofereça anotar o recado ou outro canal.'}
    if not TRANSFER['identity']: return {'ok': False, 'motivo': 'sem_participante_sip'}
    uri = to if to.startswith('sip') else 'tel:' + to
    lk = lkapi.LiveKitAPI()
    try:
        await lk.sip.transfer_sip_participant(lkapi.TransferSIPParticipantRequest(room_name=TRANSFER['room'], participant_identity=TRANSFER['identity'], transfer_to=uri, play_dialtone=True))
        log.info('call_transfer ok=True kind=%s', 'listed' if tgt else 'free')
        return {'ok': True}
    except Exception as e:
        log.info('call_transfer ok=False err=%s', str(e)[:160])
        if tgt and tgt.get('id'):
            asyncio.get_event_loop().run_in_executor(None, engine_client.safe, 'POST', 'transfer/failed', {'id': tgt['id'], 'phone': CALL.get('phone') or '', 'reason': 'falha_sip', **({'callId': CALL['id']} if CALL.get('id') else {})})
        return {'ok': False, 'motivo': 'falha_na_transferencia'}
    finally:
        await lk.aclose()


EMAILS = {'during': []}


@function_tool
async def enviar_email(context: RunContext, acao: str = '') -> dict:
    """Envia agora um e-mail configurado (ação "Enviar e-mail" com execução "A qualquer momento"). acao: o nome da ação; vazio = todas as que se aplicam."""
    if not CALL.get('id'): return {'ok': False, 'motivo': 'sem_conversa'}
    a = (acao or '').strip().lower()
    tgt = next((e for e in EMAILS['during'] if a and a in (e.get('name') or '').lower()), None)
    body = {'phone': CALL.get('phone') or '', **({'id': tgt['id']} if tgt else {})}
    r = await asyncio.to_thread(engine_client.safe, 'POST', f"calls/{CALL['id']}/email", body)
    log.info('email_during ok=%s sent=%s', (r or {}).get('ok'), (r or {}).get('sent'))
    if not r or not r.get('ok') or not r.get('sent'): return {'ok': False, 'motivo': (r or {}).get('reason') or 'nao_enviado'}
    return {'ok': True, 'enviados': r.get('sent')}


REC = {'egress': None}


@function_tool
async def recusar_gravacao(context: RunContext) -> dict:
    """Chame quando a pessoa disser que NÃO autoriza/não quer que a ligação seja gravada. Para e apaga a gravação."""
    lk = lkapi.LiveKitAPI()
    try:
        if REC['egress']: await lk.egress.stop_egress(lkapi.StopEgressRequest(egress_id=REC['egress']))
    except Exception as e: log.info('recording_stop_failed %s', type(e).__name__)
    finally: await lk.aclose()
    REC['egress'] = None
    if CALL.get('id'): await asyncio.to_thread(engine_client.safe, 'POST', f"calls/{CALL['id']}/recording/delete", {})
    log.info('recording_refused_deleted')
    return {'ok': True, 'orientacao': 'Confirme que a gravação foi interrompida e apagada e continue o atendimento.'}


async def start_recording(room_name, tenant, call_id):
    e = os.environ
    if not (e.get('REC_S3_ACCESS_KEY') and e.get('REC_S3_SECRET') and e.get('REC_S3_BUCKET') and e.get('REC_S3_ENDPOINT') and tenant and call_id): return None
    key = f'rec/{tenant}/{call_id}.ogg'
    lk = lkapi.LiveKitAPI()
    try:
        r = await lk.egress.start_room_composite_egress(lkapi.RoomCompositeEgressRequest(room_name=room_name, audio_only=True,
            file_outputs=[lkapi.EncodedFileOutput(file_type=lkapi.EncodedFileType.OGG, filepath=key, disable_manifest=True,
                s3=lkapi.S3Upload(access_key=e['REC_S3_ACCESS_KEY'], secret=e['REC_S3_SECRET'], bucket=e['REC_S3_BUCKET'], region=e.get('REC_S3_REGION') or 'auto',
                                  endpoint=e['REC_S3_ENDPOINT'], force_path_style=e.get('REC_S3_PATH_STYLE') == '1'))]))
        log.info('recording_started egress=%s', r.egress_id)
        REC['egress'] = r.egress_id
        await asyncio.to_thread(engine_client.safe, 'POST', f'calls/{call_id}/recording', {'key': key, 'egressId': r.egress_id})
        return r.egress_id
    except Exception as ex:
        log.info('recording_failed %s', str(ex)[:200]); return None
    finally:
        await lk.aclose()


def _is_voicemail(text):
    import re as _re
    global VOICEMAIL_RE
    if VOICEMAIL_RE is None:
        VOICEMAIL_RE = _re.compile(r'caixa postal|deixe (sua|seu|a sua) (mensagem|recado)|ap[oó]s o (sinal|bipe|beep)|grave (sua|seu) (mensagem|recado)|n[aã]o (est[aá]|pode) (dispon[ií]vel|atender)|fora da [aá]rea de cobertura|desligado ou fora|mensagem (gravada|de voz)|o n[uú]mero (chamado|discado)|servi[cç]o de recado|voicemail|leave (a|your) message', _re.I)
    return bool(VOICEMAIL_RE.search(text or ''))

MAX_INSTRUCTION_CHARS = int(os.environ.get('MAX_INSTRUCTION_CHARS', '36000'))  # ~ <16k tokens


class _QuietClosed(logging.Filter):
    def filter(self, record):
        msg = record.getMessage()
        return 'room session transport is closed' not in msg and 'room session transport is closed' not in str(record.exc_info or '')
logging.getLogger('livekit.agents').addFilter(_QuietClosed())


@server.rtc_session(agent_name=AGENT_NAME)
async def entrypoint(ctx: agents.JobContext):
    import json as _j
    t_job = asyncio.get_event_loop().time()
    direction = 'outbound' if ctx.job.room.name.startswith('kloel-out-') else 'inbound'
    try: md = _j.loads(ctx.job.metadata or '{}') or {}
    except Exception: md = {}
    await ctx.connect()
    # Wait for the SIP participant so the caller number (and CRM context) is known BEFORE the session starts.
    phone, src = '', ''
    for _ in range(40):
        phone = caller_phone()
        if phone: src = 'sip_attrs_or_room'; break
        if any(p.kind == rtc.ParticipantKind.PARTICIPANT_KIND_SIP for p in ctx.room.remote_participants.values()) and _ >= 6: break
        await asyncio.sleep(0.25)
    _log_sip_debug(ctx)
    if not phone and md.get('phone'):
        phone, src = normalize_br_phone(md.get('phone')) or '', 'dispatch_metadata'
    CALL['phone'] = phone
    routed = False
    if ctx.job.room.name.startswith(TWILIO_ROOM_PREFIX):
        called = ''
        for p in ctx.room.remote_participants.values():
            if p.kind == rtc.ParticipantKind.PARTICIPANT_KIND_SIP:
                a = p.attributes or {}; called = a.get('sip.trunkPhoneNumber') or a.get('sip.toUser') or ''
        rt = await asyncio.to_thread(engine_client.number_route, called) if called else None
        if rt and rt.get('tenantId'):
            engine_client.set_route(rt['tenantId'], rt.get('agentId') or '')
            routed = rt['tenantId'] != os.environ.get('PROVIDER_TENANT_ID', '')
        log.info('number_route found=%s routed_org=%s has_agent=%s', bool(rt), routed, bool((rt or {}).get('agentId')))
    WA.update({'window': False, 'topics': set(), 'count': 0})
    log.info('caller_phone_known=%s source=%s direction=%s', bool(phone), src or 'none', direction)
    wa_status, call, instructions = await asyncio.gather(
        asyncio.to_thread(engine_client.safe, 'POST', 'whatsapp/status', {'phone': phone}) if phone else asyncio.sleep(0, None),
        asyncio.to_thread(engine_client.safe, 'POST', 'calls', {'room': ctx.job.room.name, 'direction': direction, **({'externalContact': phone} if phone else {})}),
        asyncio.to_thread(engine_client.agent))
    if (call or {}).get('blocked'):
        log.info('caller_blocked_hangup')
        try: ctx.shutdown(reason='contact_blocked')
        except Exception: pass
        return
    cfg = instructions or {}
    tech = cfg.get('technical') or {}
    sipp = next((p for p in ctx.room.remote_participants.values() if p.kind == rtc.ParticipantKind.PARTICIPANT_KIND_SIP), None)
    TRANSFER.update({'targets': cfg.get('transfers') or [], 'free': bool(tech.get('freeTransfer')), 'room': ctx.room.name, 'identity': sipp.identity if sipp else ''})
    instructions = build_instructions(instructions, routed)
    EMAILS['during'] = cfg.get('emailsDuring') or []
    if EMAILS['during']:
        instructions += '\nE-mails: você pode chamar enviar_email durante a ligação. Ações: ' + '; '.join(f"{e.get('name')}: {e.get('when')}" for e in EMAILS['during']) + '. Envie no máximo uma vez cada e diga à pessoa que o e-mail foi enviado.'
    if TRANSFER['targets'] or TRANSFER['free']:
        instructions += '\nTransferência: quando a pessoa pedir para falar com alguém ou o caso exigir, avise que vai transferir e chame transferir_ligacao. Destinos: ' + '; '.join(f"{t.get('label')}: {t.get('description') or ''}" for t in TRANSFER['targets']) + ('. Também pode transferir para um número que a pessoa informar.' if TRANSFER['free'] else '.')
    if tech.get('recordAudio'):
        instructions += '\nEsta ligação é gravada: informe isso brevemente na saudação inicial.' + (' Se a pessoa não autorizar a gravação, chame recusar_gravacao.' if tech.get('autoDeleteOnRefusal') else '')
    WA['window'] = bool((wa_status or {}).get('window24h'))
    log.info('whatsapp_window_at_start=%s', WA['window'])
    call_id = (call or {}).get('conversationId')
    CALL['id'] = call_id
    LEAD.clear()
    parts = []
    if md.get('notes'): parts.append('Contexto sobre este lead (enviado por quem pediu a ligação): ' + str(md['notes'])[:2000])
    kl = (call or {}).get('knownLead') or {}
    crm = ', '.join(f'{k}: {v}' for k, v in (('nome', kl.get('name')), ('empresa', kl.get('company')), ('e-mail', kl.get('email'))) if v)
    if crm: parts.append('Dados do CRM deste lead: ' + crm + '.')
    if kl.get('notes'): parts.append('Notas do CRM sobre este lead: ' + str(kl['notes'])[-2000:])
    ctx_text = ('\n\n' + '\n'.join(parts) + '\nUse esse contexto naturalmente (não leia em voz alta, não diga que tem notas).') if parts else ''
    status_text = '\n(Status interno: janela_whatsapp_aberta=sim — você pode mandar mensagens de WhatsApp proativas durante a ligação com enviar_whatsapp.)' if WA['window'] else ''
    room_left = MAX_INSTRUCTION_CHARS - len(ctx_text) - len(status_text)
    if len(instructions) > room_left: log.info('instructions_trimmed from=%s to=%s', len(instructions), room_left)
    instructions = instructions[:room_left] + ctx_text + status_text
    log.info('lead_context_injected notes=%s crm=%s crm_notes=%s chars=%s', bool(md.get('notes')), bool(crm), bool(kl.get('notes')), len(instructions))

    st_secs = tech.get('silenceTimeout')
    live_model = ObservedLiveModel(model=VOICE_MODEL, voice='marin', responses_options=BACKEND_OPTIONS, input_floor=floor_for(tech.get('sensitivity')))
    session = AgentSession(llm=live_model,
                           **({'turn_handling': {'interruption': {'enabled': False}}} if tech.get('noInterruptions') else {}),
                           user_away_timeout=float(st_secs) if st_secs else 15.0)
    log.info('technical_settings applied=%s', sorted(k for k, v in tech.items() if v not in (None, '', [], False)))
    state = {'closing': False, 'voicemail': False, 'answered_at': None}

    @session.on('error')
    def _err(ev):
        err = getattr(ev, 'error', ev)
        log.warning('session_error recoverable=%s type=%s %s', getattr(err, 'recoverable', None), type(err).__name__, str(err)[:300])

    @session.on('close')
    def _closed(ev):
        state['closing'] = True
        log.info('session_close reason=%s input_floor=%.4f muted_s=%.1f', getattr(ev, 'reason', ''), live_model.input_gate.floor, live_model.input_gate.muted_seconds)

    await session.start(
        room=ctx.room,
        agent=Agent(instructions=instructions, tools=[*backend_tools(), *(() if routed else (agendar_demo, registrar_lead)), encerrar_ligacao, consultar_conhecimento, verificar_whatsapp, enviar_whatsapp, *((send_dtmf_events,) if tech.get('dtmf') else ()), *((transferir_ligacao,) if (cfg.get('transfers') or tech.get('freeTransfer')) else ()), *((recusar_gravacao,) if (tech.get('recordAudio') and tech.get('autoDeleteOnRefusal')) else ()), *((enviar_email,) if EMAILS['during'] else ())]),
        record=False,
        room_options=room_io.RoomOptions(
            audio_input=True, audio_output=True, video_input=False,
            text_input=False,
            text_output=ctx.job.room.name.startswith('kloel-audio-check-'),
            close_on_disconnect=True, delete_room_on_close=True,
            participant_kinds=[rtc.ParticipantKind.PARTICIPANT_KIND_SIP,
                               rtc.ParticipantKind.PARTICIPANT_KIND_STANDARD],
        ),
    )
    started = asyncio.get_event_loop().time()
    if tech.get('ambientSound'):
        try:
            clip = BuiltinAudioClip.OFFICE_AMBIENCE if tech['ambientSound'] == 'office' else BuiltinAudioClip.KEYBOARD_TYPING
            bg = BackgroundAudioPlayer(ambient_sound=AudioConfig(clip, volume=max(0.0, min(1.0, float(30 if tech.get('ambientVolume') is None else tech['ambientVolume']) / 100))))
            await bg.start(room=ctx.room, agent_session=session)
            log.info('ambient_sound_started kind=%s', tech['ambientSound'])
        except Exception as e: log.info('ambient_sound_failed %s', type(e).__name__)

    async def _drop_room():
        lk = lkapi.LiveKitAPI()
        try: await lk.room.delete_room(lkapi.DeleteRoomRequest(room=ctx.room.name))
        except Exception: pass
        finally: await lk.aclose()

    @session.on('conversation_item_added')
    def _item(ev):
        item = ev.item
        text = getattr(item, 'text_content', None) or ''
        role = getattr(item, 'role', '?')
        log.info('transcript role=%s chars=%s', role, len(text))  # LGPD: never log speech content
        if direction == 'outbound' and role == 'user' and state['answered_at'] and not state['voicemail']:
            if asyncio.get_event_loop().time() - state['answered_at'] < 25:
                state['early_words'] = state.get('early_words', 0) + len(text.split())
                # AMD heuristic: long uninterrupted monologue right after pickup = machine/voicemail greeting.
                if state['early_words'] >= int(os.environ.get('AMD_MONOLOGUE_WORDS', '30')) and not state.get('agent_spoke_reply'):
                    text = text + ' caixa postal'
        if direction == 'outbound' and role == 'user' and not state['voicemail'] and asyncio.get_event_loop().time() - started < 45 and _is_voicemail(text):
            state['voicemail'] = True
            log.info('voicemail_detected reason=keywords_or_monologue room=%s', ctx.room.name)
            if call_id and phone:
                asyncio.get_event_loop().run_in_executor(None, engine_client.safe, 'POST', f'calls/{call_id}/missed', {'phone': phone, 'reason': 'voicemail'})
            asyncio.ensure_future(_drop_room())
            return
        if call_id and text and role in ('user', 'assistant'):
            asyncio.get_event_loop().run_in_executor(None, engine_client.safe, 'POST', f'calls/{call_id}/messages', {'role': role, 'content': text})

    @session.on('user_input_transcribed')
    def _user(ev):
        if getattr(ev, 'is_final', False): log.info('heard chars=%s', len(ev.transcript or ''))

    @session.on('agent_state_changed')
    def _state(ev):
        log.info('agent_state %s->%s', ev.old_state, ev.new_state)
        if ev.new_state == 'speaking' and state['answered_at'] and not state.get('first_speech_ms'):
            state['first_speech_ms'] = int((asyncio.get_event_loop().time() - state['answered_at']) * 1000)
            log.info('greeting_first_audio_ms=%s', state['first_speech_ms'])
        elif ev.new_state == 'speaking' and state.get('early_words'): state['agent_spoke_reply'] = True
        if ev.new_state == 'speaking': state['agent_turns'] = state.get('agent_turns', 0) + 1

    @session.on('user_state_changed')
    def _ustate(ev):
        if getattr(ev, 'new_state', '') == 'speaking':
            state['user_spoke'] = True
        if getattr(ev, 'new_state', '') == 'away' and st_secs and (direction == 'inbound' or state.get('answered_at') is not None) and not state['closing'] and not state['voicemail']:
            log.info('silence_timeout_reached secs=%s', st_secs)
            async def _bye():
                try:
                    await session.generate_reply(instructions='A pessoa ficou em silêncio por muito tempo. Despeça-se em uma frase curta.')
                    await asyncio.sleep(5)
                except Exception: pass
                await _drop_room()
            asyncio.ensure_future(_bye())

    async def _silence_amd():
        # AMD heuristic 2: pickup followed by total silence (no human 'alô') -> voicemail/dead air.
        await asyncio.sleep(float(os.environ.get('AMD_SILENCE_SECONDS', '25')))
        if direction == 'outbound' and state['answered_at'] and not state.get('early_words') and not state.get('user_spoke') and state.get('agent_turns', 0) <= 1 and not state['voicemail'] and not state['closing']:
            state['voicemail'] = True
            log.info('voicemail_detected reason=silence room=%s', ctx.room.name)
            if call_id and phone:
                await asyncio.to_thread(engine_client.safe, 'POST', f'calls/{call_id}/missed', {'phone': phone, 'reason': 'silence'})
            await _drop_room()

    log.info('pilot_session_started model=%s backend=%s voice=marin setup_ms=%s', VOICE_MODEL, BACKEND_MODEL, int((started - t_job) * 1000))

    async def limit_call():
        await asyncio.sleep(int(tech['maxCallDuration']) * 60 if tech.get('maxCallDuration') else int(os.environ.get('MAX_CALL_SECONDS', '1200')))
        log.info('pilot_call_limit_reached')
        try:
            if not state['closing']:
                await session.generate_reply(instructions='Avise com educação que o tempo da ligação acabou, ofereça continuar pelo WhatsApp e despeça-se.')
                await asyncio.sleep(8)
        except Exception: pass
        try: await session.aclose()
        except Exception: pass

    timer = asyncio.create_task(limit_call())

    async def cleanup():
        state['closing'] = True
        timer.cancel()
        await asyncio.gather(timer, return_exceptions=True)
        try: await session.aclose()
        except Exception as e: log.info('session_aclose_failed %s', e)
        if call_id:
            await asyncio.to_thread(engine_client.safe, 'POST', f'calls/{call_id}/end', {'durationSeconds': int(asyncio.get_event_loop().time() - started)})
            if WA['tasks']: await asyncio.gather(*list(WA['tasks']), return_exceptions=True)
            p = caller_phone() or phone
            if not state['voicemail']:
                act = await asyncio.to_thread(engine_client.safe, 'POST', f'calls/{call_id}/actions', {'phone': p} if p else {}, 60)
                log.info('call_actions sent=%s reason=%s', (act or {}).get('sent'), (act or {}).get('reason'))
            if state['voicemail']:
                log.info('call_recap skipped reason=voicemail')
            elif p:
                rc = await asyncio.to_thread(engine_client.safe, 'POST', f'calls/{call_id}/recap', {'phone': p}, 45)
                log.info('call_recap ok=%s reason=%s', (rc or {}).get('ok'), (rc or {}).get('reason'))
        log.info('pilot_session_closed')

    ctx.add_shutdown_callback(cleanup)

    # Outbound: greet the instant the lead picks up (the SIP leg is "dialing/ringing" until then).
    if direction == 'outbound':
        for _ in range(600):
            sp = [p for p in ctx.room.remote_participants.values() if p.kind == rtc.ParticipantKind.PARTICIPANT_KIND_SIP]
            if not sp or state['closing']: break
            if (sp[0].attributes or {}).get('sip.callStatus') == 'active': break
            await asyncio.sleep(0.1)
        state['answered_at'] = asyncio.get_event_loop().time()
        asyncio.create_task(_silence_amd())
        log.info('outbound_answered wait_ms=%s', int((state['answered_at'] - started) * 1000))
    if state['closing'] or state['voicemail']:
        log.info('greeting_skipped_session_closing'); return
    if tech.get('recordAudio') and call_id:
        asyncio.create_task(start_recording(ctx.room.name, cfg.get('tenantId') or '', call_id))
    try:
        g = (cfg.get('greeting') or cfg.get('initialMessage') or '').strip()
        gi = (f'Diga exatamente esta saudação inicial e aguarde a pessoa falar: "{g}"' if g and routed else 'Dê uma breve saudação, diga seu nome e empresa e aguarde a pessoa falar.')
        await session.generate_reply(instructions=gi, **({'allow_interruptions': False} if tech.get('protectGreeting') else {}))
        log.info('greeting_sent latency_ms=%s', int((asyncio.get_event_loop().time() - (state['answered_at'] or started)) * 1000))
    except Exception as e:
        log.info('greeting_skipped_session_closing %s', e)


if __name__ == '__main__':
    agents.cli.run_app(server)

