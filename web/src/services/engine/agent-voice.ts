import type { AgentTestService, VoiceOperation } from './agent-test'
import { EngineError } from './http'
import { parseBeforeVoiceIntent, parseBeforeVoiceMetadata, type BeforeVoiceIntent, type BeforeVoiceMetadata } from './before-voice'
export interface VoiceView {
  phase: 'idle' | 'permission' | 'connecting' | 'live' | 'stopping' | 'ended' | 'error'
  operationKey: string; conversationId?: string; callId?: string; bytesReceived: number; startedAt?: number
  beforeContext?: BeforeVoiceMetadata; playbackRequired?: boolean; preparationChecking?: boolean
  muted: boolean; transcripts: Array<{ id: string; role: 'user' | 'assistant'; text: string }>
  stopStatus?: 'not_started' | 'accepted' | 'unconfirmed'; error?: string
}
export interface VoiceDependencies {
  peer: () => RTCPeerConnection
  microphone: () => Promise<MediaStream>
  audio: (stream: MediaStream) => void
  armAudio?: (stream: MediaStream) => Promise<void>
  stopAudio?: () => void
  assertCurrent?: () => void
  beforeStart?: () => void
  change: (state: VoiceView) => void
  interval?: typeof setInterval
  clearInterval?: typeof clearInterval
  timeout?: typeof setTimeout
  clearTimeout?: typeof clearTimeout
}

/** UI media belongs to one attempt; remote ownership is the backend operation key. */
export class AgentVoiceSession {
  private state: VoiceView
  private pc?: RTCPeerConnection
  private stream?: MediaStream
  private dc?: RTCDataChannel
  private heartbeat?: ReturnType<typeof setInterval>
  private stats?: ReturnType<typeof setInterval>
  private connectionDeadline?: ReturnType<typeof setTimeout>
  private finishIce?: () => void
  private statsBusy = false
  private stopped = false
  private requested = false
  private stopPromise?: Promise<void>
  private transportClosed = false
  private heartbeatBusy = false
  private before?: BeforeVoiceIntent
  private remoteStream?: MediaStream
  private remoteInstalled = false
  private activationSent = false
  private arming = false
  private preparationRead?: Promise<void>
  private preparationPending = false
  private statusTicket = 0
  private publishedTicket = 0
  constructor(private api: AgentTestService, private dependencies: VoiceDependencies, key = crypto.randomUUID(), before?: BeforeVoiceIntent) {
    this.before = before === undefined ? undefined : parseBeforeVoiceIntent(before)
    this.state = { phase: 'idle', operationKey: key, bytesReceived: 0, muted: false, transcripts: [] }
  }
  snapshot = () => this.state
  private change(patch: Partial<VoiceView>) { this.state = { ...this.state, ...patch }; this.dependencies.change(this.state) }
  private localStop() {
    if (this.heartbeat !== undefined) (this.dependencies.clearInterval ?? clearInterval)(this.heartbeat)
    if (this.stats !== undefined) (this.dependencies.clearInterval ?? clearInterval)(this.stats)
    this.clearConnectionDeadline(); this.finishIce?.()
    this.heartbeat = undefined; this.stats = undefined
    this.stream?.getTracks().forEach(track => { track.enabled = false; track.stop() })
    this.preparationPending = false; this.dependencies.stopAudio?.()
    // Keep transport until the bounded hangup finishes; capture/playback stop immediately.
  }

