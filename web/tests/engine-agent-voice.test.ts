import test from 'node:test'
import assert from 'node:assert/strict'
import { AgentVoiceSession, type VoiceDependencies, type VoiceView } from '../src/services/engine/agent-voice'
import type { AgentTestService, VoiceOperation, VoiceStart } from '../src/services/engine/agent-test'

const key = 'voice-operation-test-key'
const operation = (patch: Partial<VoiceOperation> = {}): VoiceOperation => ({ status: 'succeeded', operationKey: key, callId: 'rtc_call', conversationId: 'conversation', ...patch })
const started = (): VoiceStart => ({ ...operation(), sdp: 'v=0\r\nanswer', callId: 'rtc_call', conversationId: 'conversation', toolsEnabled: [] })
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve() }

class Timers {
  next = 0
  jobs = new Map<number, { callback: () => void; ms: number; repeat: boolean }>()
  interval = ((callback: () => void, ms: number) => this.add(callback, ms, true)) as unknown as typeof setInterval
  timeout = ((callback: () => void, ms: number) => this.add(callback, ms, false)) as unknown as typeof setTimeout
  clear = ((id: number) => { this.jobs.delete(id) }) as unknown as typeof clearTimeout
  private add(callback: () => void, ms: number, repeat: boolean) { const id = this.next++; this.jobs.set(id, { callback, ms, repeat }); return id }
  has(ms: number) { return [...this.jobs.values()].some(job => job.ms === ms) }
  fire(ms: number) { for (const [id, job] of [...this.jobs]) if (job.ms === ms) { if (!job.repeat) this.jobs.delete(id); job.callback() } }
}
class Track {
  enabled = true
  stopped = 0
  stop() { this.stopped++ }
}
class Channel {
  onmessage?: (event: { data: unknown }) => void
  closed = 0
  close() { this.closed++ }
  emit(value: unknown) { this.onmessage?.({ data: typeof value === 'string' ? value : JSON.stringify(value) }) }
}
class Peer {
  connectionState = 'new'
  iceGatheringState = 'complete'
  localDescription?: { sdp: string; type: string }
  ontrack?: (event: unknown) => void
  onconnectionstatechange?: () => void
  listeners = new Set<() => void>()
  channel = new Channel()
  transceivers: unknown[] = []
  tracks: unknown[] = []
  remote: unknown[] = []
  closed = 0
  statCalls = 0
  statsResult: Promise<Map<string, unknown>> = Promise.resolve(new Map())
  remoteResult: Promise<void> = Promise.resolve()
  addTransceiver(kind: string, options: unknown) { this.transceivers.push({ kind, options }) }
  addTrack(track: unknown) { this.tracks.push(track) }
  createDataChannel() { return this.channel }
  async createOffer() { return { type: 'offer', sdp: 'v=0\r\noffer' } }
  async setLocalDescription(description: { sdp: string; type: string }) { this.localDescription = description }
  async setRemoteDescription(description: unknown) { this.remote.push(description); await this.remoteResult }
  addEventListener(_event: string, listener: () => void) { this.listeners.add(listener) }
  removeEventListener(_event: string, listener: () => void) { this.listeners.delete(listener) }
  getStats() { this.statCalls++; return this.statsResult }
  connect(state = 'connected') { this.connectionState = state; this.onconnectionstatechange?.() }
  close() { this.closed++; this.connect('closed') }
}
function fixture(overrides: Partial<AgentTestService> = {}) {
  const timers = new Timers(), peer = new Peer(), track = new Track(), changes: VoiceView[] = [], audio: unknown[] = []
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream
  let micCalls = 0, startCalls = 0, cancelCalls = 0, heartbeatCalls = 0
  const api = {
    async startVoice(sdp: string, requestKey: string) { startCalls++; assert.equal(sdp, 'v=0\r\noffer'); assert.equal(requestKey, key); return started() },
    async cancelVoice(requestKey: string) { cancelCalls++; assert.equal(requestKey, key); return operation({ cancelRequested: true, hangupStatus: 'accepted' }) },
    async heartbeatVoice() { heartbeatCalls++; return operation() },
    async voiceOperation() { return operation({ hangupStatus: 'accepted' }) },
    ...overrides,
  } as AgentTestService
  const dependencies: VoiceDependencies = { peer: () => peer as unknown as RTCPeerConnection, microphone: async () => { micCalls++; return stream }, audio: value => audio.push(value), change: state => changes.push(state), interval: timers.interval, clearInterval: timers.clear, timeout: timers.timeout, clearTimeout: timers.clear }
  const session = new AgentVoiceSession(api, dependencies, key)
  return { session, peer, track, stream, timers, changes, audio, api, dependencies, calls: () => ({ micCalls, startCalls, cancelCalls, heartbeatCalls }) }
}

