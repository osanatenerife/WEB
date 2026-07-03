// ============================================================
// OSANA — Lógica del flujo de reserva (reserva.html)
// ============================================================
(function () {
  const state = {
    service: null,
    employee: null,
    date: null,
    time: null,
    payChoice: 'deposit', // 'deposit' | 'full'
  };

  const els = {
    shell: document.getElementById('booking-shell'),
    steps: document.querySelectorAll('.booking-progress-step'),
    panels: document.querySelectorAll('.booking-step-panel'),
    catPills: document.getElementById('booking-cat-pills'),
    services: document.getElementById('booking-services'),
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
    const { service, employee, date, time } = state;
    if (!service) {
      els.summary.innerHTML = '<p class="booking-summary-empty">Elige un tratamiento para empezar.</p>';
      return;
    }
    let html = `<div class="booking-summary-row"><strong>${service.name}</strong><span>${service.price > 0 ? service.price.toFixed(0) + ' €' : 'Gratis'}</span></div>`;
    html += `<div class="booking-summary-meta">${service.durationMinutes} min</div>`;
    if (employee) {
      html += `<div class="booking-summary-line">Con <strong>${employee.name}</strong></div>`;
    }
    if (date && time) {
      const dateLabel = new Date(`${date}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
      html += `<div class="booking-summary-line">${dateLabel} a las ${time}</div>`;
    }
    els.summary.innerHTML = html;
  }

  // ── PASO 1: cargar servicios ──
  let servicesByCategory = {};
  let activeCategory = null;

  async function loadServices() {
    try {
      const res = await fetch(`${BOOKING_API_BASE}/services`);
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
      showError('No se pudieron cargar los tratamientos. Comprueba tu conexión e inténtalo de nuevo.');
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
        <span class="booking-service-price">${s.price > 0 ? s.price.toFixed(0) + ' €' : 'Gratis'}</span>
      `;
      card.addEventListener('click', () => selectService(s, card));
      els.services.appendChild(card);
    });
  }

  function selectService(service, cardEl) {
    state.service = service;
    document.querySelectorAll('#booking-services .booking-service-card').forEach((c) => c.classList.remove('selected'));
    cardEl.classList.add('selected');
    renderSummary();
    loadEmployees();
    goToStep(2);
  }

  // ── PASO 2: empleadas ──
  async function loadEmployees() {
    els.employees.innerHTML = '<p class="booking-loading">Cargando…</p>';
    try {
      const res = await fetch(`${BOOKING_API_BASE}/employees?serviceId=${encodeURIComponent(state.service.id)}`);
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
        els.employees.innerHTML = '<p>No hay profesionales disponibles para este tratamiento. Escríbenos por WhatsApp.</p>';
      }
    } catch (e) {
      showError('No se pudieron cargar las profesionales.');
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
    const monthLabel = first.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
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
      const disabled = dateObj < MIN_DATE || dateObj > MAX_DATE;
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
    els.slots.innerHTML = '<p class="booking-slot-message">Buscando huecos libres…</p>';
    try {
      const params = new URLSearchParams({ serviceId: state.service.id, employeeId: state.employee.id, date: dateStr });
      const res = await fetch(`${BOOKING_API_BASE}/availability?${params}`);
      if (!res.ok) throw new Error('availability request failed');
      const data = await res.json();
      els.slots.innerHTML = '';
      if (!data.slots || !data.slots.length) {
        els.slots.innerHTML = '<p class="booking-slot-message">No quedan huecos libres ese día. Prueba con otra fecha.</p>';
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
      showError('No se pudo consultar la disponibilidad.');
    }
  }

  // ── PASO 4: pago y envío ──
  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function renderPayOptions() {
    const { service } = state;
    const depositAmount = round2((service.price * (service.depositPercent || 0)) / 100);
    els.payOptions.innerHTML = '';

    if (service.paymentPolicy === 'full_required') {
      els.payOptions.innerHTML = `<p class="booking-pay-note">Este tratamiento requiere el pago completo online: <strong>${service.price.toFixed(2)} €</strong></p>`;
      state.payChoice = 'full';
    } else if (service.paymentPolicy === 'deposit_required') {
      els.payOptions.innerHTML = `<p class="booking-pay-note">Este tratamiento requiere una seña obligatoria de <strong>${depositAmount.toFixed(2)} €</strong> (resto de ${(service.price - depositAmount).toFixed(2)} € en el centro).</p>`;
      state.payChoice = 'deposit';
    } else {
      state.payChoice = 'deposit';
      els.payOptions.innerHTML = `
        <label class="booking-pay-option">
          <input type="radio" name="pay" value="deposit" checked>
          <span>Pagar solo la seña — <strong>${depositAmount.toFixed(2)} €</strong> (resto en el centro)</span>
        </label>
        <label class="booking-pay-option">
          <input type="radio" name="pay" value="full">
          <span>Pagar el total ahora — <strong>${service.price.toFixed(2)} €</strong></span>
        </label>
      `;
      els.payOptions.querySelectorAll('input[name="pay"]').forEach((r) => {
        r.addEventListener('change', () => { state.payChoice = r.value; });
      });
    }
  }

  els.submit.addEventListener('click', async () => {
    clearError();
    const name = document.getElementById('booking-name').value.trim();
    const phone = document.getElementById('booking-phone').value.trim();
    const email = document.getElementById('booking-email').value.trim();

    if (!name || !phone) {
      showError('Rellena tu nombre y teléfono para continuar.');
      return;
    }
    if (!state.service || !state.employee || !state.date || !state.time) {
      showError('Faltan datos de la reserva, vuelve a empezar.');
      return;
    }

    els.submit.disabled = true;
    els.submit.textContent = 'Conectando con el pago seguro…';

    try {
      const res = await fetch(`${BOOKING_API_BASE}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId: state.service.id,
          employeeId: state.employee.id,
          date: state.date,
          time: state.time,
          clientName: name,
          clientPhone: phone,
          clientEmail: email || undefined,
          paymentChoice: state.payChoice,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo iniciar el pago.');
      window.location.href = data.url;
    } catch (e) {
      showError(e.message);
      els.submit.disabled = false;
      els.submit.textContent = 'Ir al pago seguro';
    }
  });

  // Mensaje si venimos de vuelta de Stripe
  const params = new URLSearchParams(window.location.search);
  if (params.get('estado') === 'ok') {
    document.querySelector('.booking-shell').innerHTML = `
      <div class="booking-confirm">
        <h2>¡Reserva confirmada! ✓</h2>
        <p>Te hemos enviado la confirmación. Si tienes cualquier duda, escríbenos por WhatsApp.</p>
        <a href="index.html" class="btn-primary">Volver al inicio</a>
      </div>`;
  } else if (params.get('estado') === 'cancelado') {
    showError('Has cancelado el pago. Puedes intentarlo de nuevo cuando quieras.');
    loadServices();
  } else {
    loadServices();
  }
})();