  private closeTransport() {
    if (this.transportClosed) return
    this.transportClosed = true
    this.dc?.close(); this.pc?.close()
  }
  private clearConnectionDeadline() {
    if (this.connectionDeadline !== undefined) (this.dependencies.clearTimeout ?? clearTimeout)(this.connectionDeadline)
    this.connectionDeadline = undefined
  }
  private remoteState(operation: VoiceOperation) {
    const stopStatus = this.state.stopStatus === 'accepted' || operation.hangupStatus === 'accepted' ? 'accepted'
      : operation.status === 'failed' && !operation.callId && !this.state.callId ? 'not_started' : 'unconfirmed'
    this.change({ ...(operation.callId ? { callId: operation.callId } : {}), ...(operation.conversationId ? { conversationId: operation.conversationId } : {}), stopStatus })
  }
  private current() {
    if (this.stopped) return false
    try { this.dependencies.assertCurrent?.(); return true }
    catch { void this.stop(); return false }
  }
  private readFailure(error: unknown) {
    if (!this.current()) return
    if (!(error instanceof EngineError) || error.status === 401 || error.status === 403 || ['invalid_before_voice','invalid_response','superseded','context_mismatch','context_changed_in_flight'].includes(error.code)) void this.stop()
  }
  private inputGate() {
    const enabled = !this.stopped && !this.state.muted && (!this.before || this.state.beforeContext?.mediaStage === 'conversation')
    this.stream?.getAudioTracks().forEach(track => { track.enabled = enabled })
  }
  private publishPreparation(operation: VoiceOperation, ticket: number) {
    if (!this.current() || ticket < this.publishedTicket) return
    if (operation.operationKey !== this.state.operationKey || this.state.callId && operation.callId !== this.state.callId || this.state.conversationId && operation.conversationId !== this.state.conversationId) throw Error('A referência de voz não corresponde à tentativa atual.')
    const metadata = parseBeforeVoiceMetadata(operation.beforeContext, this.state.beforeContext, this.before)
    this.publishedTicket = ticket
    this.change({ beforeContext: metadata, error: undefined })
    if (operation.cancelRequested || operation.hangupStatus === 'accepted' || operation.status !== 'succeeded' || metadata.mediaStage === 'blocked') {
      this.inputGate(); void this.stop(); return
    }
    this.inputGate()
  }
  private waitingForPreparation() {
    return !!this.before && this.activationSent && !this.stopped && this.pc?.connectionState === 'connected' && this.state.beforeContext?.mediaStage !== 'conversation'
  }
  private preparationEvent() {
    if (!this.waitingForPreparation() || !this.current()) return
    if (this.preparationRead) { this.preparationPending = true; return }
    void this.consultPreparation()
  }
  consultPreparation(): Promise<void> {
    if (!this.before || !this.activationSent || !this.current()) return Promise.resolve()
    if (this.preparationRead) return this.preparationRead
    const ticket = ++this.statusTicket
    this.change({ preparationChecking: true })
    this.preparationRead = (async () => {
      try { const operation = await this.api.voiceOperation(this.state.operationKey); this.publishPreparation(operation, ticket) }
      catch (error) {
        this.readFailure(error)
        if (this.current()) this.change({ error: 'A consulta não confirmou a preparação. A referência foi preservada; nenhuma ativação será repetida.' })
      } finally {
        this.preparationRead = undefined
        if (!this.stopped) this.change({ preparationChecking: false })
        const pending = this.preparationPending; this.preparationPending = false
        if (pending && this.waitingForPreparation() && this.current()) void this.consultPreparation()
      }
    })()
    return this.preparationRead
  }
  private async prepareActivation(gesture = false) {
    if (!this.before || !this.current() || this.arming || this.activationSent || !this.remoteInstalled || !this.remoteStream || this.pc?.connectionState !== 'connected' || this.state.beforeContext?.barrier !== 'ready' || this.state.beforeContext.reasonCode !== null || this.state.playbackRequired && !gesture) return
    this.arming = true
    const peer = this.pc, stream = this.remoteStream
    try {
      if (!this.dependencies.armAudio) throw Error('Player indisponível')
      await this.dependencies.armAudio(stream)
      if (!this.current() || this.pc !== peer || this.remoteStream !== stream || peer.connectionState !== 'connected') return
      this.change({ playbackRequired: false })
      this.activationSent = true
      const ticket = ++this.statusTicket
      try { const operation = await this.api.activateVoice(this.state.operationKey, this.state.beforeContext!.openingId); this.publishPreparation(operation, ticket) }
      catch (error) {
        if (error instanceof EngineError) this.readFailure(error)
        if (ticket >= this.publishedTicket && this.current()) this.change({ error: 'A ativação não foi confirmada. O player desta tentativa permanece preparado; consulte o estado sem repetir a chamada.' })
      }
    } catch {
      if (this.current()) { this.dependencies.stopAudio?.(); this.change({ playbackRequired: true, error: 'Reproduza o áudio para preparar a saudação. A ativação ainda não foi enviada.' }) }
    } finally { this.arming = false }
  }
  async resumePlayback() { await this.prepareActivation(true) }
  async start(microphone: boolean) {
    if (this.state.phase !== 'idle' || !this.current()) return
    this.change({ phase: microphone ? 'permission' : 'connecting', error: undefined })
    try {
      this.pc = this.dependencies.peer()
      if (microphone) {
        const stream = await this.dependencies.microphone()
        if (!this.current()) { stream.getTracks().forEach(track => track.stop()); return }
        this.stream = stream; for (const track of stream.getAudioTracks()) { if (this.before) track.enabled = false; this.pc.addTrack(track, stream) }
      } else this.pc.addTransceiver('audio', { direction: 'recvonly' })
      if (this.stopped) return
      this.change({ phase: 'connecting' })
      this.pc.ontrack = event => {
        if (!this.current()) return
        const stream = event.streams[0] ?? new MediaStream([event.track])
        if (this.before) { this.remoteStream = stream; void this.prepareActivation() }
        else this.dependencies.audio(stream)
      }
      this.pc.onconnectionstatechange = () => {
        if (this.stopped) return
        if (this.pc?.connectionState === 'connected') { this.clearConnectionDeadline(); this.change({ phase: 'live', startedAt: this.state.startedAt ?? Date.now() }); void this.prepareActivation() }
        else if (['failed', 'closed', 'disconnected'].includes(this.pc?.connectionState ?? '')) { this.change({ error: 'A conexão de áudio foi interrompida.' }); void this.stop() }
      }
      this.dc = this.pc.createDataChannel('oai-events')
      this.dc.onmessage = event => {
        if (this.stopped || typeof event.data !== 'string' || event.data.length > 200000) return
        let data: Record<string, unknown>; try { data = JSON.parse(event.data) } catch { return }
        if (!data || typeof data !== 'object') return
        const user = data.type === 'conversation.item.input_audio_transcription.completed'
        const assistant = ['response.output_audio_transcript.done', 'response.audio_transcript.done'].includes(String(data.type))
        if ((user || assistant) && typeof data.transcript === 'string' && data.transcript.trim()) {
          const role: 'user' | 'assistant' = user ? 'user' : 'assistant'
          const key = String(data.item_id ?? data.event_id ?? data.transcript) + ':' + role
          if (!this.state.transcripts.some(item => item.id === key)) this.change({ transcripts: [...this.state.transcripts, { id: key, role, text: data.transcript.slice(0, 100000) }].slice(-80) })
        }
        if (data.type === 'response.done' || data.type === 'session.updated') this.preparationEvent()
        if (data.type === 'error') this.change({ error: 'O serviço de voz informou uma falha. Confira o histórico e encerre o teste se necessário.' })
      }
      await this.pc.setLocalDescription(await this.pc.createOffer())
      await new Promise<void>(resolve => {
        if (this.pc!.iceGatheringState === 'complete') return resolve()
        const done = () => { (this.dependencies.clearTimeout ?? clearTimeout)(timer); this.pc?.removeEventListener('icegatheringstatechange', changed); this.finishIce = undefined; resolve() }
        const changed = () => { if (this.pc?.iceGatheringState === 'complete' || this.stopped) done() }
        const timer = (this.dependencies.timeout ?? setTimeout)(done, 5000)
        this.finishIce = done; this.pc!.addEventListener('icegatheringstatechange', changed)
      })
      if (this.stopped) return
      const sdp = this.pc.localDescription?.sdp
      if (!sdp) throw new Error('O navegador não conseguiu preparar o áudio.')
      if (!this.current()) return
      this.dependencies.beforeStart?.()
      if (!this.current()) return
      this.requested = true
      const result = await this.api.startVoice(sdp, this.state.operationKey, this.before)
      if (this.stopped) { this.remoteState(await this.api.cancelVoice(this.state.operationKey)); return }
      if (!('sdp' in result)) {
        this.remoteState(result)
        if (result.status === 'failed') throw new Error(result.callId ? 'O início da voz falhou. Consulte o encerramento da chamada antes de abrir outro teste.' : 'O serviço de voz recusou o início da chamada.')
        throw new Error('A operação já existe. Consulte o encerramento antes de abrir outro teste.')
      }
      if (!this.current()) return
      const beforeContext = this.before ? parseBeforeVoiceMetadata(result.beforeContext, undefined, this.before) : undefined
      if (beforeContext && (beforeContext.barrier !== 'ready' || beforeContext.mediaStage !== 'blocked' || beforeContext.reasonCode !== null)) throw Error('A preparação de voz não está pronta para ativação.')
      this.change({ callId: result.callId, conversationId: result.conversationId, ...(beforeContext ? { beforeContext } : {}) })
      if (this.pc.connectionState !== 'connected') this.connectionDeadline = (this.dependencies.timeout ?? setTimeout)(() => {
        this.connectionDeadline = undefined
        if (!this.stopped && this.state.phase !== 'live') { this.change({ error: 'O áudio não conectou dentro de 20 segundos. A chamada será encerrada.' }); void this.stop() }
      }, 20000)
      await this.pc.setRemoteDescription({ type: 'answer', sdp: result.sdp })
      if (this.stopped) return
      this.remoteInstalled = true; void this.prepareActivation()
      this.heartbeat = (this.dependencies.interval ?? setInterval)(() => { void this.keepAlive() }, 15000)
      this.stats = (this.dependencies.interval ?? setInterval)(() => { void this.measure() }, 1000)
    } catch (error) {
      if (!this.stopped) { this.change({ error: error instanceof Error ? error.message : 'Não foi possível iniciar a voz.' }); await this.stop(); this.change({ phase: 'error' }) }
    }
  }
  private async keepAlive() {
    if (this.stopped || this.heartbeatBusy) return
    this.heartbeatBusy = true
    try {
      const ticket = ++this.statusTicket
      const status = await this.api.heartbeatVoice(this.state.operationKey)
      if (this.before && !this.stopped) {
        if (this.activationSent) this.publishPreparation(status, ticket)
        else {
          const metadata = parseBeforeVoiceMetadata(status.beforeContext, this.state.beforeContext, this.before)
          if (metadata.barrier !== 'ready' || metadata.mediaStage !== 'blocked' || metadata.reasonCode !== null) { this.change({ beforeContext: metadata, error: 'A preparação de voz foi interrompida antes da ativação.' }); await this.stop() }
        }
      }
      if (!this.stopped && (status.cancelRequested || status.hangupStatus === 'accepted' || status.status !== 'succeeded')) { this.change({ error: 'Esta sessão de voz foi interrompida.' }); await this.stop() }
    } catch { if (!this.stopped) { this.change({ error: 'Não foi possível manter o controle da chamada.' }); await this.stop() } }
    finally { this.heartbeatBusy = false }
  }
  private async measure() {
    if (this.stopped || this.statsBusy) return
    this.statsBusy = true
    try {
      const stats = await this.pc?.getStats(); if (this.stopped) return
      let bytesReceived = 0; stats?.forEach(entry => { const bytes = Number(entry.bytesReceived); if (entry.type === 'inbound-rtp' && entry.kind === 'audio' && Number.isFinite(bytes) && bytes >= 0) bytesReceived += bytes })
      if (bytesReceived !== this.state.bytesReceived) this.change({ bytesReceived })
    } catch { /* Media state change handles connection loss. */ }
    finally { this.statsBusy = false }
  }
  mute(value: boolean) { if (this.current() && this.stream) { this.change({ muted: value }); this.inputGate() } }
  stop(): Promise<void> {
    let keepTransport = false
    try {
      this.dependencies.assertCurrent?.()
      keepTransport = this.requested && this.pc?.connectionState === 'connected'
    } catch { /* Unvalidated authority must release transport synchronously. */ }
    if (this.stopPromise) {
      if (!keepTransport) this.closeTransport()
      return this.stopPromise
    }
    this.stopped = true; this.localStop(); this.change({ phase: 'stopping' })
    if (!keepTransport) this.closeTransport()
    this.stopPromise = (async () => {
      let deadline: ReturnType<typeof setTimeout> | undefined
      try {
        if (!this.requested) this.change({ stopStatus: 'not_started' })
        else {
          try {
            const expired = new Promise<never>((_resolve, reject) => {
              deadline = (this.dependencies.timeout ?? setTimeout)(() => reject(Error('Voice cancellation deadline exceeded')), 30000)
            })
            this.remoteState(await Promise.race([this.api.cancelVoice(this.state.operationKey), expired]))
          } catch {
            if (this.state.stopStatus !== 'accepted' && this.state.stopStatus !== 'not_started') this.change({ stopStatus: 'unconfirmed' })
          }
        }
      } finally {
        if (deadline !== undefined) (this.dependencies.clearTimeout ?? clearTimeout)(deadline)
        this.closeTransport()
        this.change({ phase: 'ended' })
      }
    })()
    return this.stopPromise
  }
  async reconcile() {
    try { this.remoteState(await this.api.voiceOperation(this.state.operationKey)) }
    catch (error) { this.change({ error: error instanceof Error ? error.message : 'Não foi possível consultar o encerramento.' }) }
  }
}