test('voice receive-only establishes actual media without requesting the microphone and clears its connection deadline', async () => {
  const f = fixture()
  await f.session.start(false)
  assert.equal(f.calls().micCalls, 0); assert.equal(f.calls().startCalls, 1)
  assert.deepEqual(f.peer.transceivers, [{ kind: 'audio', options: { direction: 'recvonly' } }])
  assert.equal(f.session.snapshot().phase, 'connecting'); assert.equal(f.timers.has(20000), true)
  f.peer.connect(); const began = f.session.snapshot().startedAt
  assert.equal(f.session.snapshot().phase, 'live'); assert.equal(typeof began, 'number'); assert.equal(f.timers.has(20000), false)
  f.peer.connect(); assert.equal(f.session.snapshot().startedAt, began)
  f.peer.ontrack?.({ streams: [f.stream] }); assert.deepEqual(f.audio, [f.stream])
  await f.session.start(false); assert.equal(f.calls().startCalls, 1)
  await f.session.stop(); f.peer.ontrack?.({ streams: [f.stream] })
  assert.equal(f.audio.length, 1); assert.equal(f.timers.jobs.size, 0)
})

test('voice cancellation while microphone permission is pending stops late tracks and never creates a remote call', async () => {
  const f = fixture(), permission = deferred<MediaStream>()
  f.dependencies.microphone = () => permission.promise
  const starting = f.session.start(true)
  assert.equal(f.session.snapshot().phase, 'permission')
  await f.session.stop(); permission.resolve(f.stream); await starting
  assert.equal(f.track.stopped, 1); assert.equal(f.peer.closed, 1); assert.equal(f.peer.tracks.length, 0)
  assert.equal(f.calls().startCalls, 0); assert.equal(f.calls().cancelCalls, 0)
  assert.equal(f.session.snapshot().stopStatus, 'not_started'); assert.equal(f.timers.jobs.size, 0)
})

test('voice cancellation during ICE gathering resolves the pending wait and removes every local timer/listener', async () => {
  const f = fixture(); f.peer.iceGatheringState = 'gathering'
  const starting = f.session.start(false); await settle()
  assert.equal(f.timers.has(5000), true); assert.equal(f.peer.listeners.size, 1)
  await f.session.stop(); await starting
  assert.equal(f.calls().startCalls, 0); assert.equal(f.timers.jobs.size, 0); assert.equal(f.peer.listeners.size, 0)
})

test('voice cancellation during the start request prevents late SDP installation and retains an accepted stop', async () => {
  const response = deferred<VoiceStart>(), f = fixture(); let cancellations = 0, starts = 0
  f.api.startVoice = async () => { starts++; return response.promise }
  f.api.cancelVoice = async () => operation({ hangupStatus: ++cancellations === 1 ? 'accepted' : 'unknown', cancelRequested: true })
  const starting = f.session.start(false); await settle()
  assert.equal(starts, 1); await f.session.stop()
  response.resolve(started()); await starting
  assert.equal(cancellations, 2); assert.equal(f.peer.remote.length, 0)
  assert.equal(f.session.snapshot().stopStatus, 'accepted'); assert.equal(f.session.snapshot().phase, 'ended'); assert.equal(f.timers.jobs.size, 0)
})

test('duplicate voice stop shares one cancellation, immediately stops capture and closes transport after its receipt', async () => {
  const cancel = deferred<VoiceOperation>(), f = fixture(); let cancellations = 0
  f.api.cancelVoice = async () => { cancellations++; return cancel.promise }
  await f.session.start(true); f.peer.connect(); f.session.mute(true); assert.equal(f.track.enabled, false)
  f.session.mute(false); assert.equal(f.track.enabled, true)
  const first = f.session.stop(), second = f.session.stop()
  assert.equal(first, second); assert.equal(cancellations, 1)
  assert.equal(f.track.stopped, 1); assert.equal(f.track.enabled, false); assert.equal(f.peer.closed, 0); assert.equal(f.peer.channel.closed, 0)
  assert.equal(f.timers.jobs.size, 1); assert.equal(f.timers.has(30000), true)
  assert.equal(f.session.snapshot().phase, 'stopping')
  cancel.resolve(operation({ hangupStatus: 'accepted' })); await first
  await f.session.stop(); assert.equal(cancellations, 1); assert.equal(f.session.snapshot().phase, 'ended')
  assert.equal(f.peer.closed, 1); assert.equal(f.peer.channel.closed, 1); assert.equal(f.timers.jobs.size, 0)
})

