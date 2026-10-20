import { PUBLIC_CHAT_CALENDLY_WIDGET } from './public-chat-calendly-widget.js';
import { PUBLIC_CHAT_BOOKING_WIDGET } from './public-chat-booking-widget.js';
/** Avatares padrão (mesmo desenho do DefaultAvatar do painel), como data URI para o widget. */
const avatarSvg = (f: boolean) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="${f ? '#EEF0FF' : '#E8F4FF'}"/>${f ? '<path d="M16 34c0-13 7-22 16-22s16 9 16 22v14H16z" fill="#2B2340"/>' : ''}<path d="M14 64c1-11 8-17 18-17s17 6 18 17z" fill="${f ? '#1F2A44' : '#1E3A5F'}"/><path d="M27 44h10v6c0 3-2 5-5 5s-5-2-5-5z" fill="#E9B48F"/><path d="M26 47l6 7 6-7" fill="none" stroke="#22B5C8" stroke-width="3"/><ellipse cx="32" cy="31" rx="11" ry="13" fill="#F2C29E"/>${f ? '<path d="M21 30c1-9 6-13 11-13s10 4 11 13c-4-5-8-6-11-6s-7 1-11 6z" fill="#2B2340"/>' : '<path d="M21 28c0-8 5-12 11-12s11 4 11 12c-3-3-7-5-11-5s-8 2-11 5z" fill="#2A1F1A"/>'}<circle cx="28" cy="32" r="1.4" fill="#2B2340"/><circle cx="36" cy="32" r="1.4" fill="#2B2340"/><path d="M29 37c2 1.5 4 1.5 6 0" fill="none" stroke="#B5674A" stroke-width="1.4" stroke-linecap="round"/></svg>`;
export const DEFAULT_AVATARS = { feminino: 'data:image/svg+xml,' + encodeURIComponent(avatarSvg(true)), masculino: 'data:image/svg+xml,' + encodeURIComponent(avatarSvg(false)) };
/** Classic script: no framework, cookies, API keys or access to the admin surface. */
export const PUBLIC_CHAT_WIDGET = String.raw`(() => {
  'use strict';
  const script = document.currentScript;
  if (!script) return;
  const tenantId = script.dataset.kloelTenant;
  const channelId = script.dataset.kloelChannel;
  if (!tenantId || !channelId) return;
  const base = new URL(script.src).origin;
  const query = new URLSearchParams({ tenantId, channelId }).toString();
  const pageMode = script.dataset.kloelMode === 'page'; // link hospedado: o chat ocupa a página inteira
  const storageKey = 'kloel-chat:' + base + ':' + tenantId + ':' + channelId;
  let token = null;
  let busy = false;
  let initialized = false;
  let openingKey = null, openingRevision = null, openingHttpRevision = null, openingReady = false;
  let expiresAt = 0, attemptKey = null, cursor = null, mode = 'ai', polling = null, timer = null, terminal = false, confirmedNotice = '';
  let attemptState = null, attemptBody = null, responseReferences = [];
  const seen = new Set();
  try { const stored = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); if (stored && stored.expiresAt > Date.now() && /^[A-Za-z0-9_-]{43}$/.test(stored.token)) { token = stored.token; expiresAt = stored.expiresAt; if (stored.openingKey !== undefined) { if (!/^[a-f0-9-]{36}$/.test(stored.openingKey) || !Number.isSafeInteger(stored.openingRevision) || stored.openingRevision < 1) throw new Error('Referência de abertura inválida.'); openingKey = stored.openingKey; openingRevision = stored.openingRevision; if(stored.openingHttpRevision!==undefined){if(!Number.isSafeInteger(stored.openingHttpRevision)||stored.openingHttpRevision<1)throw new Error('Revisão HTTP inválida.');openingHttpRevision=stored.openingHttpRevision;} } if (/^[a-f0-9-]{36}$/.test(stored.attemptKey || '')) attemptKey = stored.attemptKey; if (Array.isArray(stored.responseReferences)) responseReferences = stored.responseReferences.filter(key => typeof key === 'string' && /^[a-f0-9-]{36}$/.test(key)).slice(0, 200); } } catch {}
  function persist() { try { if (token) sessionStorage.setItem(storageKey, JSON.stringify({ token, expiresAt, ...(openingKey ? { openingKey, openingRevision, ...(openingHttpRevision!==null?{openingHttpRevision}:{}) } : {}), ...(attemptKey ? { attemptKey } : {}), ...(responseReferences.length ? { responseReferences } : {}) })); else sessionStorage.removeItem(storageKey); } catch {} }
  const host = document.createElement('div');
  host.setAttribute('data-kloel-widget', channelId);
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = ':host{all:initial;font-family:system-ui,sans-serif;color:hsl(240 10% 3.9%);font-size:14px}*{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer;border:0;border-radius:12px;padding:12px;background:var(--accent,hsl(238.09 88.7% 65.29%));color:white}button:focus-visible,input:focus-visible{outline:3px solid var(--accent,hsl(238.09 88.7% 65.29%));outline-offset:3px}button:disabled{opacity:.6;cursor:wait}.launcher{position:fixed;bottom:24px;right:24px;z-index:2147483000;box-shadow:0 3px 18px #0003}.panel{position:fixed;bottom:86px;right:24px;width:min(370px,calc(100vw - 32px));height:min(520px,calc(100dvh - 120px));z-index:2147483000;background:#fff;border:1px solid hsl(240 5.9% 90%);border-radius:18px;box-shadow:0 8px 30px #0003;display:flex;flex-direction:column;overflow:hidden}.panel[hidden]{display:none}header{padding:14px;background:hsl(240 4.8% 95.9%);display:flex;align-items:center;gap:10px}h2{font-size:16px;margin:0;flex:1}header button{padding:8px;font-size:12px}.messages{flex:1;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:10px}.message{white-space:pre-wrap;overflow-wrap:anywhere;border-radius:12px;padding:10px 12px;background:hsl(240 4.8% 95.9%);max-width:95%;line-height:1.5}.message.user{align-self:flex-end;background:var(--accent,hsl(238.09 88.7% 65.29%));color:#fff}.message small{display:block;font-weight:600;margin-bottom:4px}.status{min-height:22px;font-size:12px;padding:4px 12px;color:hsl(240 3.8% 46.1%)}form{display:flex;gap:8px;padding:12px;border-top:1px solid hsl(240 5.9% 90%)}input{width:100%;min-width:0;border:1px solid hsl(240 5.9% 90%);border-radius:10px;padding:10px;color:hsl(240 10% 3.9%);background:white}footer{font-size:11px;text-align:center;padding:0 8px 8px;color:hsl(240 3.8% 46.1%)}';
  style.textContent += '.bookings{overflow:auto;max-height:55%;padding:0 12px}.booking-card,.bookings section{border:1px solid #ddd;border-radius:10px;padding:10px;margin:8px 0}.bookings h3{margin:0;font-size:14px}.bookings p{font-size:12px;overflow-wrap:anywhere}.bookings button{margin:3px;padding:8px}.bookings select{max-width:100%;padding:8px}.bookings label{display:block;font-size:12px}';
  // "Personalizar" (aparência do assistente): cor de destaque, tema, cabeçalho colorido, foto e botão de anexos.
  style.textContent += '.avatar{width:32px;height:32px;border-radius:50%;flex:none;background:#eef0ff center/cover no-repeat}.avatar.ring{box-shadow:0 0 0 1px hsl(240 5.9% 90%),0 0 0 3px #fff}.panel.dark{background:#16161d;color:#fff;border-color:#ffffff1a}.dark header{background:#1f1f29}.dark .message{background:#ffffff0d}.dark .message.user{background:var(--accent,hsl(238.09 88.7% 65.29%))}.dark input{background:transparent;color:#fff;border-color:#ffffff26}.dark form{border-color:#ffffff1a}.dark .status,.dark footer{color:#a1a1aa}.panel.accent-header header{background:var(--accent,hsl(238.09 88.7% 65.29%));color:#fff}.accent-header header button{background:#ffffff26}.clip{padding:10px 12px;background:transparent;border:1px solid hsl(240 5.9% 90%);color:inherit}.clip[hidden]{display:none}';
  root.append(style);
  const button = (label, handler) => { const item = document.createElement('button'); item.type = 'button'; item.textContent = label; item.addEventListener('click', handler); return item; };
  const panel = document.createElement('section'); panel.className = 'panel'; panel.hidden = true; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Atendimento Kloel AI');
  const header = document.createElement('header');
  const title = document.createElement('h2'); title.textContent = 'Atendimento Kloel AI';
  const avatar = document.createElement('span'); avatar.className = 'avatar'; avatar.setAttribute('aria-hidden', 'true'); avatar.style.backgroundImage = 'url("' + ${JSON.stringify(DEFAULT_AVATARS.feminino)} + '")';
  const messages = document.createElement('div'); messages.className = 'messages'; messages.setAttribute('role', 'log'); messages.setAttribute('aria-live', 'polite'); messages.setAttribute('aria-label', 'Mensagens da conversa');
  const status = document.createElement('div'); status.className = 'status'; status.setAttribute('role', 'status');
  const form = document.createElement('form');
  const input = document.createElement('input'); input.type = 'text'; input.maxLength = 4000; input.required = true; input.placeholder = 'Escreva sua mensagem'; input.setAttribute('aria-label', 'Sua mensagem'); input.autocomplete = 'off';
  const send = document.createElement('button'); send.type = 'submit'; send.textContent = 'Enviar';
  const fileInput = document.createElement('input'); fileInput.type = 'file'; fileInput.hidden = true; fileInput.accept = 'image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/csv,.csv,.docx,.xlsx'; fileInput.setAttribute('aria-label', 'Arquivo para anexar'); fileInput.tabIndex = -1;
  const clip = button('📎', () => { if (!clip.disabled) fileInput.click(); }); clip.className = 'clip'; clip.hidden = true; clip.setAttribute('aria-label', 'Anexar arquivo');
  form.append(clip, input, send, fileInput);
  const footer = document.createElement('footer'); footer.textContent = 'Atendimento · Kloel AI';
  const sheetStatus = document.createElement('div'); sheetStatus.className = 'status'; sheetStatus.setAttribute('role', 'status');
  ${PUBLIC_CHAT_BOOKING_WIDGET}
  ${PUBLIC_CHAT_CALENDLY_WIDGET}
  function sheetsInfo(result) { footer.textContent = typeof result.sheetsNotice === 'string' ? result.sheetsNotice : 'Atendimento · Kloel AI'; if (Array.isArray(result.sheetOperations)) sheetStatus.textContent = result.sheetOperations.map(op => op.status === 'appended' ? 'Uma linha foi registrada na planilha.' : op.status === 'not_sent' ? 'O registro não foi enviado; esta referência foi preservada.' : 'Registro em planilha sem confirmação. Nada será reenviado automaticamente.').join(' '); }
  function add(message) {
    if (!message || typeof message.content !== 'string' || !['user', 'assistant'].includes(message.role)) return;
    if (message.id && seen.has(message.id)) return;
    if (message.id) seen.add(message.id);
    const item = document.createElement('div'); item.className = 'message' + (message.role === 'user' ? ' user' : '');
    if (message.id) item.dataset.messageId = message.id;
    const label = document.createElement('small'); label.textContent = message.role === 'user' ? 'Você' : message.authorType === 'human' ? 'Equipe' : 'Assistente';
    const body = document.createElement('span'); body.textContent = message.content; item.append(label, body); messages.append(item); messages.scrollTop = messages.scrollHeight;
  }
  function controls() { clip.disabled = busy || !initialized || !!attemptKey || terminal || !token; recoverOpening.hidden = !openingKey || openingReady; recoverOpening.disabled = busy || !token || terminal; send.disabled = busy || !initialized || !!attemptKey || terminal; input.disabled = busy || !initialized || !!attemptKey && attemptState !== 'not_found' || terminal; recover.hidden = !attemptKey && !responseReferences.length; recover.disabled = !!polling || busy || !token || terminal; retry.hidden = !attemptKey || attemptState !== 'not_found'; retry.disabled = busy || !!polling || terminal; updateBookingCards(); updateCalendlyCards(); }
  function clearSession() { token = null; openingKey = null; openingRevision = null; openingHttpRevision = null; openingReady = false; attemptKey = null; attemptState = null; attemptBody = null; responseReferences = []; initialized = false; cursor = null; polling = null; confirmedNotice = ''; seen.clear(); stopPolling(); persist(); }
  function stopPolling() { if (timer !== null) clearTimeout(timer); timer = null; }
  function schedule() { stopPolling(); if (!panel.hidden && !document.hidden && token && initialized && !terminal) timer = setTimeout(() => { void syncHistory().finally(schedule); }, 5000); }
  async function api(path, data, method = 'POST', extra = {}) {
    const capturedToken = token;
    const suffix = new URLSearchParams(extra).toString();
    const response = await fetch(base + '/api/v1/public/chat/' + path + '?' + query + (suffix ? '&' + suffix : ''), { method, credentials: 'omit', headers: { ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(35000) });
    const result = await response.json();
    if (capturedToken !== token) { const error = new Error('Consulta de uma sessão anterior descartada.'); error.stale = true; throw error; }
    if (!response.ok) {
      if ([401, 403, 410].includes(response.status)) { terminal = true; stopPolling(); if (response.status === 401 || response.status === 410) clearSession(); }
      const error = new Error(result.error && result.error.message || 'Atendimento indisponível. Consulte o envio antes de tentar novamente.'); error.status = response.status; throw error;
    }
    return result;
  }
  async function syncHistory() {
    if (!token || polling === token || terminal) return;
    const syncToken = token; polling = syncToken; controls();
    try {
      for (let page = 0; page < 2; page++) {
        const lookupKey = attemptKey || responseReferences.at(-1);
        const result = await api('history', undefined, 'GET', { ...(cursor ? { after: cursor } : {}), ...(lookupKey ? { operationKey: lookupKey } : {}) });
        result.items.forEach(add); cursor = result.cursor; mode = result.mode; sheetsInfo(result); showBookingChoices(result); showCalendlyChoices(result);
        if (attemptKey && result.operation && result.operation.key === attemptKey) {
          attemptState = result.operation.status;
          if (result.operation.status === 'succeeded' || result.operation.status === 'unknown' && result.operation.inputRecorded === true && result.operation.canContinue === true) {
            if (result.operation.status === 'unknown') responseReferences = [...new Set([...responseReferences, attemptKey])];
            attemptKey = null; attemptState = null; attemptBody = null; input.value = ''; persist();
          } else status.textContent = result.operation.status === 'not_found' ? 'Envio não localizado. Confira o texto e use Retomar tentativa para enviar com a mesma chave. Nada será reenviado automaticamente.' : 'Envio sem resultado confirmado. Consulte novamente; não enviaremos outra cópia.';
        }
        if (!result.hasMore) break;
      }
      if (!attemptKey) { status.textContent = (responseReferences.length ? 'Mensagem registrada; uma resposta automática não foi confirmada. ' : '') + (mode === 'human' ? 'Sua conversa está com a equipe.' : ''); confirmedNotice = ''; }
    } catch (error) { if (!error.stale) status.textContent = (confirmedNotice ? confirmedNotice + ' O histórico não pôde ser atualizado: ' : '') + error.message; }
    finally { if (polling === syncToken) polling = null; controls(); }
  }
  function persistOpening() {
    const value = JSON.stringify({ token, expiresAt, openingKey, openingRevision, ...(openingHttpRevision!==null?{openingHttpRevision}:{}), ...(attemptKey ? { attemptKey } : {}), ...(responseReferences.length ? { responseReferences } : {}) });
    sessionStorage.setItem(storageKey, value);
    if (sessionStorage.getItem(storageKey) !== value) throw new Error('Não foi possível preservar a referência. Nenhuma abertura foi enviada.');
  }
  function acceptOpening(operation) {
    if (!operation || operation.key !== openingKey || operation.configRevision !== openingRevision || openingHttpRevision!==null && operation.httpSource?.sourceRevision!==openingHttpRevision || operation.surface !== 'webchat' || operation.mode !== 'live' || operation.status !== 'ready' || operation.automaticRetry !== false || operation.tenantId !== tenantId || typeof operation.conversationId !== 'string') throw new Error('A abertura não foi confirmada. Consulte a referência original.');
    openingReady = true; initialized = true;
  }
  async function recoverBeforeOpening() {
    if (!token || !openingKey || terminal) return;
    const key = openingKey, activeToken = token;
    try { const operation = await api('opening', undefined, 'GET'); if (openingKey !== key || token !== activeToken) return; acceptOpening(operation); await syncHistory(); }
    catch (error) { if (!error.stale) status.textContent = 'Abertura sem confirmação. Nada será reenviado automaticamente. ' + error.message; }
    finally { controls(); }
  }
  const recoverOpening = button('Consultar abertura', () => { if (!busy && !terminal) void recoverBeforeOpening(); }); recoverOpening.hidden = true;
  const recover = button('Consultar envio', () => { void syncHistory(); }); recover.hidden = true;
  const retry = button('Retomar tentativa', () => {
    if (!attemptKey || attemptState !== 'not_found' || busy || terminal) return;
    const message = input.value.trim();
    if (!message || message.length > 4000 || attemptBody && attemptBody !== message) { status.textContent = 'Use o mesmo texto da tentativa original para retomar este envio.'; return; }
    void sendAttempt(message);
  }); retry.hidden = true;
  async function initialize() {
    if (busy) return;
    if (initialized && !terminal) { void syncHistory(); schedule(); return; }
    busy = true; send.disabled = true; status.textContent = 'Conectando…';
    try {
      terminal = false; messages.replaceChildren(); clearBookingCards(); clearCalendlyCards(); seen.clear(); cursor = null;
      if (token) {
        if (openingKey) await recoverBeforeOpening();
        else { initialized = true; await syncHistory(); }
      } else {
        const result = await api('sessions', {}); token = result.token;
        expiresAt = result.expiresAt;
        sheetsInfo(result); title.textContent = look && look.displayName || result.assistantName || 'Atendimento Kloel AI';
        if (result.beforeContext && result.beforeContext.enabled === true) {
          openingKey = crypto.randomUUID(); openingRevision = result.beforeContext.revision; openingHttpRevision = result.beforeContext.httpSource?.revision ?? null;
          if(openingHttpRevision!==null&&(!Number.isSafeInteger(openingHttpRevision)||openingHttpRevision<1))throw new Error('Revisão HTTP inválida.');
          if (!Number.isSafeInteger(openingRevision) || openingRevision < 1) throw new Error('Revisão de abertura inválida.');
          persistOpening();
          const opened = await api('opening', { expectedConfigRevision: openingRevision, ...(openingHttpRevision!==null?{expectedHttpRevision:openingHttpRevision}:{}), idempotencyKey: openingKey });
          acceptOpening(opened.operation); await syncHistory();
        } else { persist(); add({ role: 'assistant', content: result.greeting }); initialized = true; await syncHistory(); }
      }
    } catch (error) { status.textContent = error.message; }
    finally { busy = false; controls(); schedule(); input.focus(); }
  }
  const launch = button('Conversar com a Kloel', () => { panel.hidden = !panel.hidden; launch.setAttribute('aria-expanded', String(!panel.hidden)); if (!panel.hidden) void initialize(); else stopPolling(); }); launch.className = 'launcher'; launch.setAttribute('aria-expanded', 'false');
  const close = button('Fechar', () => { panel.hidden = true; stopPolling(); launch.setAttribute('aria-expanded', 'false'); launch.focus(); });
  const end = button('Encerrar', async () => {
    if (busy) return; busy = true; send.disabled = true;
    try { if (token) await api('end', {}); clearSession(); clearBookingCards(); clearCalendlyCards(); messages.replaceChildren(); status.textContent = 'Conversa encerrada. As referências de agendamento continuam disponíveis. Feche e abra para iniciar outra.'; }
    catch (error) { status.textContent = error.message; }
    finally { busy = false; controls(); }
  });
  header.append(avatar, title, end, close); panel.append(header, messages, bookingArea, calendlyArea, status, sheetStatus, recoverOpening, recover, retry, form, footer); root.append(panel, launch);
  if (pageMode) { style.textContent += '.panel{inset:0;width:100%;height:100dvh;bottom:0;right:0;border:0;border-radius:0;box-shadow:none}.launcher{display:none}'; close.hidden = true; panel.hidden = false; launch.setAttribute('aria-expanded', 'true'); setTimeout(() => void initialize(), 0); }
  async function sendAttempt(message) {
    busy = true; confirmedNotice = ''; attemptState = null; attemptBody = message; if (!attemptKey) attemptKey = crypto.randomUUID(); persist(); controls(); status.textContent = 'Enviando mensagem…';
    try {
      const result = await api('messages', { message, idempotencyKey: attemptKey });
      attemptKey = null; attemptBody = null; input.value = ''; persist(); confirmedNotice = result.status === 'human_pending' ? 'Mensagem registrada para a equipe.' : result.responseState === 'suppressed' ? 'Mensagem registrada. A resposta automática foi interrompida pelo atendimento.' : 'Mensagem registrada.'; status.textContent = confirmedNotice;
      await syncHistory();
    }
    catch (error) { status.textContent = error.message; }
    finally { busy = false; controls(); schedule(); input.focus(); }
  }
  // Aparência publicada (Personalizar). Falha de rede mantém o visual padrão; nada aqui envia dados do visitante.
  let look = null;
  function applyLook(value) {
    if (!value || typeof value !== 'object') return; look = value;
    if (/^#[0-9a-f]{6}$/i.test(value.accent)) for (const node of [panel, launch]) node.style.setProperty('--accent', value.accent);
    panel.classList.toggle('dark', value.theme === 'dark'); panel.classList.toggle('accent-header', value.accentMode === 'header');
    if (typeof value.displayName === 'string' && value.displayName) { title.textContent = value.displayName.slice(0, 100); panel.setAttribute('aria-label', 'Atendimento ' + value.displayName.slice(0, 100)); }
    const picture = value.avatar === 'upload' && typeof value.avatarUrl === 'string' && value.avatarUrl.startsWith('/api/v1/public/webchat/avatar?') ? base + value.avatarUrl : value.avatar === 'masculino' ? ${JSON.stringify(DEFAULT_AVATARS.masculino)} : ${JSON.stringify(DEFAULT_AVATARS.feminino)};
    avatar.style.backgroundImage = 'url("' + picture.replace(/"/g, '%22') + '")'; avatar.classList.toggle('ring', value.avatarBorder === true);
    clip.hidden = value.attachments !== true;
  }
  fetch(base + '/api/v1/public/webchat/appearance?' + query, { method: 'GET', credentials: 'omit', signal: AbortSignal.timeout(15000) }).then(response => response.ok ? response.json() : null).then(applyLook).catch(() => {});
  // Anexo: o arquivo vai para o atendimento (equipe) e a conversa recebe a referência como mensagem do visitante.
  fileInput.addEventListener('change', () => { const file = fileInput.files && fileInput.files[0]; fileInput.value = ''; if (file) void attach(file); });
  async function attach(file) {
    if (busy || !initialized || attemptKey || terminal || !token) return;
    if (file.size > 2 * 1024 * 1024) { status.textContent = 'O arquivo pode ter no máximo 2 MB.'; return; }
    busy = true; controls(); status.textContent = 'Enviando anexo…'; let message = null;
    try {
      const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.')); reader.readAsDataURL(file); });
      const office = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv' };
      const extension = (/\.([a-z0-9]+)$/i.exec(file.name) || [])[1];
      const contentType = file.type || office[String(extension).toLowerCase()] || '';
      const response = await fetch(base + '/api/v1/public/webchat/attachments?' + query, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ name: file.name.replace(/[\u0000-\u001f\u007f\/\\]/g, '_').slice(0, 120) || 'arquivo', contentType, dataBase64: data.slice(data.indexOf(',') + 1) }), signal: AbortSignal.timeout(60000) });
      const result = await response.json();
      if (!response.ok || typeof result.message !== 'string') throw new Error(result.error && result.error.message || 'Não foi possível enviar o anexo.');
      message = result.message;
    } catch (error) { status.textContent = error.message; }
    finally { busy = false; controls(); }
    if (message) await sendAttempt(message);
  }
  form.addEventListener('submit', event => {
    event.preventDefault(); const message = input.value.trim(); if (!message || busy || !initialized || attemptKey || terminal) return;
    void sendAttempt(message);
  });
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') close.click(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopPolling(); else if (!panel.hidden) schedule(); });
  window.addEventListener('pagehide', stopPolling);
  if (document.body) document.body.append(host); else document.addEventListener('DOMContentLoaded', () => document.body.append(host), { once: true });
})();`;
