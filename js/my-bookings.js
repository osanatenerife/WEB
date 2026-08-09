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

  const STR = {
    loading: { es: 'Buscando tus reservas…', en: 'Looking up your bookings…' },
    noBookings: { es: 'No hemos encontrado reservas futuras con esos datos.', en: "We couldn't find any upcoming bookings with those details." },
    genericError: { es: 'Ha ocurrido un error, inténtalo de nuevo.', en: 'Something went wrong, please try again.' },
    confirmCancel: { es: '¿Seguro que quieres cancelar esta cita?', en: 'Are you sure you want to cancel this appointment?' },
    cancelledRefunded: { es: '✓ Cita cancelada — se ha reembolsado el importe pagado.', en: '✓ Appointment cancelled — the amount paid has been refunded.' },
    cancelledNoRefund: { es: '✓ Cita cancelada — al ser con menos de 48h de antelación, no hay reembolso automático. Escríbenos por WhatsApp si tienes dudas.', en: '✓ Appointment cancelled — since it was less than 48h in advance, there is no automatic refund. Message us on WhatsApp if you have questions.' },
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
    chooseNewDate: { es: 'Elige la nueva fecha', en: 'Choose the new date' },
    searchingSlots: { es: 'Buscando huecos libres…', en: 'Looking for available times…' },
    noSlots: { es: 'No quedan huecos libres ese día. Prueba con otra fecha.', en: 'No available times left that day. Try another date.' },
    confirmReschedule: { es: '¿Cambiar tu cita al {date} a las {time}?', en: 'Move your appointment to {date} at {time}?' },
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
    const breakdownHtml = b.price > 0 ? `
      <div class="mybooking-breakdown">
        <span>${t('totalLabel')}: <strong>${b.price.toFixed(2)} €</strong></span>
        <span>${t('paidLabel')}: <strong>${(Number(b.amountPaid) || 0).toFixed(2)} €</strong></span>
        ${pending > 0 ? `<span>${t('pendingLabel')}: <strong>${pending.toFixed(2)} €</strong></span>` : ''}
      </div>
      ${pointsFromPaid > 0 ? `<div class="mybooking-points-note">${t('pointsFromPaid')(pointsFromPaid.toFixed(2))}</div>` : ''}
    ` : '';
    return `
      <div class="mybooking-card" data-booking-id="${b.bookingId}">
        <div class="mybooking-top">
          <div>
            <div class="mybooking-service">${b.serviceName}</div>
            <div class="mybooking-meta">${b.date} · ${b.time} · ${t('with')} ${b.employeeName}</div>
          </div>
          <div class="mybooking-price">${b.amountPaid > 0 ? b.amountPaid.toFixed(0) + ' €' : t('free')}</div>
        </div>
        ${breakdownHtml}
        <div class="mybooking-actions">
          <button type="button" class="mybooking-cancel-btn">${t('cancel')}</button>
          <button type="button" class="mybooking-reschedule-btn">${t('reschedule')}</button>
          <button type="button" class="mybooking-addtreatment-btn">${t('addTreatment')}</button>
        </div>
        <div class="mybooking-reschedule-panel"></div>
        <div class="mybooking-addtreatment-panel"></div>
      </div>
    `;
  }

  function historyCardHtml(b) {
    return `
      <div class="mybooking-card">
        <div class="mybooking-top">
          <div>
            <div class="mybooking-service">${b.serviceName}</div>
            <div class="mybooking-meta">${b.date} · ${b.time} · ${t('with')} ${b.employeeName}</div>
          </div>
          <div class="mybooking-price">${b.price > 0 ? b.price.toFixed(0) + ' €' : t('free')}</div>
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

  function renderBookings(bookings) {
    if (!bookings.length) {
      resultsEl.innerHTML = `<p class="mybooking-empty">${t('noBookings')}</p>`;
      return;
    }
    resultsEl.innerHTML = `<div class="mybooking-list">${bookings.map(cardHtml).join('')}</div>`;
    bookings.forEach((b) => wireCard(b));
  }

  function wireCard(b) {
    const card = resultsEl.querySelector(`[data-booking-id="${b.bookingId}"]`);
    if (!card) return;
    card.querySelector('.mybooking-cancel-btn').addEventListener('click', () => handleCancel(b, card));
    const rescheduleBtn = card.querySelector('.mybooking-reschedule-btn');
    const panel = card.querySelector('.mybooking-reschedule-panel');
    rescheduleBtn.addEventListener('click', () => {
      const willOpen = !panel.classList.contains('open');
      panel.classList.toggle('open', willOpen);
      if (willOpen && !panel.dataset.wired) {
        wireReschedulePanel(b, panel);
        panel.dataset.wired = '1';
      }
    });
    const addBtn = card.querySelector('.mybooking-addtreatment-btn');
    const addPanel = card.querySelector('.mybooking-addtreatment-panel');
    addBtn.addEventListener('click', () => {
      const willOpen = !addPanel.classList.contains('open');
      addPanel.classList.toggle('open', willOpen);
      if (willOpen && !addPanel.dataset.wired) {
        wireAddTreatmentPanel(b, addPanel);
        addPanel.dataset.wired = '1';
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
      card.innerHTML = `<p class="mybooking-status-note ok">${data.refunded ? t('cancelledRefunded') : t('cancelledNoRefund')}</p>`;
    } catch (e) {
      alert(e.message);
    }
  }

  function wireReschedulePanel(b, panel) {
    panel.innerHTML = `
      <div class="booking-field">
        <label>${t('chooseNewDate')}</label>
        <input type="date" class="mb-date-input" min="${minDateStr()}">
      </div>
      <div class="booking-slot-grid mb-slots"></div>
    `;
    const dateInput = panel.querySelector('.mb-date-input');
    const slotsEl = panel.querySelector('.mb-slots');
    dateInput.addEventListener('change', async () => {
      if (!dateInput.value) return;
      slotsEl.innerHTML = `<p class="booking-slot-message">${t('searchingSlots')}</p>`;
      try {
        const params = new URLSearchParams({ bookingId: b.bookingId, phone: currentPhone, email: currentEmail, date: dateInput.value });
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
          slot.addEventListener('click', () => confirmReschedule(b, dateInput.value, time));
          slotsEl.appendChild(slot);
        });
      } catch (e) {
        slotsEl.innerHTML = '';
        alert(e.message);
      }
    });
  }

  async function confirmReschedule(b, date, time) {
    const msg = t('confirmReschedule').replace('{date}', date).replace('{time}', time);
    if (!confirm(msg)) return;
    try {
      const res = await fetch(`${BOOKING_API_BASE}/my-bookings/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: b.bookingId, phone: currentPhone, email: currentEmail, newDate: date, newTime: time }),
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
      renderLoyalty(data.loyaltyBalance, data.loyaltyHistory);
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