test('unconnected voice expires after 20 seconds, including a stalled remote-description promise', async () => {
  for (const stalled of [false, true]) {
    const remote = deferred<void>(), f = fixture()
    if (stalled) f.peer.remoteResult = remote.promise
    const starting = f.session.start(false); await settle()
    assert.equal(f.timers.has(20000), true)
    f.timers.fire(20000); await settle()
    assert.equal(f.calls().cancelCalls, 1); assert.equal(f.peer.closed, 1); assert.equal(f.timers.jobs.size, 0)
    assert.equal(f.session.snapshot().phase, 'ended'); assert.match(f.session.snapshot().error!, /20 segundos/)
    remote.resolve(); await starting; assert.equal(f.timers.jobs.size, 0)
  }
})

test('lost start response is never retried; uncertain cancellation is reconciled without downgrading confirmed closure', async () => {
  const f = fixture(); let starts = 0, cancels = 0
  f.api.startVoice = async () => { starts++; throw new Error('Connection lost') }
  f.api.cancelVoice = async () => { cancels++; throw new Error('Response lost') }
  await f.session.start(false)
  assert.equal(starts, 1); assert.equal(cancels, 1); assert.equal(f.session.snapshot().phase, 'error'); assert.equal(f.session.snapshot().stopStatus, 'unconfirmed')
  await f.session.reconcile(); assert.equal(f.session.snapshot().stopStatus, 'accepted')
  f.api.voiceOperation = async () => operation({ hangupStatus: 'unknown' })
  await f.session.reconcile(); assert.equal(f.session.snapshot().stopStatus, 'accepted')
  await f.session.start(false); assert.equal(starts, 1)
})

test('heartbeat failures release local audio and cancel once; concurrent heartbeat ticks do not overlap', async () => {
  const heartbeat = deferred<VoiceOperation>(), f = fixture(); let beats = 0
  f.api.heartbeatVoice = async () => { beats++; return heartbeat.promise }
  await f.session.start(true); f.peer.connect()
  f.timers.fire(15000); f.timers.fire(15000); assert.equal(beats, 1)
  heartbeat.reject(new Error('session revoked')); await settle()
  assert.equal(f.calls().cancelCalls, 1); assert.equal(f.track.stopped, 1); assert.equal(f.timers.jobs.size, 0)
  assert.match(f.session.snapshot().error!, /controle da chamada/); assert.equal(f.session.snapshot().stopStatus, 'accepted')
})

test('server cancellation in heartbeat and browser disconnection both terminate media without another start', async () => {
  for (const mode of ['server', 'browser']) {
    const f = fixture({ heartbeatVoice: async () => operation({ cancelRequested: true }) })
    await f.session.start(false); f.peer.connect()
    if (mode === 'server') f.timers.fire(15000)
    else f.peer.connect('disconnected')
    await settle()
    assert.equal(f.calls().cancelCalls, 1); assert.equal(f.calls().startCalls, 1); assert.equal(f.timers.jobs.size, 0)
    assert.equal(f.session.snapshot().phase, 'ended')
  }
})

test('voice byte counter uses inbound audio stats only, avoids overlapping stats, and ignores late results after stop', async () => {
  const f = fixture(); await f.session.start(false); f.peer.connect()
  f.peer.statsResult = Promise.resolve(new Map([
    ['a', { type: 'inbound-rtp', kind: 'audio', bytesReceived: 120 }], ['b', { type: 'inbound-rtp', kind: 'audio', bytesReceived: 80 }],
    ['c', { type: 'outbound-rtp', kind: 'audio', bytesReceived: 400 }], ['d', { type: 'inbound-rtp', kind: 'video', bytesReceived: 500 }],
    ['e', { type: 'inbound-rtp', kind: 'audio', bytesReceived: Infinity }], ['f', { type: 'inbound-rtp', kind: 'audio', bytesReceived: -10 }],
  ]))
  f.timers.fire(1000); await settle(); assert.equal(f.session.snapshot().bytesReceived, 200)
  const pending = deferred<Map<string, unknown>>(); f.peer.statsResult = pending.promise
  f.timers.fire(1000); f.timers.fire(1000); assert.equal(f.peer.statCalls, 2)
  await f.session.stop(); pending.resolve(new Map([['late', { type: 'inbound-rtp', kind: 'audio', bytesReceived: 900 }]])); await settle()
  assert.equal(f.session.snapshot().bytesReceived, 200)
})

