import type { TelephonyService } from '@/services/types'
import { captureEngineContext, engineSession } from '@/services/engine/session'
import { AgentVoiceSession } from '@/services/engine/agent-voice'
import { createAgentTestService } from '@/services/engine/agent-test'
import { createBeforeContextService } from '@/services/engine/before-context'
import { parseBeforeVoiceIntent } from '@/services/engine/before-voice'
import { createVoiceOperationsService } from '@/services/engine/voice-operations'

/** The original call dialog consumes actual WebRTC events; no invented transcript or local conversation. */
export const startTestCall: TelephonyService['startTestCall'] = (agent, _knowledge, onEvent) => {
  const context = captureEngineContext()
  if (agent.orgId !== context.tenantId) throw new Error('Atualize o assistente antes de iniciar a ligação.')
  const operationKey = crypto.randomUUID()
  const audio = new Audio()
  audio.autoplay = true
  let call: AgentVoiceSession | undefined
  let stopped = false, ended = false
  let phase = '', startedAt = 0
  const seen = new Set<string>()
  const stopAudio = () => { audio.pause(); audio.srcObject = null }
  const finish = (reason?: string) => {
    if (ended) return
    ended = true
    stopAudio()
    unsubscribe()
    const state = call?.snapshot()
    onEvent({ type: 'ended', reason, conversationId: state?.conversationId, stopStatus: state?.stopStatus ?? (call ? 'unconfirmed' : 'not_started') })
  }
  const hangup = () => {
    stopped = true
    stopAudio()
    if (call) void call.stop().then(() => finish(call?.snapshot().error))
    else finish()
  }
  const unsubscribe = engineSession.subscribe(() => {
    try { context.assertCurrent() } catch { hangup() }
  })
  void (async () => {
    try {
      onEvent({ type: 'status', status: 'connecting' })
      const recovery = createVoiceOperationsService(context, { agentId: agent.id })
      let cursor: string | undefined
      for (let page = 0; ; page++) {
        if (page >= 1000) throw new Error('Não foi possível conferir as ligações anteriores. Tente novamente.')
        const previous = await recovery.list({ cursor, limit: 50 })
        if (previous.items.some(item => item.hangupStatus !== 'accepted' && !(item.status === 'failed' && !item.callId))) {
          throw new Error('Confira o encerramento da ligação anterior em Conversas antes de iniciar outra.')
        }
        if (!previous.nextCursor) break
        cursor = previous.nextCursor
      }
      const availability = await createBeforeContextService(context, agent.id).availability()
      context.assertCurrent()
      if (stopped) return
      const before = availability.enabled ? parseBeforeVoiceIntent({ expectedRevision: availability.revision, mode: 'test',
        ...(availability.httpSource ? { expectedHttpRevision: availability.httpSource.revision } : {}) }) : undefined
      call = new AgentVoiceSession(createAgentTestService(context, agent.id), {
        peer: () => new RTCPeerConnection(),
        microphone: () => navigator.mediaDevices.getUserMedia({ audio: true }),
        assertCurrent: context.assertCurrent,
        audio: stream => {
          context.assertCurrent()
          if (stopped) { stream.getTracks().forEach(track => track.stop()); return }
          audio.srcObject = stream
          void audio.play().catch(() => { hangup(); finish('Não foi possível reproduzir o áudio. Verifique a permissão do navegador.') })
        },
        armAudio: async stream => { context.assertCurrent(); audio.srcObject = stream; await audio.play() },
        stopAudio,
        change: state => {
          if (ended) return
          if (state.phase === 'live' && phase !== 'live') {
            startedAt = state.startedAt ?? Date.now()
            onEvent({ type: 'status', status: 'live', conversationId: state.conversationId })
          }
          phase = state.phase
          for (const line of state.transcripts) {
            if (seen.has(line.id)) continue
            seen.add(line.id)
            onEvent({ type: 'line', conversationId: state.conversationId, line: { t: Math.max(0, Math.round((Date.now() - (startedAt || Date.now())) / 1000)), speaker: line.role === 'user' ? 'caller' : 'assistant', text: line.text } })
          }
          if (state.phase === 'ended' || state.phase === 'error') finish(state.error)
        },
      }, operationKey, before)
      await call.start(true)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível iniciar a ligação.'
      if (call) { await call.stop(); finish(message) } else finish(message)
    }
  })()
  return {
    operationKey,
    get conversationId() { return call?.snapshot().conversationId },
    hangup,
    mute: value => call?.mute(value),
    say: () => { throw new Error('Use o microfone para falar durante a ligação.') },
  }
}
