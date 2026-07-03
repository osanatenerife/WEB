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
    steps: document.querySelectorAll('.booking-step-dot'),
    panels: document.querySelectorAll('.booking-step-panel'),
    services: document.getElementById('booking-services'),
    employees: document.getElementById('booking-employees'),
    date: document.getElementById('booking-date'),
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

  const sidebarToggle = document.getElementById('booking-sidebar-toggle');
  const sidebar = document.getElementById('booking-sidebar');
  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener('click', () => {
      const collapsed = sidebar.classList.toggle('collapsed');
      sidebarToggle.querySelector('span').textContent = collapsed ? 'Expandir' : 'Contraer menú';
    });
  }

  // ── PASO 1: cargar servicios ──
  async function loadServices() {
    try {
      const res = await fetch(`${BOOKING_API_BASE}/services`);
      const data = await res.json();
      const byCategory = {};
      data.services.forEach((s) => {
        byCategory[s.category] = byCategory[s.category] || [];
        byCategory[s.category].push(s);
      });
      els.services.innerHTML = '';
      Object.entries(byCategory).forEach(([category, items]) => {
        const catTitle = document.createElement('div');
        catTitle.className = 'booking-category';
        catTitle.textContent = category;
        els.services.appendChild(catTitle);
        items.forEach((s) => {
          const opt = document.createElement('div');
          opt.className = 'booking-option';
          opt.dataset.id = s.id;
          opt.innerHTML = `
            <span>
              <strong>${s.name}</strong>
              <span class="booking-option-meta">${s.durationMinutes} min</span>
            </span>
            <span class="booking-option-price">${s.price > 0 ? s.price.toFixed(0) + ' €' : 'Gratis'}</span>
          `;
          opt.addEventListener('click', () => selectService(s, opt));
          els.services.appendChild(opt);
        });
      });
    } catch (e) {
      showError('No se pudieron cargar los tratamientos. Comprueba tu conexión e inténtalo de nuevo.');
    }
  }

  function selectService(service, optEl) {
    state.service = service;
    document.querySelectorAll('#booking-services .booking-option').forEach((o) => o.classList.remove('selected'));
    optEl.classList.add('selected');
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
        const opt = document.createElement('div');
        opt.className = 'booking-option';
        opt.innerHTML = `<span><strong>${emp.name}</strong></span><span>›</span>`;
        opt.addEventListener('click', () => {
          state.employee = emp;
          document.querySelectorAll('#booking-employees .booking-option').forEach((o) => o.classList.remove('selected'));
          opt.classList.add('selected');
          setupDatePicker();
          goToStep(3);
        });
        els.employees.appendChild(opt);
      });
      if (!data.employees.length) {
        els.employees.innerHTML = '<p>No hay profesionales disponibles para este tratamiento. Escríbenos por WhatsApp.</p>';
      }
    } catch (e) {
      showError('No se pudieron cargar las profesionales.');
    }
  }

  // ── PASO 3: fecha y hora ──
  function setupDatePicker() {
    const today = new Date();
    const min = today.toISOString().slice(0, 10);
    const max = new Date(today.getTime() + 45 * 86400000).toISOString().slice(0, 10);
    els.date.min = min;
    els.date.max = max;
    els.date.value = '';
    els.slots.innerHTML = '';
  }

  els.date.addEventListener('change', async () => {
    state.date = els.date.value;
    state.time = null;
    if (!state.date) return;
    els.slots.innerHTML = '<p class="booking-slot-message">Buscando huecos libres…</p>';
    try {
      const params = new URLSearchParams({ serviceId: state.service.id, employeeId: state.employee.id, date: state.date });
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
          renderSummaryAndPayOptions();
          goToStep(4);
        });
        els.slots.appendChild(slot);
      });
    } catch (e) {
      els.slots.innerHTML = '';
      showError('No se pudo consultar la disponibilidad.');
    }
  });

  // ── PASO 4: resumen, pago y envío ──
  function renderSummaryAndPayOptions() {
    const { service, employee, date, time } = state;
    const dateLabel = new Date(`${date}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
    els.summary.innerHTML = `
      <strong>${service.name}</strong><br>
      Con ${employee.name} · ${dateLabel} a las ${time}<br>
      Duración aproximada: ${service.durationMinutes} min
    `;

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

  function round2(n) { return Math.round(n * 100) / 100; }

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
    document.querySelector('.booking-app').innerHTML = `
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