test('voice transcripts contain completed user/assistant events once, stay bounded and stop updating after closure', async () => {
  const f = fixture(); await f.session.start(false)
  const event = { type: 'response.output_audio_transcript.done', item_id: 'answer', transcript: 'Olá!' }
  f.peer.channel.emit(event); f.peer.channel.emit({ ...event, type: 'response.audio_transcript.done' })
  f.peer.channel.emit({ type: 'response.output_audio_transcript.delta', item_id: 'partial', transcript: 'Ignore' })
  f.peer.channel.emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'user', transcript: 'Bom dia' })
  f.peer.channel.emit('bad json'); f.peer.channel.emit(null); f.peer.channel.emit({ type: 'error', message: 'Untrusted upstream detail' })
  assert.deepEqual(f.session.snapshot().transcripts.map(({ role, text }) => ({ role, text })), [{ role: 'assistant', text: 'Olá!' }, { role: 'user', text: 'Bom dia' }])
  assert.equal(f.session.snapshot().error!.includes('Untrusted'), false)
  for (let i = 0; i < 90; i++) f.peer.channel.emit({ ...event, item_id: `item-${i}` })
  assert.equal(f.session.snapshot().transcripts.length, 80)
  await f.session.stop(); const before = f.session.snapshot().transcripts
  f.peer.channel.emit({ ...event, item_id: 'late' }); assert.equal(f.session.snapshot().transcripts, before)
})

test('microphone denial and existing-operation replay fail honestly without retrying or installing replay SDP', async () => {
  const denied = fixture(); denied.dependencies.microphone = async () => { throw new Error('Permission denied') }
  await denied.session.start(true)
  assert.equal(denied.calls().startCalls, 0); assert.equal(denied.session.snapshot().phase, 'error'); assert.equal(denied.session.snapshot().stopStatus, 'not_started')
  const replay = fixture({ startVoice: async () => operation({ requiresRecovery: true }) })
  await replay.session.start(false)
  assert.equal(replay.peer.remote.length, 0); assert.equal(replay.calls().cancelCalls, 1); assert.equal(replay.session.snapshot().phase, 'error')
  assert.match(replay.session.snapshot().error!, /operação já existe/); assert.equal(replay.timers.jobs.size, 0)
})

test('a lost cancellation response cannot undo closure already confirmed by a concurrent status read', async () => {
  const cancel = deferred<VoiceOperation>(), f = fixture({ cancelVoice: async () => cancel.promise })
  await f.session.start(false)
  const stopping = f.session.stop()
  await f.session.reconcile(); assert.equal(f.session.snapshot().stopStatus, 'accepted')
  cancel.reject(new Error('Response lost')); await stopping
  assert.equal(f.session.snapshot().stopStatus, 'accepted'); assert.equal(f.session.snapshot().phase, 'ended')
})

test('definitively rejected voice without a call is not_started, while unknown or known-call failures remain unconfirmed', async () => {
  for (const [status, callId, expected] of [
    ['failed', undefined, 'not_started'], ['unknown', undefined, 'unconfirmed'], ['failed', 'rtc_known', 'unconfirmed'],
  ] as const) {
    const receipt = operation({ status, callId, conversationId: undefined, hangupStatus: 'not_requested', requiresRecovery: true })
    const f = fixture({ startVoice: async () => receipt, cancelVoice: async () => receipt })
    await f.session.start(false)
    assert.equal(f.session.snapshot().phase, 'error'); assert.equal(f.session.snapshot().stopStatus, expected)
    assert.equal(f.peer.remote.length, 0); assert.equal(f.timers.jobs.size, 0)
    if (status === 'failed' && !callId) assert.match(f.session.snapshot().error!, /recusou o início/)
  }
})

test('reconciliation distinguishes a rejected no-call start and preserves accepted closure as the highest priority', async () => {
  const failed = operation({ status: 'failed', callId: undefined, conversationId: undefined, hangupStatus: 'not_requested' })
  const f = fixture({ startVoice: async () => { throw Error('Request failed') }, cancelVoice: async () => { throw Error('Unknown cancellation') }, voiceOperation: async () => failed })
  await f.session.start(false); assert.equal(f.session.snapshot().stopStatus, 'unconfirmed')
  await f.session.reconcile(); assert.equal(f.session.snapshot().stopStatus, 'not_started')
  f.api.voiceOperation = async () => operation({ hangupStatus: 'accepted' })
  await f.session.reconcile(); assert.equal(f.session.snapshot().stopStatus, 'accepted')
  f.api.voiceOperation = async () => failed
  await f.session.reconcile(); assert.equal(f.session.snapshot().stopStatus, 'accepted')
})

