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
    fillNamePhone: { es: 'Rellena tu nombre y teléfono para continuar.', en: 'Fill in your name and phone number to continue.' },
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
    bonoTitle: { es: 'Ahorra', en: 'Save' },
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
  };
  function t(key) { return (STR[key] && STR[key][LANG]) || (STR[key] && STR[key].es) || key; }

  const state = {
    service: null,
    extras: [],
    extraServices: [], // otros tratamientos añadidos a la misma cita
    employee: null,
    date: null,
    time: null,
    payChoice: 'deposit', // 'deposit' | 'full'
    wantsBono: false, // true si eligió el bono de varias sesiones en vez de una suelta
    bono: null, // { serviceId, serviceName, sessions, bonoPrice, singleSessionPrice }
  };

  function extrasDuration() { return state.extras.reduce((sum, e) => sum + e.durationMinutes, 0); }
  function extrasPrice() { return state.extras.reduce((sum, e) => sum + e.price, 0); }
  function addonsDuration() { return state.extraServices.reduce((sum, s) => sum + s.durationMinutes, 0); }
  function addonsPrice() { return state.extraServices.reduce((sum, s) => sum + s.price, 0); }
  function totalDuration() { return (state.service ? state.service.durationMinutes : 0) + extrasDuration() + addonsDuration(); }
  function totalPrice() {
    if (state.wantsBono && state.bono) return state.bono.bonoPrice;
    return (state.service ? state.service.price : 0) + extrasPrice() + addonsPrice();
  }
  function selectedServiceIds() { return [state.service.id, ...state.extraServices.map((s) => s.id)]; }
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
    const { service, extras, extraServices, employee, date, time } = state;
    if (!service) {
      els.summary.innerHTML = `<p class="booking-summary-empty">${t('chooseToStart')}</p>`;
      return;
    }
    let html;
    if (state.wantsBono && state.bono) {
      html = `<div class="booking-summary-row"><strong>${t('bonoPackLabel')(state.bono.sessions)} — ${service.name}</strong><span>${state.bono.bonoPrice.toFixed(0)} €</span></div>`;
      html += `<div class="booking-summary-meta">${service.durationMinutes} min · ${t('bonoSessionNote')(state.bono.sessions)}</div>`;
      els.summary.innerHTML = html + (employee ? `<div class="booking-summary-line">${t('withEmployee')} <strong>${employee.name}</strong></div>` : '') + (date && time ? `<div class="booking-summary-line">${new Date(`${date}T12:00:00`).toLocaleDateString(DATE_LOCALE, { weekday: 'long', day: 'numeric', month: 'long' })} ${t('at')} ${time}</div>` : '');
      return;
    }
    html = `<div class="booking-summary-row"><strong>${service.name}</strong><span>${service.price > 0 ? service.price.toFixed(0) + ' €' : t('free')}</span></div>`;
    html += `<div class="booking-summary-meta">${service.durationMinutes} min</div>`;
    extraServices.forEach((s) => {
      html += `<div class="booking-summary-row" style="margin-top:6px;"><span>+ ${s.name}</span><span>${s.price > 0 ? s.price.toFixed(0) + ' €' : t('free')}</span></div>`;
    });
    extras.forEach((ex) => {
      html += `<div class="booking-summary-row" style="margin-top:6px;"><span>+ ${ex.name}</span><span>${ex.price > 0 ? ex.price.toFixed(0) + ' €' : t('free')}</span></div>`;
    });
    if (extras.length || extraServices.length) {
      html += `<div class="booking-summary-meta">${t('totalDuration')}: ${totalDuration()} min · <strong>${totalPrice().toFixed(0)} €</strong></div>`;
    }
    if (employee) {
      html += `<div class="booking-summary-line">${t('withEmployee')} <strong>${employee.name}</strong></div>`;
    }
    if (date && time) {
      const dateLabel = new Date(`${date}T12:00:00`).toLocaleDateString(DATE_LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });
      html += `<div class="booking-summary-line">${dateLabel} ${t('at')} ${time}</div>`;
    }
    els.summary.innerHTML = html;
  }

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
      (data.bonos || []).forEach((b) => { bonosById[b.serviceId] = b; });
    } catch (e) {
      bonosById = {}; // si falla, simplemente no se ofrece bono — no bloquea la reserva normal
    }
  }

  function renderBonoSection() {
    const bono = state.service ? bonosById[state.service.id] : null;
    if (!bono) {
      els.bonoSection.style.display = 'none';
      els.bonoSection.innerHTML = '';
      state.wantsBono = false;
      state.bono = null;
      return;
    }
    state.bono = bono;
    const save = Math.max(0, bono.singleSessionPrice * bono.sessions - bono.bonoPrice);
    els.bonoSection.style.display = 'block';
    els.bonoSection.innerHTML = `
      <div class="booking-bono-title">✦ ${t('bonoTitle')}</div>
      <div class="booking-bono-options">
        <button type="button" class="booking-bono-option${!state.wantsBono ? ' selected' : ''}" data-bono="0">
          <span class="booking-bono-option-name">${t('bonoSingleLabel')}</span>
          <span class="booking-bono-option-price">${bono.singleSessionPrice.toFixed(0)} €</span>
        </button>
        <button type="button" class="booking-bono-option booking-bono-option-pack${state.wantsBono ? ' selected' : ''}" data-bono="1">
          <span class="booking-bono-option-badge">${t('bonoSaveNote')(save.toFixed(0))}</span>
          <span class="booking-bono-option-name">${t('bonoPackLabel')(bono.sessions)}</span>
          <span class="booking-bono-option-price">${bono.bonoPrice.toFixed(0)} €</span>
        </button>
      </div>
      <p class="booking-bono-note">${t('bonoSessionNote')(bono.sessions)}</p>
    `;
    els.bonoSection.querySelectorAll('.booking-bono-option').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.wantsBono = btn.dataset.bono === '1';
        els.bonoSection.querySelectorAll('.booking-bono-option').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        // Un bono es de un solo tratamiento — no tiene sentido combinarlo con extras/otros tratamientos
        els.addonsSection.style.display = state.wantsBono ? 'none' : 'block';
        if (state.wantsBono) {
          state.extras = [];
          state.extraServices = [];
          els.extrasSection.style.display = 'none';
        } else {
          renderAddonsChips();
          renderAddonsSelect();
          loadExtras();
        }
        renderSummary();
      });
    });
  }

  function selectService(service, cardEl) {
    state.service = service;
    state.extras = [];
    state.extraServices = [];
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
  }

  function onAddonsChanged() {
    renderAddonsChips();
    renderAddonsSelect();
    renderSummary();
    loadExtras();
  }

  els.addonsSelect.addEventListener('change', () => {
    const id = els.addonsSelect.value;
    if (!id) return;
    const svc = findServiceById(id);
    if (svc) {
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

    if (state.wantsBono && state.bono) {
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
      els.payOptions.innerHTML += `<p class="booking-pay-note booking-cancel-note">${t('cancelPolicyNote')}</p>`;
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
    els.payOptions.innerHTML += `<p class="booking-pay-note booking-cancel-note">${t('cancelPolicyNote')}</p>`;
  }

  els.submit.addEventListener('click', async () => {
    clearError();
    const name = document.getElementById('booking-name').value.trim();
    const phone = document.getElementById('booking-phone').value.trim();
    const email = document.getElementById('booking-email').value.trim();
    const birthdate = document.getElementById('booking-birthdate').value.trim();

    if (!name || !phone) {
      showError(t('fillNamePhone'));
      return;
    }
    if (!state.service || !state.employee || !state.date || !state.time) {
      showError(t('missingBookingData'));
      return;
    }
    if (state.wantsBono) {
      const termsCheck = document.getElementById('booking-bono-terms-check');
      if (!termsCheck || !termsCheck.checked) {
        showError(t('bonoTermsRequired'));
        return;
      }
    }

    els.submit.disabled = true;
    els.submit.textContent = t('connectingPayment');

    const endpoint = state.wantsBono ? 'bono-checkout' : 'checkout';
    const body = state.wantsBono
      ? {
          serviceId: state.service.id,
          employeeId: state.employee.id,
          date: state.date,
          time: state.time,
          clientName: name,
          clientPhone: phone,
          clientEmail: email || undefined,
          clientBirthdate: birthdate || undefined,
          paymentChoice: state.payChoice,
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
