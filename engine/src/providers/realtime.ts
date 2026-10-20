import WebSocket from 'ws';
import type { BeforeVoice, BeforeVoiceHandle, BeforeVoiceControl } from '../before-context/voice.js';
import { createHash } from 'node:crypto';
import type { Entity, Store } from '../store.js';
import { recordCaptureIngress } from '../crm/capture/source-events.js';
import { agentRuntimeTools, executeAgentTool, operatorAuthorized, type AgentContext } from './agent-tools.js';

export type SocketFactory = (url: string, headers: Record<string, string>) => WebSocket;
export type VoiceContext = AgentContext & { beforeVoice?: { service: BeforeVoice; handle: BeforeVoiceHandle; initialSession: Record<string, any>; normalSession: Record<string, any>; assertActive(): void } };
type StopResult = 'accepted' | 'rejected' | 'unknown';

/** Owns the server control channel; client media goes directly through WebRTC/SIP. */
export class RealtimeSidebands {
  private readonly active = new Map<string, { socket: WebSocket; context: VoiceContext; record: Entity; apiKey: string; watchdog?: ReturnType<typeof setInterval> }>();
  private readonly pendingStops = new Set<Promise<StopResult>>();
  private readonly stoppingCalls = new Map<string, Promise<StopResult>>();
  private readonly processingTasks = new Set<Promise<void>>();
  private closing = false;
  constructor(private readonly store: Store, private readonly socketFactory: SocketFactory = (url, headers) => new WebSocket(url, { headers, handshakeTimeout: 10000 })) {}