test('a failed-start receipt survives a lost cancellation response and never hides a previously known call', async () => {
  const failed = operation({ status: 'failed', callId: undefined, conversationId: undefined, hangupStatus: 'not_requested', requiresRecovery: true })
  const f = fixture({ startVoice: async () => failed, cancelVoice: async () => { throw Error('Lost response') } })
  await f.session.start(false); assert.equal(f.session.snapshot().stopStatus, 'not_started')
  const known = fixture({ cancelVoice: async () => failed })
  await known.session.start(false); await known.session.stop()
  assert.equal(known.session.snapshot().callId, 'rtc_call'); assert.equal(known.session.snapshot().stopStatus, 'unconfirmed')
})

test('hangup reaches the active peer after immediate media quiescence and before transport close', async () => {
  const f = fixture(); let paused = 0
  f.dependencies.stopAudio = () => { paused++ }
  f.api.cancelVoice = async () => {
    assert.equal(f.track.enabled, false); assert.equal(f.track.stopped, 1); assert.equal(paused, 1)
    // Controlled provider models only the observed active-call ordering hypothesis.
    return operation({ cancelRequested: true, hangupStatus: f.peer.closed ? 'rejected' : 'accepted' })
  }
  await f.session.start(true); f.peer.connect()
  await f.session.stop()
  assert.equal(f.session.snapshot().stopStatus, 'accepted')
  assert.equal(f.peer.closed, 1); assert.equal(f.peer.channel.closed, 1); assert.equal(f.timers.jobs.size, 0)
})

test('an unresponsive cancellation closes transport at a bounded deadline and ignores late settlement', async () => {
  const f = fixture(), cancel = deferred<VoiceOperation>(); let calls = 0, paused = 0
  f.dependencies.stopAudio = () => { paused++ }
  f.api.cancelVoice = async () => { calls++; return cancel.promise }
  await f.session.start(true); f.peer.connect()
  const stopping = f.session.stop()
  assert.equal(f.track.stopped, 1); assert.equal(f.track.enabled, false); assert.equal(paused, 1)
  assert.equal(f.peer.closed, 0); assert.equal(f.peer.channel.closed, 0)
  const prior = f.session.snapshot().transcripts
  f.peer.channel.emit({ type: 'response.output_audio_transcript.done', item_id: 'late-stop', transcript: 'must not publish' })
  f.peer.ontrack?.({ streams: [f.stream] }); f.session.mute(false)
  assert.equal(f.session.snapshot().transcripts, prior); assert.equal(f.audio.length, 0); assert.equal(f.track.enabled, false)
  f.timers.fire(30000); await stopping
  assert.equal(f.peer.closed, 1); assert.equal(f.peer.channel.closed, 1); assert.equal(f.timers.jobs.size, 0)
  assert.equal(f.session.snapshot().phase, 'ended'); assert.equal(f.session.snapshot().stopStatus, 'unconfirmed')
  cancel.resolve(operation({ hangupStatus: 'accepted' })); await settle()
  assert.equal(f.session.snapshot().stopStatus, 'unconfirmed'); assert.equal(calls, 1)
  await f.session.reconcile(); assert.equal(f.session.snapshot().stopStatus, 'accepted')
})

test('authority loss during graceful stop forces immediate transport close without another cancellation', async () => {
  const f = fixture(), cancel = deferred<VoiceOperation>(); let authorized = true, calls = 0
  f.dependencies.assertCurrent = () => { if (!authorized) throw Error('Session validation changed') }
  f.api.cancelVoice = async () => { calls++; return cancel.promise }
  await f.session.start(true); f.peer.connect()
  const first = f.session.stop(); assert.equal(f.peer.closed, 0); assert.equal(f.track.stopped, 1)
  authorized = false
  const second = f.session.stop()
  assert.equal(first, second); assert.equal(calls, 1)
  assert.equal(f.peer.closed, 1); assert.equal(f.peer.channel.closed, 1); assert.equal(f.track.enabled, false)
  cancel.resolve(operation({ hangupStatus: 'accepted' })); await first
  assert.equal(f.peer.closed, 1); assert.equal(f.peer.channel.closed, 1); assert.equal(f.timers.jobs.size, 0)
  assert.equal(f.session.snapshot().stopStatus, 'accepted')
})
