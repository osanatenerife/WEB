// ============================================================
// OSANA — Lógica del flujo de reserva (reserva.html / en/reserva.html)
// ============================================================
(function () {
  const LANG = (typeof window !== 'undefined' && window.BOOKING_LANG === 'en') ? 'en' : 'es';
  const DATE_LOCALE = LANG === 'en' ? 'en-GB' : 'es-ES';

  const STR = {
    chooseToStart: { es: 'Elige un tratamiento para empezar.', en: 'Choose a treatment to get started.' },
    free: { es: 'Gratis', en: 'Free' },
    totalDuration: { es: 'Duración total', en: 'Total duration' },
    withEmployee: { es: 'Con', en: 'With' },
    at: { es: 'a las', en: 'at' },
    loadServicesError: { es: 'No se pudieron cargar los tratamientos. Comprueba tu conexión e inténtalo de nuevo.', en: 'Could not load treatments. Check your connection and try again.' },
    loading: { es: 'Cargando…', en: 'Loading…' },
    loadEmployeesError: { es: 'No se pudieron cargar las profesionales.', en: 'Could not load the professionals.' },
    noEmployees: { es: 'No hay profesionales disponibles para este tratamiento. Escríbenos por WhatsApp.', en: 'No professionals available for this treatment. Message us on WhatsApp.' },
    searchingSlots: { es: 'Buscando huecos libres…', en: 'Looking for available times…' },
    noSlots: { es: 'No quedan huecos libres ese día. Prueba con otra fecha.', en: 'No available times left that day. Try another date.' },
    availabilityError: { es: 'No se pudo consultar la disponibilidad.', en: 'Could not check availability.' },
    fullRequired: { es: 'Este tratamiento requiere el pago completo online:', en: 'This treatment requires full payment online:' },
    depositRequired: { es: 'Este tratamiento requiere pagar la reserva ahora, un importe de', en: 'This treatment requires paying the booking fee now, an amount of' },
    restAtCenter: { es: 'resto de', en: 'remaining' },
    atCenter: { es: 'en el centro', en: 'at the center' },
    payDepositOnly: { es: 'Pagar solo la reserva —', en: 'Pay booking fee only —' },
    restAtCenterParen: { es: '(resto en el centro)', en: '(remaining amount paid at the center)' },
    payFullNow: { es: 'Pagar el total ahora —', en: 'Pay in full now —' },
    cancelPolicyNote: { es: 'Si cancelas con menos de 48h de antelación, el importe pagado no será reembolsado.', en: "If you cancel less than 48h in advance, the amount paid will not be refunded." },
    fillNamePhone: { es: 'Rellena tu nombre, teléfono y email para continuar.', en: 'Fill in your name, phone number and email to continue.' },
    missingBookingData: { es: 'Faltan datos de la reserva, vuelve a empezar.', en: 'Booking data is missing, please start again.' },
    connectingPayment: { es: 'Conectando con el pago seguro…', en: 'Connecting to secure payment…' },
    goToPayment: { es: 'Ir al pago seguro', en: 'Go to secure payment' },
    checkoutError: { es: 'No se pudo iniciar el pago.', en: 'Could not start the payment.' },
    confirmedTitle: { es: '¡Reserva confirmada! ✓', en: 'Booking confirmed! ✓' },
    confirmedText: { es: 'Te hemos enviado la confirmación. Si tienes cualquier duda, escríbenos por WhatsApp.', en: "We've sent you the confirmation. If you have any questions, message us on WhatsApp." },
    backHome: { es: 'Volver al inicio', en: 'Back to home' },
    cancelledPayment: { es: 'Has cancelado el pago. Puedes intentarlo de nuevo cuando quieras.', en: 'You cancelled the payment. You can try again whenever you like.' },
    addTreatment: { es: '+ Añadir tratamiento…', en: '+ Add treatment…' },
    removeAddon: { es: 'Quitar', en: 'Remove' },
    bonoTitle: { es: 'Ahorra con nuestros bonos de sesiones', en: 'Save with our session packages' },
    bonoPerSession: { es: (n) => `= ${n} € / sesión`, en: (n) => `= €${n} / session` },
    bonoSingleLabel: { es: 'Solo esta sesión', en: 'Just this session' },
    bonoPackLabel: { es: (n) => `Bono ${n} sesiones`, en: (n) => `${n}-session package` },
    bonoSaveNote: { es: (n) => `Ahorras ${n} €`, en: (n) => `Save €${n}` },
    bonoSessionNote: { es: (n) => `Reservas hoy la sesión 1 de ${n}. El resto se agendan en el centro.`, en: (n) => `Today you book session 1 of ${n}. The rest are scheduled at the center.` },
    bonoFullNote: { es: 'También puedes financiar el bono si pagas el total ahora.', en: 'You can also finance the package if you pay the full amount now.' },
    bonoTermsLabel: {
      es: 'He leído y acepto que, tras la primera ausencia sin preaviso o cancelación con menos de 48h se me avisará, y a partir de la segunda vez se descontará una sesión del bono.',
      en: 'I have read and accept that after the first no-show or cancellation with less than 48h notice I will be warned, and from the second time onward a session will be deducted from the package.',
    },
    bonoTermsRequired: { es: 'Tienes que aceptar las condiciones del bono para continuar.', en: 'You need to accept the package terms to continue.' },
    discountPlaceholder: { es: 'Código de descuento', en: 'Discount code' },
    discountApplyBtn: { es: 'Aplicar', en: 'Apply' },
    discountChooseTreatmentFirst: { es: 'Elige primero un tratamiento.', en: 'Choose a treatment first.' },
    discountNotForBono: { es: 'Los códigos de descuento no se pueden usar con bonos de sesiones.', en: 'Discount codes cannot be used with session packages.' },
    discountApplied: { es: (n) => `Código aplicado: -${n.toFixed(2)} €`, en: (n) => `Code applied: -€${n.toFixed(2)}` },
    discountLine: { es: 'Descuento', en: 'Discount' },
    discountStale: { es: 'El código ya no aplica a tu selección actual — vuelve a introducirlo si quieres aplicarlo.', en: 'The code no longer applies to your current selection — enter it again if you want to apply it.' },
    termsLabel: {
      es: 'He leído y acepto las <a href="condiciones.html" target="_blank" rel="noopener">condiciones de reserva, cancelación y el programa de fidelidad</a>.',
      en: 'I have read and accept the <a href="condiciones.html" target="_blank" rel="noopener">booking, cancellation and loyalty programme terms</a>.',
    },
    termsRequired: { es: 'Tienes que aceptar las condiciones de reserva para continuar.', en: 'You need to accept the booking terms to continue.' },
  };
  function t(key) { return (STR[key] && STR[key][LANG]) || (STR[key] && STR[key].es) || key; }

  const state = {
    service: null,
    extras: [],
    extraServices: [], // otros tratamientos añadidos a la misma cita (sesión suelta)
    extraBonos: [], // otros bonos añadidos a la misma cita (misma cita, distinto bono cada uno)
    employee: null,
    date: null,
    time: null,
    payChoice: 'deposit', // 'deposit' | 'full'
    wantsBono: false, // true si eligió el bono de varias sesiones en vez de una suelta
    bono: null, // { serviceId, serviceName, sessions, bonoPrice, singleSessionPrice }
    discountCode: null, // código ya validado por el servidor
    discountAmount: 0, // importe que se resta, calculado por el servidor
    discountValidatedIds: [], // ids de tratamientos con los que se validó — si la selección cambia, el descuento deja de aplicar
  };

  // "extras" son modificadores de zona/tiempo del tratamiento principal
  // (solo aplican cuando el principal NO es bono). "extraServices" y
  // "extraBonos" son otros tratamientos añadidos a la misma cita — sesión
  // suelta o bono, cualquier combinación, indistintamente del principal.
  function extrasDuration() { return state.extras.reduce((sum, e) => sum + e.durationMinutes, 0); }
  function extrasPrice() { return state.extras.reduce((sum, e) => sum + e.price, 0); }
  function addonsDuration() { return state.extraServices.reduce((sum, s) => sum + s.durationMinutes, 0); }
  function addonsPrice() { return state.extraServices.reduce((sum, s) => sum + s.price, 0); }
  function extraBonosDuration() { return state.extraBonos.reduce((sum, b) => sum + ((findServiceById(b.serviceId) || {}).durationMinutes || 0), 0); }
  function extraBonosPrice() { return state.extraBonos.reduce((sum, b) => sum + b.bonoPrice, 0); }
  function totalDuration() {
    const primary = state.service ? state.service.durationMinutes : 0;
    const modifiers = state.wantsBono ? 0 : extrasDuration();
    return primary + modifiers + addonsDuration() + extraBonosDuration();
  }
  function hasAnyBono() { return state.wantsBono || state.extraBonos.length > 0; }
  // Los códigos de descuento solo aplican al tratamiento principal (si no es
  // bono) y a los tratamientos sueltos añadidos — nunca a bonos de sesiones.
  function discountEligibleServiceIds() {
    const ids = [];
    if (state.service && !state.wantsBono) ids.push(state.service.id);
    state.extraServices.forEach((s) => ids.push(s.id));
    return ids;
  }
  // El descuento se validó contra una selección concreta de tratamientos —
  // si la selección cambia después (se añade/quita algo), deja de aplicar
  // hasta que se vuelva a comprobar el código.
  function discountIsStillValid() {
    if (!state.discountCode) return false;
    const current = discountEligibleServiceIds().slice().sort().join(',');
    const validated = state.discountValidatedIds.slice().sort().join(',');
    return current !== '' && current === validated;
  }
  function discountAmount() { return discountIsStillValid() ? state.discountAmount : 0; }
  function totalPrice() {
    const primary = state.wantsBono && state.bono ? state.bono.bonoPrice : (state.service ? state.service.price : 0);
    const modifiers = state.wantsBono ? 0 : extrasPrice();
    return primary + modifiers + addonsPrice() + extraBonosPrice() - discountAmount();
  }
  function selectedServiceIds() {
    return [state.service.id, ...state.extraServices.map((s) => s.id), ...state.extraBonos.map((b) => b.serviceId)];
  }
  function findServiceById(id) {
    for (const cat in servicesByCategory) {
      const found = servicesByCategory[cat].find((s) => s.id === id);
      if (found) return found;
    }
    return null;
  }

  const els = {
    shell: document.getElementById('booking-shell'),
    steps: document.querySelectorAll('.booking-progress-step'),
    panels: document.querySelectorAll('.booking-step-panel'),
    catPills: document.getElementById('booking-cat-pills'),
    services: document.getElementById('booking-services'),
    bonoSection: document.getElementById('booking-bono-section'),
    addonsSection: document.getElementById('booking-addons-section'),
    addonsChips: document.getElementById('booking-addons-chips'),
    addonsSelect: document.getElementById('booking-addons-select'),
    addonsModeChooser: document.getElementById('booking-addons-mode-chooser'),
    extrasSection: document.getElementById('booking-extras-section'),
    extras: document.getElementById('booking-extras'),
    step1Actions: document.getElementById('booking-step1-actions'),
    continueStep1: document.getElementById('booking-continue-step1'),
    employees: document.getElementById('booking-employees'),
    calMonthLabel: document.getElementById('cal-month-label'),
    calGrid: document.getElementById('booking-calendar-grid'),
    calPrev: document.getElementById('cal-prev'),
    calNext: document.getElementById('cal-next'),
    slots: document.getElementById('booking-slots'),
    summary: document.getElementById('booking-summary'),
    payOptions: document.getElementById('booking-pay-options'),
    submit: document.getElementById('booking-submit'),
    error: document.getElementById('booking-error'),
    discountCodeInput: document.getElementById('booking-discount-code'),
    discountApplyBtn: document.getElementById('booking-discount-apply'),
    discountMsg: document.getElementById('booking-discount-msg'),
  };

  function showError(msg) {
    els.error.textContent = msg;
    els.error.style.display = 'block';
    els.error.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function clearError() {
    els.error.style.display = 'none';
  }

  function goToStep(n) {
    els.shell.dataset.activeStep = String(n);
    els.panels.forEach((p) => p.classList.toggle('active', p.dataset.stepPanel === String(n)));
    els.steps.forEach((s) => {
      const stepNum = Number(s.dataset.step);
      s.classList.toggle('active', stepNum === n);
      s.classList.toggle('done', stepNum < n);
    });
    window.scrollTo({ top: document.getElementById('booking-steps').offsetTop - 90, behavior: 'smooth' });
  }

  document.querySelectorAll('.booking-back').forEach((btn) => {
    btn.addEventListener('click', () => goToStep(Number(btn.dataset.back)));
  });

  // ── Resumen persistente (panel lateral) ──
  function renderSummary() {
    const { service, extras, extraServices, extraBonos, employee, date, time } = state;
    if (!service) {
      els.summary.innerHTML = `<p class="booking-summary-empty">${t('chooseToStart')}</p>`;
      return;
    }
    let html;
    if (state.wantsBono && state.bono) {
      html = `<div class="booking-summary-row"><strong>${t('bonoPackLabel')(state.bono.sessions)} — ${service.name}</strong><span>${state.bono.bonoPrice.toFixed(0)} €</span></div>`;
    } else {
      html = `<div class="booking-summary-row"><strong>${service.name}</strong><span>${service.price > 0 ? service.price.toFixed(0) + ' €' : t('free')}</span></div>`;
      extras.forEach((ex) => {
        html += `<div class="booking-summary-row" style="margin-top:6px;"><span>+ ${ex.name}</span><span>${ex.price > 0 ? ex.price.toFixed(0) + ' €' : t('free')}</span></div>`;
      });
    }
    extraServices.forEach((s) => {
      html += `<div class="booking-summary-row" style="margin-top:6px;"><span>+ ${s.name}</span><span>${s.price > 0 ? s.price.toFixed(0) + ' €' : t('free')}</span></div>`;
    });
    extraBonos.forEach((b) => {
      html += `<div class="booking-summary-row" style="margin-top:6px;"><span>+ ${t('bonoPackLabel')(b.sessions)} — ${b.serviceName}</span><span>${b.bonoPrice.toFixed(0)} €</span></div>`;
    });
    if (discountIsStillValid()) {
      html += `<div class="booking-summary-row" style="margin-top:6px;"><span>${t('discountLine')} (${state.discountCode})</span><span>-${state.discountAmount.toFixed(0)} €</span></div>`;
    }
    html += `<div class="booking-summary-meta">${t('totalDuration')}: ${totalDuration()} min · <strong>${totalPrice().toFixed(0)} €</strong>${state.wantsBono ? ` · ${t('bonoSessionNote')(state.bono.sessions)}` : ''}</div>`;
    if (employee) {
      html += `<div class="booking-summary-line">${t('withEmployee')} <strong>${employee.name}</strong></div>`;
    }
    if (date && time) {
      const dateLabel = new Date(`${date}T12:00:00`).toLocaleDateString(DATE_LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });
      html += `<div class="booking-summary-line">${dateLabel} ${t('at')} ${time}</div>`;
    }
    els.summary.innerHTML = html;

    // Si había un código aplicado y la selección ha cambiado desde entonces,
    // avisamos de que hay que volver a comprobarlo (en vez de aplicarlo mal).
    if (state.discountCode && !discountIsStillValid()) {
      state.discountCode = null;
      state.discountAmount = 0;
      els.discountMsg.textContent = t('discountStale');
      els.discountMsg.className = 'booking-discount-msg error';
      els.discountMsg.style.display = 'block';
    }
  }

  els.discountApplyBtn.addEventListener('click', async () => {
    const code = els.discountCodeInput.value.trim();
    els.discountMsg.style.display = 'none';
    if (!code) return;
    if (hasAnyBono()) {
      els.discountMsg.textContent = t('discountNotForBono');
      els.discountMsg.className = 'booking-discount-msg error';
      els.discountMsg.style.display = 'block';
      return;
    }
    const ids = discountEligibleServiceIds();
    if (!ids.length) {
      els.discountMsg.textContent = t('discountChooseTreatmentFirst');
      els.discountMsg.className = 'booking-discount-msg error';
      els.discountMsg.style.display = 'block';
      return;
    }
    els.discountApplyBtn.disabled = true;
    try {
      const res = await fetch(`${BOOKING_API_BASE}/discount-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, serviceIds: ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('checkoutError'));
      state.discountCode = code.toUpperCase();
      state.discountAmount = data.amountOff;
      state.discountValidatedIds = ids;
      els.discountMsg.textContent = t('discountApplied')(data.amountOff);
      els.discountMsg.className = 'booking-discount-msg success';
      els.discountMsg.style.display = 'block';
    } catch (e) {
      state.discountCode = null;
      state.discountAmount = 0;
      state.discountValidatedIds = [];
      els.discountMsg.textContent = e.message;
      els.discountMsg.className = 'booking-discount-msg error';
      els.discountMsg.style.display = 'block';
    }
    els.discountApplyBtn.disabled = false;
    renderSummary();
  });

  // ── PASO 1: cargar servicios ──
  let servicesByCategory = {};
  let activeCategory = null;

  async function loadServices() {
    try {
      const res = await fetch(`${BOOKING_API_BASE}/services?lang=${LANG}`);
      const data = await res.json();
      servicesByCategory = {};
      data.services.forEach((s) => {
        servicesByCategory[s.category] = servicesByCategory[s.category] || [];
        servicesByCategory[s.category].push(s);
      });
      const categories = Object.keys(servicesByCategory);
      activeCategory = categories[0];
      renderCatPills(categories);
      renderServiceGrid();
    } catch (e) {
      showError(t('loadServicesError'));
    }
  }

  function renderCatPills(categories) {
    els.catPills.innerHTML = '';
    categories.forEach((cat) => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'booking-pill' + (cat === activeCategory ? ' active' : '');
      pill.textContent = cat;
      pill.addEventListener('click', () => {
        activeCategory = cat;
        els.catPills.querySelectorAll('.booking-pill').forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        renderServiceGrid();
      });
      els.catPills.appendChild(pill);
    });
  }

  function renderServiceGrid() {
    const items = servicesByCategory[activeCategory] || [];
    els.services.innerHTML = '';
    items.forEach((s) => {
      const card = document.createElement('div');
      card.className = 'booking-service-card' + (state.service && state.service.id === s.id ? ' selected' : '');
      card.innerHTML = `
        <strong>${s.name}</strong>
        <span class="booking-service-meta">${s.durationMinutes} min</span>
        ${s.description ? `<span class="booking-service-desc">${s.description}</span>` : ''}
        <span class="booking-service-price">${s.price > 0 ? s.price.toFixed(0) + ' €' : t('free')}</span>
      `;
      card.addEventListener('click', () => selectService(s, card));
      els.services.appendChild(card);
    });
  }

  // ── Bonos de sesiones (opcional, solo si el tratamiento elegido tiene uno) ──
  let bonosById = {};
  async function loadBonos() {
    try {
      const res = await fetch(`${BOOKING_API_BASE}/bonos?lang=${LANG}`);
      const data = await res.json();
      bonosById = {};
      (data.bonos || []).forEach((b) => {
        if (!bonosById[b.serviceId]) bonosById[b.serviceId] = [];
        bonosById[b.serviceId].push(b);
      });
      Object.values(bonosById).forEach((tiers) => tiers.sort((a, b) => a.sessions - b.sessions));
    } catch (e) {
      bonosById = {}; // si falla, simplemente no se ofrece bono — no bloquea la reserva normal
    }
  }

  function renderBonoSection() {
    const tiers = state.service ? bonosById[state.service.id] : null;
    if (!tiers || !tiers.length) {
      els.bonoSection.style.display = 'none';
      els.bonoSection.innerHTML = '';
      state.wantsBono = false;
      state.bono = null;
      return;
    }
    state.bono = tiers[0];
    const singlePrice = tiers[0].singleSessionPrice;
    const tierButtons = tiers.map((bono, i) => {
      const save = Math.max(0, bono.singleSessionPrice * bono.sessions - bono.bonoPrice);
      return `
        <button type="button" class="booking-bono-option booking-bono-option-pack${i === 0 ? ' selected' : ''}" data-bono="${i}">
          <span class="booking-bono-option-badge">${t('bonoSaveNote')(save.toFixed(0))}</span>
          <span class="booking-bono-option-name">${t('bonoPackLabel')(bono.sessions)}</span>
          <span class="booking-bono-option-price">${bono.bonoPrice.toFixed(0)} €</span>
          <span class="booking-bono-option-per-session">${t('bonoPerSession')((bono.bonoPrice / bono.sessions).toFixed(0))}</span>
        </button>
      `;
    }).join('');
    els.bonoSection.style.display = 'block';
    els.bonoSection.innerHTML = `
      <div class="booking-bono-title">✦ ${t('bonoTitle')}</div>
      <div class="booking-bono-options">
        <button type="button" class="booking-bono-option${!state.wantsBono ? ' selected' : ''}" data-bono="single">
          <span class="booking-bono-option-name">${t('bonoSingleLabel')}</span>
          <span class="booking-bono-option-price">${singlePrice.toFixed(0)} €</span>
        </button>
        ${tierButtons}
      </div>
      <p class="booking-bono-note">${t('bonoSessionNote')(state.bono.sessions)}</p>
    `;
    els.bonoSection.querySelectorAll('.booking-bono-option').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.wantsBono = btn.dataset.bono !== 'single';
        if (state.wantsBono) state.bono = tiers[Number(btn.dataset.bono)];
        els.bonoSection.querySelectorAll('.booking-bono-option').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        els.bonoSection.querySelector('.booking-bono-note').textContent = t('bonoSessionNote')(state.bono.sessions);
        // Los tratamientos añadidos (sueltos o bono) se mantienen igual al
        // cambiar el principal — solo cambian los "extras" de zona/tiempo,
        // que no tienen sentido si el principal pasa a ser un bono.
        if (state.wantsBono) {
          state.extras = [];
          els.extrasSection.style.display = 'none';
        } else {
          loadExtras();
        }
        renderAddonsSelect();
        renderSummary();
      });
    });
  }

  function selectService(service, cardEl) {
    state.service = service;
    state.extras = [];
    state.extraServices = [];
    state.extraBonos = [];
    state.wantsBono = false;
    document.querySelectorAll('#booking-services .booking-service-card').forEach((c) => c.classList.remove('selected'));
    cardEl.classList.add('selected');
    renderSummary();
    renderBonoSection();
    els.addonsSection.style.display = 'block';
    els.step1Actions.style.display = 'block';
    renderAddonsChips();
    renderAddonsSelect();
    loadExtras();
  }

  // ── "Otros tratamientos" añadidos a la misma cita ──
  // Se puede añadir cualquier tratamiento, tenga o no bono disponible. Si lo
  // tiene, se elige con botones (igual que el principal) sesión suelta o
  // bono antes de añadirlo; si no, se añade directo como sesión suelta.
  function renderAddonsSelect() {
    const usedIds = new Set(selectedServiceIds());
    els.addonsSelect.innerHTML = `<option value="">${t('addTreatment')}</option>`;
    Object.keys(servicesByCategory).forEach((cat) => {
      const items = servicesByCategory[cat].filter((s) => !usedIds.has(s.id));
      if (!items.length) return;
      const group = document.createElement('optgroup');
      group.label = cat;
      items.forEach((s) => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = `${s.name} — ${s.price > 0 ? s.price.toFixed(0) + ' €' : t('free')}`;
        group.appendChild(opt);
      });
      els.addonsSelect.appendChild(group);
    });
  }

  function renderAddonsChips() {
    els.addonsChips.innerHTML = '';
    state.extraServices.forEach((s) => {
      const chip = document.createElement('span');
      chip.className = 'booking-addon-chip';
      const label = document.createElement('span');
      label.textContent = s.name;
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'booking-addon-remove';
      removeBtn.setAttribute('aria-label', t('removeAddon'));
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', () => {
        state.extraServices = state.extraServices.filter((x) => x.id !== s.id);
        onAddonsChanged();
      });
      chip.appendChild(label);
      chip.appendChild(removeBtn);
      els.addonsChips.appendChild(chip);
    });
    state.extraBonos.forEach((b) => {
      const chip = document.createElement('span');
      chip.className = 'booking-addon-chip booking-addon-chip-bono';
      const label = document.createElement('span');
      label.textContent = `${b.serviceName} — ${t('bonoPackLabel')(b.sessions)}`;
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'booking-addon-remove';
      removeBtn.setAttribute('aria-label', t('removeAddon'));
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', () => {
        state.extraBonos = state.extraBonos.filter((x) => x.serviceId !== b.serviceId);
        onAddonsChanged();
      });
      chip.appendChild(label);
      chip.appendChild(removeBtn);
      els.addonsChips.appendChild(chip);
    });
  }

  function onAddonsChanged() {
    renderAddonsChips();
    renderAddonsSelect();
    renderSummary();
    if (!state.wantsBono) loadExtras();
  }

  function hideAddonsModeChooser() {
    els.addonsModeChooser.style.display = 'none';
    els.addonsModeChooser.innerHTML = '';
  }

  function showAddonsModeChooser(svc, tiers) {
    els.addonsModeChooser.style.display = 'block';
    const tierButtons = tiers.map((bono, i) => {
      const save = Math.max(0, bono.singleSessionPrice * bono.sessions - bono.bonoPrice);
      return `
        <button type="button" class="booking-bono-option booking-bono-option-pack" data-mode="bono" data-tier="${i}">
          <span class="booking-bono-option-badge">${t('bonoSaveNote')(save.toFixed(0))}</span>
          <span class="booking-bono-option-name">${t('bonoPackLabel')(bono.sessions)}</span>
          <span class="booking-bono-option-price">${bono.bonoPrice.toFixed(0)} €</span>
        </button>
      `;
    }).join('');
    els.addonsModeChooser.innerHTML = `
      <div class="booking-addons-mode-label">${svc.name}</div>
      <div class="booking-bono-options">
        <button type="button" class="booking-bono-option" data-mode="single">
          <span class="booking-bono-option-name">${t('bonoSingleLabel')}</span>
          <span class="booking-bono-option-price">${svc.price.toFixed(0)} €</span>
        </button>
        ${tierButtons}
      </div>
    `;
    els.addonsModeChooser.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.mode === 'bono') {
          state.extraBonos.push(tiers[Number(btn.dataset.tier)]);
        } else {
          state.extraServices.push(svc);
        }
        hideAddonsModeChooser();
        onAddonsChanged();
      });
    });
  }

  els.addonsSelect.addEventListener('change', () => {
    const id = els.addonsSelect.value;
    if (!id) return;
    const svc = findServiceById(id);
    const tiers = bonosById[id];
    if (svc && tiers && tiers.length) {
      showAddonsModeChooser(svc, tiers);
    } else if (svc) {
      state.extraServices.push(svc);
      onAddonsChanged();
    }
    els.addonsSelect.value = '';
  });

  // ── Extras opcionales (antes de pasar a elegir profesional) ──
  async function loadExtras() {
    els.extrasSection.style.display = 'none';
    try {
      const ids = selectedServiceIds().join(',');
      const res = await fetch(`${BOOKING_API_BASE}/extras?serviceIds=${encodeURIComponent(ids)}&lang=${LANG}`);
      const data = await res.json();
      const applicable = data.extras || [];
      // Si un extra ya no aplica (porque se quitó el tratamiento al que iba asociado), lo destildamos
      state.extras = state.extras.filter((ex) => applicable.some((d) => d.id === ex.id));
      if (!applicable.length) {
        renderSummary();
        return;
      }
      els.extras.innerHTML = '';
      applicable.forEach((ex) => {
        const label = document.createElement('label');
        label.className = 'booking-extra-option';
        const checked = state.extras.some((sel) => sel.id === ex.id);
        label.innerHTML = `
          <span class="booking-extra-option-label">
            <input type="checkbox" value="${ex.id}" ${checked ? 'checked' : ''}>
            <span>
              <span class="booking-extra-option-name">${ex.name}</span>
              <span class="booking-extra-option-meta"> · ${ex.durationMinutes} min</span>
            </span>
          </span>
          <span class="booking-extra-option-price">${ex.price > 0 ? ex.price.toFixed(0) + ' €' : t('free')}</span>
        `;
        label.querySelector('input').addEventListener('change', (e) => {
          if (e.target.checked) {
            state.extras.push(ex);
          } else {
            state.extras = state.extras.filter((sel) => sel.id !== ex.id);
          }
          renderSummary();
        });
        els.extras.appendChild(label);
      });
      els.extrasSection.style.display = 'block';
      renderSummary();
    } catch (e) {
      // Si fallan los extras, seguimos sin bloquear la reserva del tratamiento principal
      renderSummary();
    }
  }

  els.continueStep1.addEventListener('click', () => {
    loadEmployees();
    goToStep(2);
  });

  // ── PASO 2: empleadas ──
  async function loadEmployees() {
    els.employees.innerHTML = `<p class="booking-loading">${t('loading')}</p>`;
    try {
      const ids = selectedServiceIds().join(',');
      const res = await fetch(`${BOOKING_API_BASE}/employees?serviceIds=${encodeURIComponent(ids)}`);
      const data = await res.json();
      els.employees.innerHTML = '';
      data.employees.forEach((emp) => {
        const card = document.createElement('div');
        card.className = 'booking-employee-card';
        card.textContent = emp.name;
        card.addEventListener('click', () => {
          state.employee = emp;
          document.querySelectorAll('#booking-employees .booking-employee-card').forEach((c) => c.classList.remove('selected'));
          card.classList.add('selected');
          renderSummary();
          setupCalendar();
          goToStep(3);
        });
        els.employees.appendChild(card);
      });
      if (!data.employees.length) {
        els.employees.innerHTML = `<p>${t('noEmployees')}</p>`;
      }
    } catch (e) {
      showError(t('loadEmployeesError'));
    }
  }

  // ── PASO 3: calendario y hora ──
  const MIN_DATE = new Date();
  MIN_DATE.setHours(0, 0, 0, 0);
  const MAX_DATE = new Date(MIN_DATE.getTime() + 45 * 86400000);
  const calendarState = { year: MIN_DATE.getFullYear(), month: MIN_DATE.getMonth() };

  function toISODate(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function isSameDate(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function setupCalendar() {
    calendarState.year = MIN_DATE.getFullYear();
    calendarState.month = MIN_DATE.getMonth();
    state.date = null;
    state.time = null;
    els.slots.innerHTML = '';
    renderCalendar();
  }

  function renderCalendar() {
    const { year, month } = calendarState;
    const first = new Date(year, month, 1);
    const startWeekday = (first.getDay() + 6) % 7; // lunes = 0
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthLabel = first.toLocaleDateString(DATE_LOCALE, { month: 'long', year: 'numeric' });
    els.calMonthLabel.textContent = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);

    els.calGrid.innerHTML = '';
    for (let i = 0; i < startWeekday; i++) {
      const empty = document.createElement('div');
      empty.className = 'booking-cal-cell empty';
      els.calGrid.appendChild(empty);
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(year, month, d);
      dateObj.setHours(0, 0, 0, 0);
      const iso = toISODate(dateObj);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'booking-cal-cell';
      cell.textContent = String(d);
      const empWeekly = state.employee && state.employee.weekly;
      const daySchedule = empWeekly && empWeekly[dateObj.getDay()];
      const dayOff = empWeekly && (!daySchedule || daySchedule.closed);
      const closures = (state.employee && state.employee.closures) || [];
      const isClosureDay = closures.some((c) => iso >= c.start && iso <= c.end);
      const disabled = dateObj < MIN_DATE || dateObj > MAX_DATE || dayOff || isClosureDay;
      if (disabled) {
        cell.classList.add('disabled');
        cell.disabled = true;
      }
      if (isSameDate(dateObj, new Date())) cell.classList.add('today');
      if (state.date === iso) cell.classList.add('selected');
      if (!disabled) {
        cell.addEventListener('click', () => {
          state.date = iso;
          state.time = null;
          document.querySelectorAll('.booking-cal-cell.selected').forEach((c) => c.classList.remove('selected'));
          cell.classList.add('selected');
          loadSlotsForDate(iso);
        });
      }
      els.calGrid.appendChild(cell);
    }

    els.calPrev.disabled = year === MIN_DATE.getFullYear() && month === MIN_DATE.getMonth();
    els.calNext.disabled = year === MAX_DATE.getFullYear() && month === MAX_DATE.getMonth();
  }

  els.calPrev.addEventListener('click', () => {
    calendarState.month--;
    if (calendarState.month < 0) {
      calendarState.month = 11;
      calendarState.year--;
    }
    renderCalendar();
  });
  els.calNext.addEventListener('click', () => {
    calendarState.month++;
    if (calendarState.month > 11) {
      calendarState.month = 0;
      calendarState.year++;
    }
    renderCalendar();
  });

  async function loadSlotsForDate(dateStr) {
    els.slots.innerHTML = `<p class="booking-slot-message">${t('searchingSlots')}</p>`;
    try {
      const params = new URLSearchParams({
        serviceId: state.service.id,
        employeeId: state.employee.id,
        date: dateStr,
        extraIds: state.extras.map((e) => e.id).join(','),
        extraServiceIds: state.extraServices.map((s) => s.id).join(','),
      });
      const res = await fetch(`${BOOKING_API_BASE}/availability?${params}`);
      if (!res.ok) throw new Error('availability request failed');
      const data = await res.json();
      els.slots.innerHTML = '';
      if (!data.slots || !data.slots.length) {
        els.slots.innerHTML = `<p class="booking-slot-message">${t('noSlots')}</p>`;
        return;
      }
      data.slots.forEach((time) => {
        const slot = document.createElement('div');
        slot.className = 'booking-slot';
        slot.textContent = time;
        slot.addEventListener('click', () => {
          state.time = time;
          document.querySelectorAll('.booking-slot').forEach((s) => s.classList.remove('selected'));
          slot.classList.add('selected');
          renderSummary();
          renderPayOptions();
          goToStep(4);
        });
        els.slots.appendChild(slot);
      });
    } catch (e) {
      els.slots.innerHTML = '';
      showError(t('availabilityError'));
    }
  }

  // ── PASO 4: pago y envío ──
  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function renderPayOptions() {
    const { service } = state;
    const price = totalPrice();
    els.payOptions.innerHTML = '';
    const termsHtml = `
      <label class="booking-pay-option booking-bono-terms">
        <input type="checkbox" id="booking-terms-check">
        <span>${t('termsLabel')}</span>
      </label>
    `;

    // El bloque de pago "bono" (con nota informativa + checkbox de términos)
    // debe salir siempre que haya ALGÚN bono en el carrito, sea el principal
    // o uno añadido como extra — no solo cuando el tratamiento principal es
    // el bono. Si no, un bono comprado solo como "extra" nunca mostraría el
    // checkbox de condiciones y se compraría sin que la clienta lo aceptase.
    if ((state.wantsBono && state.bono) || state.extraBonos.length > 0) {
      const depositAmount = round2((price * (service.depositPercent || 30)) / 100);
      state.payChoice = 'deposit';
      els.payOptions.innerHTML = `
        <label class="booking-pay-option">
          <input type="radio" name="pay" value="deposit" checked>
          <span>${t('payDepositOnly')} <strong>${depositAmount.toFixed(2)} €</strong> ${t('restAtCenterParen')}</span>
        </label>
        <label class="booking-pay-option">
          <input type="radio" name="pay" value="full">
          <span>${t('payFullNow')} <strong>${price.toFixed(2)} €</strong></span>
        </label>
        <p class="booking-pay-note">${t('bonoFullNote')}</p>
        <label class="booking-pay-option booking-bono-terms">
          <input type="checkbox" id="booking-bono-terms-check">
          <span>${t('bonoTermsLabel')}</span>
        </label>
      `;
      els.payOptions.querySelectorAll('input[name="pay"]').forEach((r) => {
        r.addEventListener('change', () => { state.payChoice = r.value; });
      });
      // OJO: nunca usar "innerHTML +=" aquí — recrea todos los nodos hijos
      // (incluidos los radios ya con su listener) dejando la elección de
      // pago sin efecto. insertAdjacentHTML solo añade, no destruye nada.
      els.payOptions.insertAdjacentHTML('beforeend', `<p class="booking-pay-note booking-cancel-note">${t('cancelPolicyNote')}</p>`);
      els.payOptions.insertAdjacentHTML('beforeend', termsHtml);
      return;
    }

    const depositAmount = round2((price * (service.depositPercent || 0)) / 100);

    if (service.paymentPolicy === 'full_required') {
      els.payOptions.innerHTML = `<p class="booking-pay-note">${t('fullRequired')} <strong>${price.toFixed(2)} €</strong></p>`;
      state.payChoice = 'full';
    } else if (service.paymentPolicy === 'deposit_required') {
      els.payOptions.innerHTML = `<p class="booking-pay-note">${t('depositRequired')} <strong>${depositAmount.toFixed(2)} €</strong> (${t('restAtCenter')} ${(price - depositAmount).toFixed(2)} € ${t('atCenter')}).</p>`;
      state.payChoice = 'deposit';
    } else {
      state.payChoice = 'deposit';
      els.payOptions.innerHTML = `
        <label class="booking-pay-option">
          <input type="radio" name="pay" value="deposit" checked>
          <span>${t('payDepositOnly')} <strong>${depositAmount.toFixed(2)} €</strong> ${t('restAtCenterParen')}</span>
        </label>
        <label class="booking-pay-option">
          <input type="radio" name="pay" value="full">
          <span>${t('payFullNow')} <strong>${price.toFixed(2)} €</strong></span>
        </label>
      `;
      els.payOptions.querySelectorAll('input[name="pay"]').forEach((r) => {
        r.addEventListener('change', () => { state.payChoice = r.value; });
      });
    }
    // Igual que arriba: insertAdjacentHTML, nunca "innerHTML +=".
    els.payOptions.insertAdjacentHTML('beforeend', `<p class="booking-pay-note booking-cancel-note">${t('cancelPolicyNote')}</p>`);
    els.payOptions.insertAdjacentHTML('beforeend', termsHtml);
  }

  els.submit.addEventListener('click', async () => {
    clearError();
    const name = document.getElementById('booking-name').value.trim();
    const phone = document.getElementById('booking-phone').value.trim();
    const email = document.getElementById('booking-email').value.trim();
    const birthdate = document.getElementById('booking-birthdate').value.trim();

    if (!name || !phone || !email) {
      showError(t('fillNamePhone'));
      return;
    }
    if (!state.service || !state.employee || !state.date || !state.time) {
      showError(t('missingBookingData'));
      return;
    }
    if (state.wantsBono || state.extraBonos.length > 0) {
      const bonoTermsCheck = document.getElementById('booking-bono-terms-check');
      if (!bonoTermsCheck || !bonoTermsCheck.checked) {
        showError(t('bonoTermsRequired'));
        return;
      }
    }
    const termsCheck = document.getElementById('booking-terms-check');
    if (!termsCheck || !termsCheck.checked) {
      showError(t('termsRequired'));
      return;
    }

    els.submit.disabled = true;
    els.submit.textContent = t('connectingPayment');

    // Si hay algún bono de por medio (el principal o algún tratamiento
    // añadido), se usa bono-checkout, que soporta cualquier mezcla de
    // sesiones sueltas y bonos. Si no hay ningún bono, sigue el checkout
    // normal de toda la vida.
    const hasAnyBono = state.wantsBono || state.extraBonos.length > 0;
    const endpoint = hasAnyBono ? 'bono-checkout' : 'checkout';
    const body = hasAnyBono
      ? {
          serviceId: state.service.id,
          wantsBonoPrimary: state.wantsBono,
          primaryBonoSessions: state.wantsBono && state.bono ? state.bono.sessions : undefined,
          extraServiceIds: state.extraServices.map((s) => s.id),
          extraBonoSelections: state.extraBonos.map((b) => ({ serviceId: b.serviceId, sessions: b.sessions })),
          employeeId: state.employee.id,
          date: state.date,
          time: state.time,
          clientName: name,
          clientPhone: phone,
          clientEmail: email || undefined,
          clientBirthdate: birthdate || undefined,
          paymentChoice: state.payChoice,
          termsAccepted: true,
          lang: LANG,
        }
      : {
          serviceId: state.service.id,
          employeeId: state.employee.id,
          extraIds: state.extras.map((e) => e.id),
          extraServiceIds: state.extraServices.map((s) => s.id),
          date: state.date,
          time: state.time,
          clientName: name,
          clientPhone: phone,
          clientEmail: email || undefined,
          clientBirthdate: birthdate || undefined,
          paymentChoice: state.payChoice,
          discountCode: discountIsStillValid() ? state.discountCode : undefined,
          termsAccepted: true,
          lang: LANG,
        };

    try {
      const res = await fetch(`${BOOKING_API_BASE}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('checkoutError'));
      window.location.href = data.url;
    } catch (e) {
      showError(e.message);
      els.submit.disabled = false;
      els.submit.textContent = t('goToPayment');
    }
  });

  // Mensaje si venimos de vuelta de Stripe
  const params = new URLSearchParams(window.location.search);
  if (params.get('estado') === 'ok') {
    document.querySelector('.booking-shell').innerHTML = `
      <div class="booking-confirm">
        <h2>${t('confirmedTitle')}</h2>
        <p>${t('confirmedText')}</p>
        <a href="index.html" class="btn-primary">${t('backHome')}</a>
      </div>`;
  } else if (params.get('estado') === 'cancelado') {
    showError(t('cancelledPayment'));
    loadServices();
    loadBonos();
  } else {
    loadServices();
    loadBonos();
  }
})();
