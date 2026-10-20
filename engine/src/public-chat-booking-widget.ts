/** Inserted into the widget closure. Credentials are original visitor capabilities, never cookies. */
export const PUBLIC_CHAT_BOOKING_WIDGET = String.raw`
  const bookingArea = document.createElement('div'); bookingArea.className = 'bookings'; bookingArea.setAttribute('aria-label', 'Agendamentos');
  const bookingStorageKey = storageKey + ':booking-references:v1';
  const bookingCards = new Map(), bookingViews = new Map(), bookingBusy = new Set(), bookingCurrentChoices = new Map();
  let bookingStorageError = false;
  function bookingReferences() {
    const raw = sessionStorage.getItem(bookingStorageKey); if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list) || list.length > 20 || list.some(r => !r || !/^[a-f0-9-]{36}$/.test(r.key) || !/^[A-Za-z0-9_-]{43}$/.test(r.token) || !Number.isFinite(r.expiresAt) || !Number.isSafeInteger(r.actionRevision) || r.actionRevision < 1 || ['actionId','eventTypeId','conversationId'].some(k => !/^[a-f0-9-]{36}$/.test(r[k])))) throw Error('As referências de agendamento não puderam ser lidas. Nenhuma nova reserva será enviada.');
    return list;
  }
  function persistBookingReferences(list) {
    const value = JSON.stringify(list); sessionStorage.setItem(bookingStorageKey, value);
    if (sessionStorage.getItem(bookingStorageKey) !== value) throw Error('Não foi possível preservar a referência. Nenhuma reserva foi enviada.');
  }
  function sameBookingReference(a,b) { return !!a && !!b && a.key === b.key && a.token === b.token && a.actionId === b.actionId && a.actionRevision === b.actionRevision && a.conversationId === b.conversationId && a.eventTypeId === b.eventTypeId; }
  function originalBookingReference(ref) { return bookingReferences().some(r => sameBookingReference(r,ref)); }
  function bookingBlocked(choice) {
    try { return bookingStorageError || bookingReferences().some(r => r.conversationId === choice.conversationId && r.eventTypeId === choice.eventTypeId && bookingViews.get(r.key)?.status !== 'not_sent'); }
    catch { bookingStorageError = true; return true; }
  }
  async function bookingApi(path, credential, data, extra = {}) {
    const suffix = new URLSearchParams(extra).toString();
    const response = await fetch(base + '/api/v1/public/chat/' + path + '?' + query + (suffix ? '&' + suffix : ''), { method: data === undefined ? 'GET' : 'POST', credentials: 'omit', headers: { Authorization: 'Bearer ' + credential, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(35000) });
    const result = await response.json();
    if (!response.ok) throw Error(response.status === 404 ? 'Referência ainda não localizada. Isso não prova ausência de reserva. Consulte novamente; nada será reenviado.' : 'Não foi possível consultar ou confirmar este agendamento. A referência foi preservada.');
    return result;
  }
  function acceptBookingView(ref, result) {
    if (!originalBookingReference(ref) || !result || result.key !== ref.key || result.kind !== 'booking.create' || result.actionId !== ref.actionId || result.actionRevision !== ref.actionRevision || result.conversationId !== ref.conversationId || result.eventTypeId !== ref.eventTypeId || result.automaticRetry !== false || result.notifications !== 'not_sent' || !['pending','unknown','accepted','confirmed','conflict','not_sent'].includes(result.status)) throw Error('O recibo não corresponde à referência original. Nenhuma nova reserva foi enviada.');
    bookingViews.set(ref.key, result); renderBookingReferences(); updateBookingCards();
  }
  const bookingReceipts = document.createElement('div'); bookingArea.append(bookingReceipts);
  function renderBookingReferences() {
    bookingReceipts.replaceChildren(); let refs;
    try { refs = bookingReferences(); } catch (error) { bookingStorageError = true; const p = document.createElement('p'); p.textContent = error.message; bookingReceipts.append(p); return; }
    for (const ref of refs) {
      const row = document.createElement('section'); row.dataset.bookingKey = ref.key;
      const label = document.createElement('p'), view = bookingViews.get(ref.key);
      label.textContent = 'Referência ' + ref.key + ': ' + (view?.status === 'confirmed' ? 'agendamento confirmado.' : view?.status === 'conflict' ? 'evento registrado com conflito; consulte a reserva.' : view?.status === 'accepted' ? 'o Google aceitou a solicitação; a reserva ainda precisa ser verificada.' : view?.status === 'not_sent' ? 'esta tentativa não foi enviada. Atualize os horários antes de outra intenção.' : 'resultado ainda não confirmado. Nenhuma reserva será reenviada automaticamente.');
      const note = document.createElement('p'); note.setAttribute('role','status');
      const recoverBooking = button('Consultar agendamento', async () => {
        if (bookingBusy.has(ref.key) || !originalBookingReference(ref)) return;
        bookingBusy.add(ref.key); recoverBooking.disabled = true;
        try { acceptBookingView(ref, await bookingApi('booking-operation',ref.token,undefined,{operationKey:ref.key})); }
        catch (error) { if (originalBookingReference(ref)) note.textContent = error.message; }
        finally { bookingBusy.delete(ref.key); recoverBooking.disabled = false; }
      }); recoverBooking.disabled = bookingBusy.has(ref.key); row.append(label,note,recoverBooking);
      if (view && ['confirmed','conflict'].includes(view.status)) {
        const manage = button('Obter link da reserva',async () => {
          if (bookingBusy.has(ref.key) || !originalBookingReference(ref)) return;
          bookingBusy.add(ref.key); manage.disabled = true;
          try {
            const result = await bookingApi('booking-management-link',ref.token,{operationKey:ref.key});
            if (!originalBookingReference(ref) || result.bookingRef !== view.bookingRef) return;
            const url = new URL(result.url), params = new URLSearchParams(url.hash.slice(1));
            if (url.origin !== base || !/^\/c\/o-[a-f0-9]{24}\/[a-z0-9-]+$/.test(url.pathname) || url.search || params.get('booking') !== result.bookingRef || !/^[A-Za-z0-9_-]{43}$/.test(params.get('manage') || '') || [...params.keys()].length !== 2) throw Error('Link de reserva inválido.');
            const link = document.createElement('a'); link.href = url.href; link.textContent = 'Abrir reserva'; link.target = '_blank'; link.rel = 'noopener noreferrer'; note.replaceChildren(link);
          } catch (error) { if (originalBookingReference(ref)) note.textContent = error.message; }
          finally { bookingBusy.delete(ref.key); manage.disabled = false; }
        }); row.append(manage);
      }
      bookingReceipts.append(row);
    }
  }
  function updateBookingCards() { for (const card of bookingCards.values()) card.update(); }
  function clearBookingCards() { for (const card of bookingCards.values()) card.node.remove(); bookingCards.clear(); bookingCurrentChoices.clear(); }
  function showBookingChoices(result) {
    if (!Array.isArray(result.bookingChoices)) return;
    for (const choice of result.bookingChoices.slice(0,10)) {
      if (!choice || bookingCards.has(choice.choiceId) || !Array.isArray(choice.slots) || !Array.isArray(choice.form) || choice.slots.length > 200 || choice.form.length > 3 || choice.remoteAvailabilityComplete !== true || choice.reservationsGuaranteed !== false) continue;
      const credential = token, node = document.createElement('section'); node.className = 'booking-card'; node.dataset.choiceId = choice.choiceId;
      const choiceScope = credential + ':' + choice.conversationId + ':' + choice.actionId;
      bookingCurrentChoices.set(choiceScope,choice.choiceId);
      const heading = document.createElement('h3'); heading.textContent = String(choice.title);
      const timezone = document.createElement('p'); timezone.textContent = 'Horários em ' + choice.timezone + '. A disponibilidade será conferida novamente ao reservar. Sem convidados ou notificações adicionais.';
      const select = document.createElement('select'); select.setAttribute('aria-label','Horário do agendamento');
      for (const slot of choice.slots) { const option = document.createElement('option'); option.value = slot.quote; option.textContent = new Intl.DateTimeFormat('pt-BR',{timeZone:choice.timezone,dateStyle:'short',timeStyle:'short'}).format(new Date(slot.startAt)); select.append(option); }
      const fields = {}, inputs = [];
      for (const field of choice.form) {
        if (!['name','email','phone'].includes(field.field)) continue;
        const label = document.createElement('label'), item = document.createElement('input'); label.textContent = String(field.label); item.setAttribute('aria-label',String(field.label)); item.required = field.required === true; item.type = field.field === 'email' ? 'email' : field.field === 'phone' ? 'tel' : 'text'; item.maxLength = field.field === 'name' ? 120 : field.field === 'email' ? 254 : 20;
        fields[field.field] = item; inputs.push(item); label.append(item); node.append(label);
      }
      const values = () => Object.fromEntries(Object.entries(fields).map(([key,input]) => [key,input.value.trim()]));
      let confirmation = null, sending = false, refreshing = false;
      const note = document.createElement('p'); note.setAttribute('role','status');
      const confirm = button('Confirmar agendamento',async () => {
        const intended = confirmation;
        if (!intended || sending || refreshing || bookingCurrentChoices.get(choiceScope)!==choice.choiceId || credential !== token || terminal || !initialized || bookingBlocked(choice) || intended.quote !== select.value || JSON.stringify(intended.values) !== JSON.stringify(values())) return;
        const slot = choice.slots.find(s => s.quote === intended.quote);
        if (!slot || Date.parse(slot.expiresAt) <= Date.now()) { confirmation = null; note.textContent = 'Horário expirado. Atualize os horários.'; update(); return; }
        const ref = {key:crypto.randomUUID(),token:credential,expiresAt,actionId:choice.actionId,eventTypeId:choice.eventTypeId,conversationId:choice.conversationId,actionRevision:choice.actionRevision,chatOperationKey:choice.chatOperationKey};
        try { const refs=bookingReferences(); if(refs.length>=20) throw Error('Limite de referências preservadas atingido. Consulte suas reservas; nada foi enviado.'); persistBookingReferences([...refs,ref]); }
        catch(error) { note.textContent=error.message; return; }
        confirmation=null; sending=true; renderBookingReferences(); updateBookingCards();
        try { const result=await bookingApi('bookings',credential,{actionId:choice.actionId,expectedRevision:choice.actionRevision,choiceId:choice.choiceId,quote:intended.quote,values:intended.values,idempotencyKey:ref.key,confirm:true}); acceptBookingView(ref,result.operation); }
        catch(error) { if(originalBookingReference(ref)) note.textContent=error.message; }
        finally { sending=false; update(); }
      }); confirm.hidden=true;
      const review = button('Revisar agendamento',()=>{
        if (sending || refreshing || bookingCurrentChoices.get(choiceScope)!==choice.choiceId || credential !== token || terminal || !initialized || bookingBlocked(choice) || !select.value || inputs.some(i=>!i.checkValidity())) return;
        confirmation={quote:select.value,values:values()}; note.textContent='Confira o horário e os dados. A confirmação criará uma única reserva.'; update();
      });
      const cancel = button('Voltar aos dados',()=>{confirmation=null;update();});cancel.hidden=true;
      const refresh = button('Atualizar horários',async()=>{
        if(sending||refreshing||credential!==token||terminal||!initialized)return;
        refreshing=true;confirmation=null;update();
        try {
          const from=choice.slots[0]?.startAt || new Date().toISOString(),to=choice.slots.at(-1)?.endAt || new Date(Date.parse(from)+86400000).toISOString();
          const next=await bookingApi('booking-slots',credential,{actionId:choice.actionId,expectedRevision:choice.actionRevision,from,to});
          if(credential!==token||terminal||!bookingCards.has(choice.choiceId))return;
          showBookingChoices({bookingChoices:[next]}); note.textContent='Novos horários foram consultados em outro cartão. Seus dados neste cartão foram mantidos.';
        }catch(error){if(credential===token)note.textContent=error.message;}
        finally{refreshing=false;update();}
      });
      function update() { const blocked=bookingCurrentChoices.get(choiceScope)!==choice.choiceId||credential!==token||terminal||!initialized||bookingBlocked(choice); if(bookingCurrentChoices.get(choiceScope)!==choice.choiceId)confirmation=null;review.disabled=sending||refreshing||blocked||!choice.allowCreate||!choice.slots.length; confirm.hidden=!confirmation;cancel.hidden=!confirmation;confirm.disabled=sending||refreshing||blocked;refresh.disabled=sending||refreshing||credential!==token||terminal;select.disabled=sending;for(const item of inputs)item.disabled=sending; }
      for(const item of [select,...inputs])item.addEventListener('input',()=>{confirmation=null;update();});
      node.prepend(heading,timezone,select); node.append(note,review,confirm,cancel,refresh);
      if(choice.complete===false&&typeof choice.nextFrom==='string'){
        const more=button('Consultar próximos horários',async()=>{
          if(sending||refreshing||credential!==token||terminal||!initialized)return;
          refreshing=true;confirmation=null;more.disabled=true;update();
          try{const next=await bookingApi('booking-slots',credential,{actionId:choice.actionId,expectedRevision:choice.actionRevision,from:choice.nextFrom,to:new Date(Date.parse(choice.nextFrom)+7*86400000).toISOString()});if(credential===token&&!terminal&&bookingCards.has(choice.choiceId))showBookingChoices({bookingChoices:[next]});}
          catch(error){if(credential===token)note.textContent=error.message;}
          finally{refreshing=false;more.disabled=false;update();}
        });node.append(more);
      }
      bookingCards.set(choice.choiceId,{node,update}); bookingArea.append(node); updateBookingCards();
    }
  }
  renderBookingReferences();
`;