  /** One durable stop attempt per call, shared by revocation, attach failure and shutdown. */
  stopCall(callId: string, apiKey: string, tenantId: string, reason: string): Promise<StopResult> {
    const key = `${tenantId}:${callId}`, inFlight = this.stoppingCalls.get(key);
    if (inFlight) return inFlight;
    let created = false;
    const operation = this.store.transaction(() => {
      const old = this.store.list(tenantId, 'voice-stop-operations').find(row => row.callId === callId);
      if (old) return old;
      created = true;
      return this.store.create(tenantId, 'voice-stop-operations', { callId, reason, status: 'pending' });
    });
    if (!created) return Promise.resolve(operation.status === 'accepted' || operation.status === 'rejected' ? operation.status : 'unknown');
    const pending = (async (): Promise<StopResult> => {
      let status: StopResult = 'unknown';
      let providerHttpStatus: number | null = null;
      let outcomeKind: 'http_response' | 'timeout' | 'network_error' = 'network_error';
      const timeout = AbortSignal.timeout(15000);
      try {
        const response = await fetch(`https://api.openai.com/v1/realtime/calls/${encodeURIComponent(callId)}/hangup`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: '{}', redirect: 'error', signal: timeout });
        providerHttpStatus = response.status;
        outcomeKind = 'http_response';
        status = response.ok ? 'accepted' : response.status < 500 ? 'rejected' : 'unknown';
        await response.body?.cancel();
      } catch {
        // Preserve an observed HTTP outcome even if disposing its body failed.
        if (providerHttpStatus === null) outcomeKind = timeout.aborted ? 'timeout' : 'network_error';
      }
      this.store.update(tenantId, 'voice-stop-operations', operation.id, { status, providerHttpStatus, outcomeKind, completedAt: new Date().toISOString() });
      const session = this.store.list(tenantId, 'voice-sessions').find(row => row.callId === callId);
      if (session) this.store.update(tenantId, 'voice-sessions', session.id, { securityStop: reason, hangupStatus: status, callStatus: status === 'accepted' ? 'hangup_accepted' : 'unknown', status: status === 'accepted' ? 'hangup_requested' : 'control_failed', hangupError: status === 'accepted' ? null : `security_stop_hangup_${status}` });
      const call = this.store.list(tenantId, 'calls').find(row => row.provider === 'openai' && row.providerCallId === callId);
      if (call) this.store.update(tenantId, 'calls', call.id, { securityStop: reason, hangupStatus: status, status: status === 'accepted' ? 'hangup_requested' : reason === 'voice_route_revoked' ? 'revoked_hangup_unconfirmed' : 'stop_hangup_unconfirmed' });
      this.active.get(callId)?.socket.close(1000, reason);
      return status;
    })();
    this.stoppingCalls.set(key, pending); this.pendingStops.add(pending);
    const settled = () => { this.stoppingCalls.delete(key); this.pendingStops.delete(pending); };
    void pending.then(settled, settled);
    return pending;
  }

  async connect(callId: string, apiKey: string, context: VoiceContext): Promise<void> {
    const authorized = () => { const current = this.store.get(context.tenantId, 'agents', context.agent.id); return !!current && current.status !== 'paused' && operatorAuthorized(this.store, context); };
    if (this.closing || !authorized()) throw new Error('operator_session_revoked');
    if (this.store.list(context.tenantId, 'voice-stop-operations').some(row => row.callId === callId)) throw new Error('voice_call_stopped');
    const existing = this.active.get(callId);
    if (existing) {
      if (existing.context.tenantId !== context.tenantId || existing.context.agent.id !== context.agent.id) throw new Error('call_binding_conflict');
      return;
    }
    // Recovery is metadata-only: refuse an old opening before constructing a replacement transport.
    const beforeAttachment = context.beforeVoice?.service.reserveAttach(context.beforeVoice.handle);
    const old = this.store.list(context.tenantId, 'voice-sessions').find(s => s.callId === callId);
    const record = old ?? this.store.create(context.tenantId, 'voice-sessions', { callId, agentId: context.agent.id, conversationId: context.conversationId, status: 'connecting', controlStatus: 'connecting', callStatus: 'unknown', trustedOperator: context.trustedOperator });
    const socket = this.socketFactory(`wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(callId)}`, { Authorization: `Bearer ${apiKey}` });
    this.active.set(callId, { socket, context, record, apiKey });
    let processing = Promise.resolve();
    let barrier: BeforeVoiceControl | undefined;
    let securityStopped = false;
    let stopPromise: Promise<StopResult> | undefined;
    const securityReason = context.trustedOperator ? 'operator_session_revoked' : 'voice_route_revoked';
    const securityStop = (): Promise<StopResult> => {
      if (stopPromise) return stopPromise;
      securityStopped = true;
      stopPromise = this.stopCall(callId, apiKey, context.tenantId, securityReason);
      return stopPromise;
    };
    // A quiet call must observe revocation too, without waiting for another message.
    const watchdog = setInterval(() => {
      if (!authorized()) void securityStop().catch(() => socket.close(1000, securityReason));
    }, 1000);
    watchdog.unref();
    this.active.get(callId)!.watchdog = watchdog;
    const deliveredTools = new Set<string>();
    socket.on('message', data => {
      if (this.closing) return;
      // Serialize tools and transcript persistence. Socket event callbacks must not
      // create unhandled promises or execute a tool twice after repeated events.
      processing = processing.then(async () => {
        if (securityStopped || this.closing) return;
        if (!authorized()) { await securityStop(); return; }
        let event: Record<string, any>;
        try { event = JSON.parse(data.toString()); } catch { return; }
        const agent = this.store.get(context.tenantId, 'agents', context.agent.id);
        if (!agent || agent.status === 'paused') {
          if (socket.readyState === WebSocket.OPEN) socket.close(1000, 'agent_unavailable');
          return;
        }
        // Persist only sanitized diagnostics before the barrier may block and close the call.
        if (event.type === 'error') {
          const code = event.error?.code; const type = event.error?.type;
          const safeCode = typeof code === 'string' && /^[a-z_][a-z0-9_.]{0,79}$/.test(code) ? code : undefined;
          const safeType = typeof type === 'string' && /^[a-z_][a-z0-9_.]{0,79}$/.test(type) ? type : undefined;
          const param = event.error?.param;
          const safeParam = typeof param === 'string' && /^[a-zA-Z0-9_.\[\]]{1,160}$/.test(param) ? param : undefined;
          this.store.update(context.tenantId, 'voice-sessions', record.id, { lastError: 'realtime_server_error', providerErrorCode: safeCode, providerErrorType: safeType, providerErrorParam: safeParam, lastErrorAt: new Date().toISOString() });
        }
        barrier?.event(event);
        if (barrier && !barrier.live()) { await securityStop(); return; }
        if (event.type === 'response.function_call_arguments.done') {
          if (barrier && !barrier.canUseTools()) return;
          if (typeof event.call_id !== 'string' || typeof event.name !== 'string' || typeof event.arguments !== 'string' || event.arguments.length > 50000) return;
          if (deliveredTools.has(event.call_id)) return;
          const result = await executeAgentTool(this.store, { ...context, agent }, { id: event.call_id, name: event.name, arguments: event.arguments });
          if (!authorized()) { await securityStop(); return; }
          if (this.closing || socket.readyState !== WebSocket.OPEN) return;
          deliveredTools.add(event.call_id);
          socket.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: event.call_id, output: JSON.stringify(result) } }));
          socket.send(JSON.stringify({ type: 'response.create' }));
          return;
        }
        const userTranscript = event.type === 'conversation.item.input_audio_transcription.completed';
        const assistantTranscript = ['response.output_audio_transcript.done', 'response.audio_transcript.done'].includes(event.type);
        if ((userTranscript || assistantTranscript) && typeof event.transcript === 'string' && event.transcript.length) {
          const providerMessageId = `${callId}:${event.item_id ?? event.event_id ?? createHash('sha256').update(event.transcript).digest('hex')}:${userTranscript ? 'user' : 'assistant'}`;
          this.store.transaction(() => {
            if (this.store.list(context.tenantId, 'messages').some(m => m.providerMessageId === providerMessageId)) return;
            if (!authorized()) throw new Error('voice_authority_revoked');
            const message = this.store.create(context.tenantId, 'messages', { conversationId: context.conversationId, role: userTranscript ? 'user' : 'assistant', content: event.transcript.slice(0, 100000), source: 'openai', deliveryStatus: 'received', providerMessageId });
            const conversation = this.store.get(context.tenantId, 'conversations', context.conversationId);
            if (userTranscript && (!barrier || barrier.canUseTools()) && conversation?.channelId && !context.trustedOperator && context.liveAuthorization) {
              recordCaptureIngress(this.store, { tenantId: context.tenantId, conversationId: context.conversationId, messageId: message.id, channelId: String(conversation.channelId), agentId: agent.id, kind: 'voice_final_user_transcript', receiptId: createHash('sha256').update(providerMessageId).digest('hex'), occurredAt: Date.now(), sessionStartedAt: Date.parse(String(conversation.voiceStartedAt ?? conversation.createdAt)) }, () => { if (!authorized()) throw new Error('voice_authority_revoked'); });
            }
          });
        }
        if (event.type === 'response.done' && event.response?.usage && event.response?.id) {
          if (!this.store.list(context.tenantId, 'provider-usage').some(u => u.responseId === event.response.id)) this.store.create(context.tenantId, 'provider-usage', { provider: 'openai', operation: 'realtime', responseId: event.response.id, callId, usage: event.response.usage });
        }
      }).catch(() => { try { this.store.update(context.tenantId, 'voice-sessions', record.id, { lastError: 'sideband_processing_failed' }); } catch { /* application shutdown */ } });
      const task = processing; this.processingTasks.add(task);
      void task.then(() => this.processingTasks.delete(task), () => this.processingTasks.delete(task));
    });
    socket.on('close', () => {
      barrier?.close();
      clearInterval(watchdog);
      // Losing control must not leave provider-hosted media running without guards.
      const current = this.closing ? undefined : this.store.get(context.tenantId, 'voice-sessions', record.id);
      if (!this.closing && current?.callStatus !== 'hangup_accepted' && current?.callStatus !== 'ended' && !this.store.list(context.tenantId, 'voice-stop-operations').some(row => row.callId === callId)) {
        void this.stopCall(callId, apiKey, context.tenantId, 'realtime_control_disconnected').catch(() => {});
      }
      if (this.active.get(callId)?.socket === socket) this.active.delete(callId);
      const closeTask = processing.finally(() => {
        try {
          const current = this.store.get(context.tenantId, 'voice-sessions', record.id);
          this.store.update(context.tenantId, 'voice-sessions', record.id, { status: current?.callStatus === 'hangup_accepted' ? 'hangup_requested' : 'control_disconnected', controlStatus: 'closed', controlClosedAt: new Date().toISOString() });
        } catch { /* application shutdown */ }
      });
      this.processingTasks.add(closeTask);
      void closeTask.then(() => this.processingTasks.delete(closeTask), () => this.processingTasks.delete(closeTask));
    });
    socket.on('error', () => { barrier?.close(); try { this.store.update(context.tenantId, 'voice-sessions', record.id, { status: 'failed', lastError: 'sideband_connection_failed' }); } catch { /* application shutdown */ } });
    if (context.beforeVoice) {
      const b = context.beforeVoice;
      barrier = b.service.attach(b.handle, { attachmentId: beforeAttachment!, initialSession: b.initialSession,
        normalSession: () => ({ ...b.normalSession, tools: agentRuntimeTools(this.store, context).map(({ type, name, description, parameters }) => ({ type, name, description, parameters })), tool_choice: 'auto' }),
        assertActive: () => { if (this.closing || securityStopped || socket.readyState !== WebSocket.OPEN || !authorized()) throw new Error('voice_authority_revoked'); b.assertActive(); },
        send: value => socket.send(JSON.stringify(value)), stop: reason => { void this.stopCall(callId, apiKey, context.tenantId, reason).catch(() => {}); },
      });
      // Install the rejection handler before open/close can settle the barrier.
      void barrier.ready.catch(() => {});
    }
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { socket.terminate(); reject(new Error('sideband_timeout')); }, 10000);
      socket.once('open', () => {
        clearTimeout(timeout);
        if (this.closing || !authorized()) { void securityStop(); reject(new Error('operator_session_revoked')); return; }
        this.store.update(context.tenantId, 'voice-sessions', record.id, { status: 'connected', controlStatus: 'connected' });
        if (barrier) { barrier.open(); void barrier.ready.then(resolve, reject); return; }
        // Realtime function tools omit Responses-only `strict`.
        const tools = agentRuntimeTools(this.store, context).map(({ type, name, description, parameters }) => ({ type, name, description, parameters }));
        socket.send(JSON.stringify({ type: 'session.update', session: { type: 'realtime', tools, tool_choice: 'auto' } }));
        if (typeof context.agent.initialMessage === 'string' && context.agent.initialMessage.trim()) socket.send(JSON.stringify({ type: 'response.create', response: { instructions: `Cumprimente o usuário com esta mensagem inicial: ${context.agent.initialMessage}` } }));
        resolve();
      });
      socket.once('error', () => { clearTimeout(timeout); reject(new Error('sideband_connection_failed')); });
      socket.once('close', () => { clearTimeout(timeout); reject(new Error('sideband_closed')); });
    });
  }

  disconnect(callId: string): void { this.active.get(callId)?.socket.close(1000, 'operator_ended_call'); }

  async close(): Promise<void> {
    this.closing = true;
    const calls = [...this.active.entries()];
    for (const [, { watchdog }] of calls) clearInterval(watchdog);
    await Promise.allSettled(this.processingTasks);
    // Media runs at OpenAI; closing the control socket alone does not end it.
    await Promise.allSettled(calls.map(([id, call]) => this.stopCall(id, call.apiKey, call.context.tenantId, 'server_shutdown')));
    await Promise.allSettled(this.pendingStops);
    for (const [, { socket }] of calls) socket.terminate();
    this.active.clear();
  }
}
