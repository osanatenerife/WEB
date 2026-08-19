// ============================================================
// OSANA — "Mis reservas": consultar, cancelar y reprogramar citas
// ============================================================
(function () {
  const form = document.getElementById('mb-lookup-form');
  if (!form) return;

  const LANG = document.documentElement.lang === 'en' ? 'en' : 'es';
  const phoneInput = document.getElementById('mb-phone');
  const emailInput = document.getElementById('mb-email');
  const resultsEl = document.getElementById('mb-results');
  const errorEl = document.getElementById('mb-error');
  const historyWrapEl = document.getElementById('mb-history-wrap');
  const historyEl = document.getElementById('mb-history');
  const loyaltyEl = document.getElementById('mb-loyalty');
  const pendingBonosEl = document.getElementById('mb-pending-bonos');
  const noShowNoticeEl = document.getElementById('mb-noshow-notice');

  const STR = {
    loading: { es: 'Buscando tus reservas…', en: 'Looking up your bookings…' },
    noBookings: { es: 'No hemos encontrado reservas futuras con esos datos.', en: "We couldn't find any upcoming bookings with those details." },
    genericError: { es: 'Ha ocurrido un error, inténtalo de nuevo.', en: 'Something went wrong, please try again.' },
    confirmCancel: { es: '¿Seguro que quieres cancelar esta cita?', en: 'Are you sure you want to cancel this appointment?' },
    cancelledRefunded: { es: '✓ Cita cancelada — se ha reembolsado el importe pagado.', en: '✓ Appointment cancelled — the amount paid has been refunded.' },
    cancelledNoRefund: { es: '✓ Cita cancelada — al ser con menos de 48h de antelación, no hay reembolso automático. Escríbenos por WhatsApp si tienes dudas.', en: '✓ Appointment cancelled — since it was less than 48h in advance, there is no automatic refund. Message us on WhatsApp if you have questions.' },
    cancelledNothingToRefund: { es: '✓ Cita cancelada.', en: '✓ Appointment cancelled.' },
    cancelledRefundFailed: { es: '✓ Cita cancelada — avisaste con tiempo suficiente, así que te corresponde el reembolso, pero ha habido un problema técnico al procesarlo automáticamente. Nuestro equipo lo revisará y te lo devolverá a mano en breve. Escríbenos por WhatsApp si tienes dudas.', en: '✓ Appointment cancelled — you gave enough notice so a refund applies, but there was a technical issue processing it automatically. Our team will review it and refund you by hand shortly. Message us on WhatsApp if you have questions.' },
    cancel: { es: 'Cancelar cita', en: 'Cancel appointment' },
    reschedule: { es: 'Cambiar fecha/hora', en: 'Change date/time' },
    addTreatment: { es: 'Añadir tratamiento', en: 'Add treatment' },
    addTreatmentPlaceholder: { es: '+ Añadir tratamiento…', en: '+ Add treatment…' },
    payDepositOnly: { es: 'Pagar solo la reserva', en: 'Pay booking fee only' },
    payFullNow: { es: 'Pagar todo ahora', en: 'Pay in full now' },
    restAtCenterParen: { es: '(resto en el centro)', en: '(rest at the centre)' },
    fullRequired: { es: 'Este tratamiento se paga completo online:', en: 'This treatment is paid in full online:' },
    depositRequired: { es: 'Este tratamiento requiere pagar la reserva ahora:', en: 'This treatment requires paying the booking fee now:' },
    confirmAndPay: { es: 'Pagar y añadir', en: 'Pay and add' },
    connectingPayment: { es: 'Conectando con el pago…', en: 'Connecting to payment…' },
    addTreatmentNote: { es: 'Se añade justo después de tu tratamiento actual, con la misma profesional. Si no hay hueco libre, te lo diremos antes de cobrarte nada.', en: 'Added right after your current treatment, with the same specialist. If there\'s no free slot, we\'ll tell you before charging anything.' },
    noHistory: { es: 'Todavía no tienes visitas pasadas registradas.', en: "You don't have any past visits on record yet." },
    noShowForgivenNote: { es: 'Falta sin penalización — puedes reprogramar sin coste.', en: 'No-show without penalty — you can reschedule at no cost.' },
    noShowNoticeForgiven: { es: 'Falta sin penalización. (Has faltado a tu cita o no avisaste con 48h de antelación). La próxima falta sin aviso previo de 48h se descontará el importe de la reserva o la sesión del bono.', en: "No-show without penalty. (You missed your appointment or didn't give 48h notice). The next no-show without 48h notice will deduct the booking fee or the package session." },
    noShowNoticePenalized: { es: 'Falta con penalización — se ha descontado el importe de la reserva o la sesión del bono correspondiente. Para la próxima, te pedimos avisar con 48h de antelación.', en: 'No-show with penalty — the booking fee or package session has been deducted. For next time, please give us at least 48h notice.' },
    pendingBonoTitle: { es: 'Sesiones de bono pendientes de reservar', en: 'Package sessions ready to book' },
    pendingBonoGroupNote: { es: 'Marca las sesiones que quieras reservar juntas, en la misma visita.', en: 'Tick the sessions you want to book together, in the same visit.' },
    pendingBonoSessionOf: { es: (used, total) => `Sesión ${used + 1} de ${total}`, en: (used, total) => `Session ${used + 1} of ${total}` },
    pendingBonoSessionsLeft: { es: (n) => `Ya pagada — te queda${n === 1 ? '' : 'n'} ${n} ${n === 1 ? 'sesión' : 'sesiones'} en el bono`, en: (n) => `Already paid — ${n} session${n === 1 ? '' : 's'} left on your package` },
    bookThisSession: { es: 'Reservar esta sesión', en: 'Book this session' },
    confirmBonoBooking: { es: '¿Reservar esta sesión para el {date} a las {time}?', en: 'Book this session for {date} at {time}?' },
    bonoBooked: { es: '✓ Sesión reservada.', en: '✓ Session booked.' },
    chooseNewDate: { es: 'Elige la nueva fecha', en: 'Choose the new date' },
    chooseTherapist: { es: 'Elige profesional disponible', en: 'Choose an available specialist' },
    bonoBadge: { es: 'Bono activo', en: 'Active package' },
    paidBadge: { es: 'Pagada', en: 'Paid' },
    pendingPaymentBadge: { es: 'Pendiente de pago', en: 'Payment pending' },
    searchingSlots: { es: 'Buscando huecos libres…', en: 'Looking for available times…' },
    noSlots: { es: 'No quedan huecos libres ese día. Prueba con otra fecha.', en: 'No available times left that day. Try another date.' },
    confirmReschedule: { es: '¿Cambiar tu cita al {date} a las {time}?', en: 'Move your appointment to {date} at {time}?' },
    lateStrikeFirstTime: { es: '✓ Cita cambiada. Ha sido con menos de 48h de antelación — esta vez no pasa nada, pero la próxima vez avisa con más tiempo si puedes.', en: "✓ Appointment changed. It was less than 48h in advance — this time it's fine, but please give us more notice next time if you can." },
    lateStrikeRepeat: { es: '✓ Cita cambiada. Ha sido con menos de 48h de antelación — al ser un aviso tardío, queda registrado.', en: '✓ Appointment changed. It was less than 48h in advance — as a late notice, this has been recorded.' },
    groupVisitTitle: {
      es: (date, time, employeeName) => `Tu sesión del ${date} a las ${time} · Con ${employeeName}`,
      en: (date, time, employeeName) => `Your session on ${date} at ${time} · With ${employeeName}`,
    },
    groupRescheduleNote: { es: 'Elige qué tratamientos de esta sesión quieres mover a la nueva fecha. El tiempo que busquemos será la suma de los que marques.', en: "Choose which treatments from this session you want to move to the new date. We'll search for a slot long enough for everything you select." },
    chooseAtLeastOne: { es: 'Elige al menos un tratamiento.', en: 'Choose at least one treatment.' },
    with: { es: 'Con', en: 'With' },
    free: { es: 'Gratis', en: 'Free' },
    totalLabel: { es: 'Total', en: 'Total' },
    paidLabel: { es: 'Pagado', en: 'Paid' },
    pendingLabel: { es: 'Pendiente en el centro', en: 'Pending at the centre' },
    pointsFromPaid: { es: (n) => `+${n} € de saldo por lo ya pagado`, en: (n) => `+€${n} balance earned from what's already paid` },
    loyaltyLabel: { es: 'Tu saldo de fidelización', en: 'Your loyalty balance' },
    loyaltyHistoryTitle: { es: 'Historial de saldo', en: 'Balance history' },
    loyaltyHistoryToggle: { es: 'Ver historial', en: 'View history' },
    loyaltyEarnLine: { es: (amount, service, date) => `+${amount} € · ${service} · ${date}`, en: (amount, service, date) => `+€${amount} · ${service} · ${date}` },
    loyaltyRedeemLine: { es: (amount, service, date) => `−${amount} € canjeados · ${service} · ${date}`, en: (amount, service, date) => `−€${amount} redeemed · ${service} · ${date}` },
    loyaltyExpiry: {
      es: (dateLabel) => `Caduca el ${dateLabel}`,
      en: (dateLabel) => `Expires ${dateLabel}`,
    },
    loyaltyRules: {
      es: [
        'Se acumula un 4% de tus compras (tratamientos, bonos o productos), un 6% si pagas en efectivo.',
        'Importe mínimo de canje: 10 €.',
        'Se canjea en tratamientos sueltos y bonos de sesiones (no en productos ni bonos regalo).',
        'No se puede canjear más de lo que quede por pagar en la cita, ni más del saldo disponible.',
        'El saldo generado caduca cada 31 de diciembre — la cuenta empieza de cero cada 1 de enero.',
        'No es transferible entre clientas ni canjeable por dinero en efectivo — solo como descuento en un tratamiento o bono.',
      ],
      en: [
        'You earn 4% of your purchases (treatments, packages or products), 6% if paid in cash.',
        'Minimum redemption amount: €10.',
        'Redeemable on single treatments and session packages (not on products or gift vouchers).',
        'You can\'t redeem more than what\'s left to pay on the appointment, or more than your available balance.',
        'Balance earned expires every December 31st — the count starts fresh each January 1st.',
        'Not transferable between clients or redeemable for cash — only as a discount on a treatment or package.',
      ],
    },
  };
  function t(key) { return (STR[key] && STR[key][LANG]) || key; }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  let currentPhone = '';
  let currentEmail = '';

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
  }
  function clearError() {
    errorEl.style.display = 'none';
  }

  function minDateStr() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  function cardHtml(b) {
    const pending = round2(Math.max(0, (Number(b.price) || 0) - (Number(b.amountPaid) || 0)));
    const pointsFromPaid = round2((Number(b.amountPaid) || 0) * 0.04);
    // "Gratis" solo tiene sentido si de verdad no cuesta nada — una sesión
    // de bono con 0€ cobrados hoy ya está pagada (se pagó al comprar el
    // bono), y un tratamiento suelto con precio pero nada cobrado todavía
    // está pendiente de pago, no gratis.
    let priceBadgeHtml;
    if (b.bonoId || (b.price > 0 && b.amountPaid >= b.price)) {
      priceBadgeHtml = `<span class="mybooking-price-paid">✓ ${t('paidBadge')}</span>`;
    } else if (b.amountPaid > 0) {
      priceBadgeHtml = `${b.amountPaid.toFixed(0)} €`;
    } else if (b.price > 0) {
      priceBadgeHtml = `<span class="mybooking-price-pending">${t('pendingPaymentBadge')}</span>`;
    } else {
      priceBadgeHtml = t('free');
    }
    const breakdownHtml = b.price > 0 ? `
      <div class="mybooking-breakdown">
        <span>${t('totalLabel')}: <strong>${b.price.toFixed(2)} €</strong></span>
        <span>${t('paidLabel')}: <strong>${(Number(b.amountPaid) || 0).toFixed(2)} €</strong></span>
        ${pending > 0 ? `<span>${t('pendingLabel')}: <strong>${pending.toFixed(2)} €</strong></span>` : ''}
      </div>
      ${pointsFromPaid > 0 ? `<div class="mybooking-points-note">${t('pointsFromPaid')(pointsFromPaid.toFixed(2))}</div>` : ''}
    ` : '';
    // Una ausencia perdonada la 1ª vez no admite cancelar (ya pasó, no hay
    // nada que reembolsar) ni añadir tratamiento (eso es para sumar algo a
    // una visita que todavía va a ocurrir en su hora original) — solo se
    // puede elegir un nuevo día y hora. El aviso general de la política de
    // faltas se muestra una sola vez arriba de la página, no aquí.
    return `
      <div class="mybooking-card" data-booking-id="${b.bookingId}">
        <div class="mybooking-top">
          <div>
            <div class="mybooking-service">${b.serviceName}</div>
            <div class="mybooking-meta">${b.date} · ${b.time} · ${t('with')} ${b.employeeName}</div>
          </div>
          <div class="mybooking-price">${priceBadgeHtml}</div>
        </div>
        ${b.noShowForgiven ? `<div class="mybooking-status-note ok">${t('noShowForgivenNote')}</div>` : breakdownHtml}
        <div class="mybooking-actions">
          ${!b.noShowForgiven ? `<button type="button" class="mybooking-cancel-btn">${t('cancel')}</button>` : ''}
          <button type="button" class="mybooking-reschedule-btn">${t('reschedule')}</button>
          ${!b.noShowForgiven ? `<button type="button" class="mybooking-addtreatment-btn">${t('addTreatment')}</button>` : ''}
        </div>
        <div class="mybooking-reschedule-panel"></div>
        ${!b.noShowForgiven ? '<div class="mybooking-addtreatment-panel"></div>' : ''}
      </div>
    `;
  }

  function historyCardHtml(b) {
    const priceBadgeHtml = b.bonoId
      ? `<span class="mybooking-price-paid">✓ ${t('paidBadge')}</span>`
      : (b.price > 0 ? b.price.toFixed(0) + ' €' : t('free'));
    return `
      <div class="mybooking-card">
        <div class="mybooking-top">
          <div>
            <div class="mybooking-service">${b.serviceName}</div>
            <div class="mybooking-meta">${b.date} · ${b.time} · ${t('with')} ${b.employeeName}</div>
          </div>
          <div class="mybooking-price">${priceBadgeHtml}</div>
        </div>
      </div>
    `;
  }

  async function loadHistory() {
    try {
      const params = new URLSearchParams({ phone: currentPhone, email: currentEmail });
      const res = await fetch(`${BOOKING_API_BASE}/my-bookings/history?${params}`);
      const data = await res.json();
      if (!res.ok) return;
      historyWrapEl.style.display = 'block';
      if (!data.bookings.length) {
        historyEl.innerHTML = `<p class="mybooking-empty">${t('noHistory')}</p>`;
        return;
      }
      historyEl.innerHTML = `<div class="mybooking-list">${data.bookings.map(historyCardHtml).join('')}</div>`;
    } catch (e) {
      // el historial es un extra informativo; si falla, no bloqueamos el resto de la página
    }
  }

  // Varios tratamientos de la MISMA visita (p.ej. íntimo + axilas + piernas
  // reservados juntos) llegan como reservas independientes, una por
  // tratamiento — se agrupan aquí por fecha+hora+profesional para que la
  // clienta las vea y las reprograme como una sola sesión, no una por una.
  // Las faltas (perdonadas o no) no se agrupan: son solo informativas, cada
  // línea lleva su propio aviso y no hay nada conjunto que reprogramar.
  function groupBookings(bookings) {
    const byKey = new Map();
    bookings.forEach((b) => {
      if (b.status !== 'confirmed') { byKey.set(`solo:${b.bookingId}`, [b]); return; }
      const key = `${b.date}|${b.time}|${b.employeeId}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(b);
    });
    return Array.from(byKey.values());
  }

  function renderBookings(bookings) {
    if (!bookings.length) {
      resultsEl.innerHTML = `<p class="mybooking-empty">${t('noBookings')}</p>`;
      return;
    }
    const groups = groupBookings(bookings);
    resultsEl.innerHTML = `<div class="mybooking-list">${groups.map((g) => (g.length > 1 ? groupCardHtml(g) : cardHtml(g[0]))).join('')}</div>`;
    groups.forEach((g) => (g.length > 1 ? wireGroupCard(g) : wireCard(g[0])));
  }

  function wireCard(b) {
    const card = resultsEl.querySelector(`[data-booking-id="${b.bookingId}"]`);
    if (!card) return;
    const cancelBtn = card.querySelector('.mybooking-cancel-btn');
    if (cancelBtn) cancelBtn.addEventListener('click', () => handleCancel(b, card));
    const rescheduleBtn = card.querySelector('.mybooking-reschedule-btn');
    const panel = card.querySelector('.mybooking-reschedule-panel');
    if (rescheduleBtn && panel) {
      rescheduleBtn.addEventListener('click', () => {
        const willOpen = !panel.classList.contains('open');
        panel.classList.toggle('open', willOpen);
        if (willOpen && !panel.dataset.wired) {
          wireReschedulePanel(b, panel);
          panel.dataset.wired = '1';
        }
      });
    }
    const addBtn = card.querySelector('.mybooking-addtreatment-btn');
    const addPanel = card.querySelector('.mybooking-addtreatment-panel');
    if (addBtn && addPanel) {
      addBtn.addEventListener('click', () => {
        const willOpen = !addPanel.classList.contains('open');
        addPanel.classList.toggle('open', willOpen);
        if (willOpen && !addPanel.dataset.wired) {
          wireAddTreatmentPanel(b, addPanel);
          addPanel.dataset.wired = '1';
        }
      });
    }
  }

  // ── Varios tratamientos de la misma visita agrupados en una sola tarjeta:
  // cada línea conserva su propio Cancelar/Añadir tratamiento, pero
  // "Cambiar fecha/hora" es una acción conjunta para toda la sesión ──
  function groupCardHtml(group) {
    const first = group[0];
    const linesHtml = group.map((b) => `
      <div class="mybooking-group-line" data-booking-id="${b.bookingId}">
        <div class="mybooking-group-line-top">
          <span class="mybooking-group-line-name">${b.serviceName}</span>
          <span class="mybooking-price">${b.bonoId || (b.price > 0 && b.amountPaid >= b.price)
            ? `<span class="mybooking-price-paid">✓ ${t('paidBadge')}</span>`
            : (b.amountPaid > 0 ? b.amountPaid.toFixed(0) + ' €' : (b.price > 0 ? `<span class="mybooking-price-pending">${t('pendingPaymentBadge')}</span>` : t('free')))}</span>
        </div>
        <div class="mybooking-group-line-actions">
          <button type="button" class="mybooking-cancel-btn">${t('cancel')}</button>
          <button type="button" class="mybooking-addtreatment-btn">${t('addTreatment')}</button>
        </div>
        <div class="mybooking-addtreatment-panel"></div>
      </div>
    `).join('');
    return `
      <div class="mybooking-card mybooking-card-group" data-group-key="${first.date}|${first.time}|${first.employeeId}">
        <div class="mybooking-group-title">${t('groupVisitTitle')(first.date, first.time, first.employeeName)}</div>
        ${linesHtml}
        <div class="mybooking-actions">
          <button type="button" class="mybooking-group-reschedule-btn">${t('reschedule')}</button>
        </div>
        <div class="mybooking-group-reschedule-panel"></div>
      </div>
    `;
  }

  function wireGroupCard(group) {
    const groupKey = `${group[0].date}|${group[0].time}|${group[0].employeeId}`;
    const card = resultsEl.querySelector(`[data-group-key="${CSS.escape(groupKey)}"]`);
    if (!card) return;
    group.forEach((b) => {
      const line = card.querySelector(`[data-booking-id="${b.bookingId}"]`);
      if (!line) return;
      const cancelBtn = line.querySelector('.mybooking-cancel-btn');
      if (cancelBtn) cancelBtn.addEventListener('click', () => handleCancel(b, line));
      const addBtn = line.querySelector('.mybooking-addtreatment-btn');
      const addPanel = line.querySelector('.mybooking-addtreatment-panel');
      if (addBtn && addPanel) {
        addBtn.addEventListener('click', () => {
          const willOpen = !addPanel.classList.contains('open');
          addPanel.classList.toggle('open', willOpen);
          if (willOpen && !addPanel.dataset.wired) {
            wireAddTreatmentPanel(b, addPanel);
            addPanel.dataset.wired = '1';
          }
        });
      }
    });
    const rescheduleBtn = card.querySelector('.mybooking-group-reschedule-btn');
    const panel = card.querySelector('.mybooking-group-reschedule-panel');
    rescheduleBtn.addEventListener('click', () => {
      const willOpen = !panel.classList.contains('open');
      panel.classList.toggle('open', willOpen);
      if (willOpen && !panel.dataset.wired) {
        wireGroupReschedulePanel(group, panel);
        panel.dataset.wired = '1';
      }
    });
  }

  // ── Añadir un tratamiento a una cita ya confirmada ──
  let servicesCache = null;
  async function loadServicesOnce() {
    if (servicesCache) return servicesCache;
    const res = await fetch(`${BOOKING_API_BASE}/services?lang=${LANG}`);
    const data = await res.json();
    servicesCache = data.services || [];
    return servicesCache;
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  function computeAddonAmount(service, paymentChoice) {
    const { paymentPolicy, depositPercent, price } = service;
    if (paymentPolicy === 'full_required') return { amount: price, type: 'total' };
    if (paymentPolicy === 'deposit_required') return { amount: round2((price * depositPercent) / 100), type: 'deposit' };
    if (paymentChoice === 'full') return { amount: price, type: 'total' };
    return { amount: round2((price * (depositPercent || 30)) / 100), type: 'deposit' };
  }

  async function wireAddTreatmentPanel(b, panel) {
    panel.innerHTML = `<p class="booking-slot-message">${t('loading')}</p>`;
    let services;
    try {
      services = await loadServicesOnce();
    } catch (e) {
      panel.innerHTML = `<p class="mybooking-status-note">${t('genericError')}</p>`;
      return;
    }
    const byCategory = {};
    services.forEach((s) => {
      (byCategory[s.category] = byCategory[s.category] || []).push(s);
    });
    const optionsHtml = Object.keys(byCategory).map((cat) => `
      <optgroup label="${cat}">
        ${byCategory[cat].map((s) => `<option value="${s.id}">${s.name} — ${s.price.toFixed(0)} €</option>`).join('')}
      </optgroup>
    `).join('');

    panel.innerHTML = `
      <p class="mybooking-addtreatment-note">${t('addTreatmentNote')}</p>
      <select class="mb-addon-select">
        <option value="">${t('addTreatmentPlaceholder')}</option>
        ${optionsHtml}
      </select>
      <div class="mb-addon-pay-options"></div>
      <button type="button" class="mb-addon-confirm-btn btn-primary" style="display:none;">${t('confirmAndPay')}</button>
    `;

    const select = panel.querySelector('.mb-addon-select');
    const payOptionsEl = panel.querySelector('.mb-addon-pay-options');
    const confirmBtn = panel.querySelector('.mb-addon-confirm-btn');
    let chosenPayChoice = 'deposit';

    select.addEventListener('change', () => {
      const service = services.find((s) => s.id === select.value);
      if (!service) {
        payOptionsEl.innerHTML = '';
        confirmBtn.style.display = 'none';
        return;
      }
      chosenPayChoice = 'deposit';
      const depositAmount = computeAddonAmount(service, 'deposit').amount;
      if (service.paymentPolicy === 'full_required') {
        payOptionsEl.innerHTML = `<p class="booking-pay-note">${t('fullRequired')} <strong>${service.price.toFixed(2)} €</strong></p>`;
        chosenPayChoice = 'full';
      } else if (service.paymentPolicy === 'deposit_required') {
        payOptionsEl.innerHTML = `<p class="booking-pay-note">${t('depositRequired')} <strong>${depositAmount.toFixed(2)} €</strong></p>`;
      } else {
        payOptionsEl.innerHTML = `
          <label class="booking-pay-option">
            <input type="radio" name="mb-addon-pay-${b.bookingId}" value="deposit" checked>
            <span>${t('payDepositOnly')} <strong>${depositAmount.toFixed(2)} €</strong> ${t('restAtCenterParen')}</span>
          </label>
          <label class="booking-pay-option">
            <input type="radio" name="mb-addon-pay-${b.bookingId}" value="full">
            <span>${t('payFullNow')} <strong>${service.price.toFixed(2)} €</strong></span>
          </label>
        `;
        payOptionsEl.querySelectorAll('input[type="radio"]').forEach((r) => {
          r.addEventListener('change', () => { chosenPayChoice = r.value; });
        });
      }
      confirmBtn.style.display = 'inline-block';
    });

    confirmBtn.addEventListener('click', async () => {
      const service = services.find((s) => s.id === select.value);
      if (!service) return;
      confirmBtn.disabled = true;
      confirmBtn.textContent = t('connectingPayment');
      try {
        const res = await fetch(`${BOOKING_API_BASE}/my-bookings/add-treatment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingId: b.bookingId, phone: currentPhone, email: currentEmail,
            serviceId: service.id, paymentChoice: chosenPayChoice, lang: LANG,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || t('genericError'));
        window.location.href = data.url;
      } catch (e) {
        alert(e.message);
        confirmBtn.disabled = false;
        confirmBtn.textContent = t('confirmAndPay');
      }
    });
  }

  async function handleCancel(b, card) {
    if (!confirm(t('confirmCancel'))) return;
    try {
      const res = await fetch(`${BOOKING_API_BASE}/my-bookings/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: b.bookingId, phone: currentPhone, email: currentEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('genericError'));
      const msgKey = {
        refunded: 'cancelledRefunded',
        not_eligible: 'cancelledNoRefund',
        nothing_to_refund: 'cancelledNothingToRefund',
        failed: 'cancelledRefundFailed',
      }[data.refundStatus] || (data.refunded ? 'cancelledRefunded' : 'cancelledNoRefund');
      card.innerHTML = `<p class="mybooking-status-note ok">${t(msgKey)}</p>`;
    } catch (e) {
      alert(e.message);
    }
  }

  async function wireReschedulePanel(b, panel) {
    panel.innerHTML = `<p class="booking-slot-message">${t('loading')}</p>`;
    let employeeOptionsHtml = '';
    if (b.serviceId) {
      try {
        const res = await fetch(`${BOOKING_API_BASE}/employees?serviceIds=${encodeURIComponent(b.serviceId)}`);
        const data = await res.json();
        const emps = data.employees || [];
        // Solo tiene sentido el selector si hay más de una profesional que
        // pueda con este tratamiento — si solo hay una (la de siempre), no
        // se ofrece elegir para no complicar la pantalla sin motivo.
        if (emps.length > 1) {
          employeeOptionsHtml = emps.map((e) => `<option value="${e.id}"${e.id === b.employeeId ? ' selected' : ''}>${escapeHtml(e.name)}</option>`).join('');
        }
      } catch (e) {
        // si falla, simplemente no se ofrece cambiar de profesional — se sigue pudiendo reprogramar con la misma
      }
    }
    panel.innerHTML = `
      ${employeeOptionsHtml ? `
      <div class="booking-field">
        <label>${t('chooseTherapist')}</label>
        <select class="mb-employee-input">${employeeOptionsHtml}</select>
      </div>` : ''}
      <div class="booking-field">
        <label>${t('chooseNewDate')}</label>
        <input type="date" class="mb-date-input" min="${minDateStr()}">
      </div>
      <div class="booking-slot-grid mb-slots"></div>
    `;
    const employeeInput = panel.querySelector('.mb-employee-input');
    const dateInput = panel.querySelector('.mb-date-input');
    const slotsEl = panel.querySelector('.mb-slots');
    async function searchSlots() {
      if (!dateInput.value) return;
      slotsEl.innerHTML = `<p class="booking-slot-message">${t('searchingSlots')}</p>`;
      try {
        const params = new URLSearchParams({ bookingId: b.bookingId, phone: currentPhone, email: currentEmail, date: dateInput.value });
        if (employeeInput && employeeInput.value) params.set('employeeId', employeeInput.value);
        const res = await fetch(`${BOOKING_API_BASE}/my-bookings/slots?${params}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || t('genericError'));
        slotsEl.innerHTML = '';
        if (!data.slots || !data.slots.length) {
          slotsEl.innerHTML = `<p class="booking-slot-message">${t('noSlots')}</p>`;
          return;
        }
        data.slots.forEach((time) => {
          const slot = document.createElement('div');
          slot.className = 'booking-slot';
          slot.textContent = time;
          slot.addEventListener('click', () => confirmReschedule(b, dateInput.value, time, employeeInput ? employeeInput.value : ''));
          slotsEl.appendChild(slot);
        });
      } catch (e) {
        slotsEl.innerHTML = '';
        alert(e.message);
      }
    }
    dateInput.addEventListener('change', searchSlots);
    if (employeeInput) employeeInput.addEventListener('change', searchSlots);
  }

  async function confirmReschedule(b, date, time, newEmployeeId) {
    const msg = t('confirmReschedule').replace('{date}', date).replace('{time}', time);
    if (!confirm(msg)) return;
    try {
      const res = await fetch(`${BOOKING_API_BASE}/my-bookings/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: b.bookingId, phone: currentPhone, email: currentEmail, newDate: date, newTime: time,
          ...(newEmployeeId ? { newEmployeeId } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('genericError'));
      if (data.lateStrike) {
        alert(data.lateStrike.isFirstTime ? t('lateStrikeFirstTime') : t('lateStrikeRepeat'));
      }
      await loadBookings();
    } catch (e) {
      alert(e.message);
    }
  }

  // ── Reprogramar VARIOS tratamientos de la misma visita a la vez —
  // selecciona cuáles quiere mover (por defecto, todos) y busca el hueco
  // según la duración conjunta real, no la de un tratamiento suelto. ──
  async function wireGroupReschedulePanel(group, panel) {
    panel.innerHTML = `<p class="booking-slot-message">${t('loading')}</p>`;
    const serviceIds = group.map((b) => b.serviceId).filter(Boolean);
    let employeeOptionsHtml = '';
    try {
      const res = await fetch(`${BOOKING_API_BASE}/employees?serviceIds=${encodeURIComponent(serviceIds.join(','))}`);
      const data = await res.json();
      const emps = data.employees || [];
      if (emps.length > 1) {
        employeeOptionsHtml = emps.map((e) => `<option value="${e.id}"${e.id === group[0].employeeId ? ' selected' : ''}>${escapeHtml(e.name)}</option>`).join('');
      }
    } catch (e) {
      // si falla, no se ofrece cambiar de profesional — se sigue pudiendo reprogramar con la misma
    }
    const checklistHtml = group.map((b) => `
      <label class="mb-group-check-item">
        <input type="checkbox" class="mb-group-check" value="${b.bookingId}" checked>
        <span>${b.serviceName}</span>
      </label>
    `).join('');
    panel.innerHTML = `
      <p class="mybooking-addtreatment-note">${t('groupRescheduleNote')}</p>
      <div class="mb-group-checklist">${checklistHtml}</div>
      ${employeeOptionsHtml ? `
      <div class="booking-field">
        <label>${t('chooseTherapist')}</label>
        <select class="mb-employee-input">${employeeOptionsHtml}</select>
      </div>` : ''}
      <div class="booking-field">
        <label>${t('chooseNewDate')}</label>
        <input type="date" class="mb-date-input" min="${minDateStr()}">
      </div>
      <div class="booking-slot-grid mb-slots"></div>
    `;
    const checkboxes = Array.from(panel.querySelectorAll('.mb-group-check'));
    const employeeInput = panel.querySelector('.mb-employee-input');
    const dateInput = panel.querySelector('.mb-date-input');
    const slotsEl = panel.querySelector('.mb-slots');
    function selectedBookings() {
      const ids = checkboxes.filter((c) => c.checked).map((c) => c.value);
      return group.filter((b) => ids.includes(b.bookingId));
    }
    async function searchSlots() {
      const selected = selectedBookings();
      if (!dateInput.value || !selected.length) {
        slotsEl.innerHTML = selected.length ? '' : `<p class="booking-slot-message">${t('chooseAtLeastOne')}</p>`;
        return;
      }
      slotsEl.innerHTML = `<p class="booking-slot-message">${t('searchingSlots')}</p>`;
      try {
        const params = new URLSearchParams({
          bookingIds: selected.map((b) => b.bookingId).join(','),
          phone: currentPhone, email: currentEmail, date: dateInput.value,
        });
        if (employeeInput && employeeInput.value) params.set('employeeId', employeeInput.value);
        const res = await fetch(`${BOOKING_API_BASE}/my-bookings/group-slots?${params}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || t('genericError'));
        slotsEl.innerHTML = '';
        if (!data.slots || !data.slots.length) {
          slotsEl.innerHTML = `<p class="booking-slot-message">${t('noSlots')}</p>`;
          return;
        }
        data.slots.forEach((time) => {
          const slot = document.createElement('div');
          slot.className = 'booking-slot';
          slot.textContent = time;
          slot.addEventListener('click', () => confirmGroupReschedule(selectedBookings(), dateInput.value, time, employeeInput ? employeeInput.value : ''));
          slotsEl.appendChild(slot);
        });
      } catch (e) {
        slotsEl.innerHTML = '';
        alert(e.message);
      }
    }
    checkboxes.forEach((c) => c.addEventListener('change', searchSlots));
    dateInput.addEventListener('change', searchSlots);
    if (employeeInput) employeeInput.addEventListener('change', searchSlots);
  }

  async function confirmGroupReschedule(selected, date, time, newEmployeeId) {
    if (!selected.length) return;
    const msg = t('confirmReschedule').replace('{date}', date).replace('{time}', time);
    if (!confirm(msg)) return;
    try {
      const res = await fetch(`${BOOKING_API_BASE}/my-bookings/reschedule-group`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingIds: selected.map((b) => b.bookingId), phone: currentPhone, email: currentEmail, newDate: date, newTime: time,
          ...(newEmployeeId ? { newEmployeeId } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('genericError'));
      if (data.lateStrike) {
        alert(data.lateStrike.isFirstTime ? t('lateStrikeFirstTime') : t('lateStrikeRepeat'));
      }
      await loadBookings();
    } catch (e) {
      alert(e.message);
    }
  }

  // ── Aviso general de faltas: uno solo arriba de la página, no repetido
  // por cada tratamiento de una visita combinada (eso daba a entender que
  // se habían penalizado varios tratamientos por separado). Se basa en el
  // registro agregado de faltas de la clienta, no en una reserva concreta.
  function renderNoShowNotice(notice) {
    if (!noShowNoticeEl) return;
    if (!notice) { noShowNoticeEl.style.display = 'none'; noShowNoticeEl.innerHTML = ''; return; }
    noShowNoticeEl.innerHTML = `
      <div class="mybooking-card mb-noshow-card ${notice.forgiven ? 'ok' : 'warn'}">
        ${t(notice.forgiven ? 'noShowNoticeForgiven' : 'noShowNoticePenalized')}
      </div>
    `;
    noShowNoticeEl.style.display = 'block';
  }

  // ── Sesiones de bono todavía sin cita puesta: la clienta puede reservarse
  // ella misma la siguiente sesión (ya pagada, sin coste extra). Si tiene
  // varias sesiones pendientes que siempre hace juntas en la misma visita
  // (p.ej. íntimo + axilas + piernas), las marca todas y se reservan como
  // UNA sola cita con la duración conjunta — no una por una. ──
  function pendingBonoItemHtml(bo) {
    return `
      <label class="mb-group-check-item">
        <input type="checkbox" class="mb-pendingbono-check" value="${bo.bonoId}" checked>
        <span class="mb-pendingbono-info">
          <span class="mb-pendingbono-name">${escapeHtml(bo.serviceName)}</span>
          <span class="mb-pendingbono-meta">${t('pendingBonoSessionOf')(bo.sessionsUsed, bo.totalSessions)} · ${t('pendingBonoSessionsLeft')(bo.sessionsRemaining)}</span>
        </span>
        <span class="mybooking-price-paid" style="margin-left:auto;">✓ ${t('paidBadge')}</span>
      </label>
    `;
  }

  function renderPendingBonos(list) {
    if (!pendingBonosEl) return;
    if (!list || !list.length) { pendingBonosEl.style.display = 'none'; pendingBonosEl.innerHTML = ''; return; }
    pendingBonosEl.innerHTML = `
      <h2 class="booking-step-title" style="margin-bottom:16px;">${t('pendingBonoTitle')}</h2>
      <div class="mybooking-card mybooking-card-bono">
        <span class="mybooking-bono-badge">🎁 ${t('bonoBadge')}</span>
        <p class="mybooking-addtreatment-note" style="margin-top:26px;">${t('pendingBonoGroupNote')}</p>
        <div class="mb-group-checklist">${list.map(pendingBonoItemHtml).join('')}</div>
        <div class="mybooking-actions">
          <button type="button" class="mybooking-book-bono-btn">${t('bookThisSession')}</button>
        </div>
        <div class="mybooking-reschedule-panel mb-pendingbono-panel"></div>
      </div>
    `;
    pendingBonosEl.style.display = 'block';
    const checkboxes = Array.from(pendingBonosEl.querySelectorAll('.mb-pendingbono-check'));
    const btn = pendingBonosEl.querySelector('.mybooking-book-bono-btn');
    const panel = pendingBonosEl.querySelector('.mb-pendingbono-panel');
    function selected() {
      const ids = checkboxes.filter((c) => c.checked).map((c) => c.value);
      return list.filter((bo) => ids.includes(bo.bonoId));
    }
    // Si cambia la selección con el panel abierto, se cierra — la
    // profesional y los huecos dependían de qué estaba marcado antes.
    checkboxes.forEach((c) => c.addEventListener('change', () => {
      panel.classList.remove('open');
      panel.innerHTML = '';
    }));
    btn.addEventListener('click', () => {
      const sel = selected();
      if (!sel.length) { alert(t('chooseAtLeastOne')); return; }
      const willOpen = !panel.classList.contains('open');
      panel.classList.toggle('open', willOpen);
      if (willOpen) wirePendingBonoPanel(sel, panel);
    });
  }

  async function wirePendingBonoPanel(list, panel) {
    panel.innerHTML = `<p class="booking-slot-message">${t('loading')}</p>`;
    const serviceIds = list.map((bo) => bo.serviceId);
    let employeeOptionsHtml = '';
    try {
      const res = await fetch(`${BOOKING_API_BASE}/employees?serviceIds=${encodeURIComponent(serviceIds.join(','))}`);
      const data = await res.json();
      const emps = data.employees || [];
      employeeOptionsHtml = emps.map((e) => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('');
    } catch (e) {
      // sigue abajo con employeeOptionsHtml vacío → se muestra el error genérico
    }
    if (!employeeOptionsHtml) {
      panel.innerHTML = `<p class="mybooking-status-note">${t('genericError')}</p>`;
      return;
    }
    panel.innerHTML = `
      <div class="booking-field">
        <label>${t('chooseTherapist')}</label>
        <select class="mb-employee-input">${employeeOptionsHtml}</select>
      </div>
      <div class="booking-field">
        <label>${t('chooseNewDate')}</label>
        <input type="date" class="mb-date-input" min="${minDateStr()}">
      </div>
      <div class="booking-slot-grid mb-slots"></div>
    `;
    const employeeInput = panel.querySelector('.mb-employee-input');
    const dateInput = panel.querySelector('.mb-date-input');
    const slotsEl = panel.querySelector('.mb-slots');
    async function searchSlots() {
      if (!dateInput.value) return;
      slotsEl.innerHTML = `<p class="booking-slot-message">${t('searchingSlots')}</p>`;
      try {
        const params = new URLSearchParams({
          bonoIds: list.map((bo) => bo.bonoId).join(','), phone: currentPhone, email: currentEmail,
          date: dateInput.value, employeeId: employeeInput.value,
        });
        const res = await fetch(`${BOOKING_API_BASE}/my-bookings/bono-group-slots?${params}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || t('genericError'));
        slotsEl.innerHTML = '';
        if (!data.slots || !data.slots.length) {
          slotsEl.innerHTML = `<p class="booking-slot-message">${t('noSlots')}</p>`;
          return;
        }
        data.slots.forEach((time) => {
          const slot = document.createElement('div');
          slot.className = 'booking-slot';
          slot.textContent = time;
          slot.addEventListener('click', () => confirmBonoBooking(list, dateInput.value, time, employeeInput.value));
          slotsEl.appendChild(slot);
        });
      } catch (e) {
        slotsEl.innerHTML = '';
        alert(e.message);
      }
    }
    dateInput.addEventListener('change', searchSlots);
    employeeInput.addEventListener('change', searchSlots);
  }

  async function confirmBonoBooking(list, date, time, employeeId) {
    const msg = t('confirmBonoBooking').replace('{date}', date).replace('{time}', time);
    if (!confirm(msg)) return;
    try {
      const res = await fetch(`${BOOKING_API_BASE}/my-bookings/book-bono-session-group`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bonoIds: list.map((bo) => bo.bonoId), phone: currentPhone, email: currentEmail, employeeId, date, time }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('genericError'));
      await loadBookings();
    } catch (e) {
      alert(e.message);
    }
  }

  function renderLoyalty(balance, history) {
    if (!loyaltyEl) return;
    const hasHistory = Array.isArray(history) && history.length > 0;
    if ((!balance || balance <= 0) && !hasHistory) { loyaltyEl.style.display = 'none'; loyaltyEl.innerHTML = ''; return; }
    const rulesHtml = t('loyaltyRules').map((r) => `<li>${r}</li>`).join('');
    const expiryDate = new Date(new Date().getFullYear(), 11, 31);
    const expiryLabel = expiryDate.toLocaleDateString(LANG === 'en' ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
    const historyItemsHtml = hasHistory ? history.map((m) => {
      const dateLabel = new Date(`${m.date}T12:00:00`).toLocaleDateString(LANG === 'en' ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'short' });
      const amount = Math.abs(m.amount).toFixed(2);
      return `<li class="mb-loyalty-history-item ${m.type === 'redeem' ? 'is-redeem' : 'is-earn'}">${
        m.type === 'redeem' ? t('loyaltyRedeemLine')(amount, m.serviceName, dateLabel) : t('loyaltyEarnLine')(amount, m.serviceName, dateLabel)
      }</li>`;
    }).join('') : '';
    loyaltyEl.innerHTML = `
      <div class="mb-loyalty-card">
        <div class="mb-loyalty-label">${t('loyaltyLabel')}</div>
        <div class="mb-loyalty-amount">${(balance || 0).toFixed(2)} €</div>
        <div class="mb-loyalty-expiry">${t('loyaltyExpiry')(expiryLabel)}</div>
        <ul class="mb-loyalty-rules">${rulesHtml}</ul>
        ${hasHistory ? `
          <button type="button" class="mb-loyalty-history-toggle">${t('loyaltyHistoryToggle')}</button>
          <div class="mb-loyalty-history-panel">
            <div class="mb-loyalty-history-title">${t('loyaltyHistoryTitle')}</div>
            <ul class="mb-loyalty-history-list">${historyItemsHtml}</ul>
          </div>
        ` : ''}
      </div>
    `;
    loyaltyEl.style.display = 'block';
    const historyToggle = loyaltyEl.querySelector('.mb-loyalty-history-toggle');
    const historyPanel = loyaltyEl.querySelector('.mb-loyalty-history-panel');
    if (historyToggle) {
      historyToggle.addEventListener('click', () => historyPanel.classList.toggle('open'));
    }
  }

  async function loadBookings() {
    clearError();
    resultsEl.innerHTML = `<p class="mybooking-loading">${t('loading')}</p>`;
    try {
      const params = new URLSearchParams({ phone: currentPhone, email: currentEmail });
      const res = await fetch(`${BOOKING_API_BASE}/my-bookings?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('genericError'));
      renderBookings(data.bookings);
      renderPendingBonos(data.pendingBonoSessions);
      renderLoyalty(data.loyaltyBalance, data.loyaltyHistory);
      renderNoShowNotice(data.noShowNotice);
    } catch (e) {
      resultsEl.innerHTML = '';
      showError(e.message);
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    currentPhone = phoneInput.value.trim();
    currentEmail = emailInput.value.trim();
    if (!currentPhone || !currentEmail) return;
    loadBookings();
    loadHistory();
  });
})();
