// ============================================================
// OSANA — Panel interno (búsqueda de clienta, historial, bonos,
// notas, reprogramar y marcar ausencias). Solo para el equipo.
// ============================================================
(function () {
  const KEY_STORAGE = 'osana_panel_key';
  let panelKey = localStorage.getItem(KEY_STORAGE) || '';

  const els = {
    login: document.getElementById('panel-login'),
    keyInput: document.getElementById('panel-key-input'),
    keySubmit: document.getElementById('panel-key-submit'),
    keyError: document.getElementById('panel-key-error'),
    app: document.getElementById('panel-app'),
    logout: document.getElementById('panel-logout'),
    searchInput: document.getElementById('panel-search-input'),
    searchBtn: document.getElementById('panel-search-btn'),
    searchError: document.getElementById('panel-search-error'),
    searchStatus: document.getElementById('panel-search-status'),
    results: document.getElementById('panel-results'),
    saleToggle: document.getElementById('panel-sale-toggle'),
    saleSlot: document.getElementById('panel-sale-slot'),
  };

  function showLogin(errorMsg) {
    els.login.style.display = 'flex';
    els.app.style.display = 'none';
    if (errorMsg) {
      els.keyError.textContent = errorMsg;
      els.keyError.style.display = 'block';
    }
  }
  function showApp() {
    els.login.style.display = 'none';
    els.app.style.display = 'block';
  }

  async function panelFetch(path, options) {
    const res = await fetch(`${BOOKING_API_BASE}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'x-panel-key': panelKey, ...(options && options.headers) },
    });
    if (res.status === 401) {
      localStorage.removeItem(KEY_STORAGE);
      panelKey = '';
      showLogin('Clave incorrecta.');
      throw new Error('unauthorized');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error de conexión.');
    return data;
  }

  els.keySubmit.addEventListener('click', () => {
    const val = els.keyInput.value.trim();
    if (!val) return;
    panelKey = val;
    localStorage.setItem(KEY_STORAGE, val);
    els.keyError.style.display = 'none';
    showApp();
  });
  els.keyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') els.keySubmit.click(); });

  els.logout.addEventListener('click', () => {
    localStorage.removeItem(KEY_STORAGE);
    panelKey = '';
    els.results.innerHTML = '';
    showLogin();
  });

  if (panelKey) showApp(); else showLogin();

  // ── Búsqueda ──
  async function doSearch() {
    const q = els.searchInput.value.trim();
    els.searchError.style.display = 'none';
    els.searchStatus.style.display = 'none';
    els.results.innerHTML = '';
    if (!q) return;
    els.searchStatus.textContent = 'Buscando…';
    els.searchStatus.style.display = 'block';
    try {
      const data = await panelFetch(`/panel/search?q=${encodeURIComponent(q)}`);
      els.searchStatus.style.display = 'none';
      if (!data.clients || !data.clients.length) {
        els.searchStatus.textContent = 'No se han encontrado citas con esos datos.';
        els.searchStatus.style.display = 'block';
        return;
      }
      data.clients.forEach(renderClient);
    } catch (e) {
      if (e.message === 'unauthorized') return;
      els.searchStatus.style.display = 'none';
      els.searchError.textContent = e.message;
      els.searchError.style.display = 'block';
    }
  }
  els.searchBtn.addEventListener('click', doSearch);
  els.searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

  // ── Venta de producto suelta (no ligada a ninguna cita) ──
  els.saleToggle.addEventListener('click', () => {
    if (els.saleSlot.innerHTML) { els.saleSlot.innerHTML = ''; return; }
    const today = new Date().toISOString().slice(0, 10);
    els.saleSlot.innerHTML = `
      <div class="panel-new-appt">
        <div class="panel-label">Registrar venta de producto</div>
        <div class="panel-field-row">
          <div class="panel-field"><label>Fecha</label><input type="date" class="ps-date" value="${today}"></div>
          <div class="panel-field"><label>Producto</label><input type="text" class="ps-product" placeholder="Ej. Crema hidratante"></div>
        </div>
        <div class="panel-field-row">
          <div class="panel-field"><label>Importe (€)</label><input type="number" step="0.01" class="ps-amount"></div>
          <div class="panel-field"><label>Pagado con</label>
            <select class="ps-paidhow">
              <option value="efectivo">Efectivo</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="bizum">Bizum</option>
            </select>
          </div>
        </div>
        <button type="button" class="panel-btn panel-btn-primary panel-confirm-sale">Guardar venta</button>
        <p class="panel-error" style="display:none;"></p>
      </div>
    `;
    const slot = els.saleSlot;
    const dateInput = slot.querySelector('.ps-date');
    const productInput = slot.querySelector('.ps-product');
    const amountInput = slot.querySelector('.ps-amount');
    const paidHowSelect = slot.querySelector('.ps-paidhow');
    const errorEl = slot.querySelector('.panel-error');
    slot.querySelector('.panel-confirm-sale').addEventListener('click', async (ev) => {
      errorEl.style.display = 'none';
      if (!productInput.value.trim() || !amountInput.value) {
        errorEl.textContent = 'Indica el producto y el importe.';
        errorEl.style.display = 'block';
        return;
      }
      ev.target.disabled = true;
      try {
        await panelFetch('/panel/product-sale', {
          method: 'POST',
          body: JSON.stringify({
            date: dateInput.value, product: productInput.value.trim(),
            amount: amountInput.value, paidHow: paidHowSelect.value,
          }),
        });
        slot.innerHTML = '<p class="panel-status">Venta registrada ✓</p>';
      } catch (e) {
        errorEl.textContent = e.message;
        errorEl.style.display = 'block';
        ev.target.disabled = false;
      }
    });
  });

  function fmtDateParts(dateStr) {
    const d = new Date(`${dateStr}T12:00:00`);
    const day = d.toLocaleDateString('es-ES', { day: '2-digit' });
    const month = d.toLocaleDateString('es-ES', { month: 'short' }).toUpperCase().replace('.', '');
    return { day, month };
  }

  function renderClient(client) {
    const wrap = document.createElement('div');

    const strikeBadge = client.strikeCount > 0
      ? `<span class="panel-pill panel-pill-warn"><span class="dot"></span>${client.strikeCount} falta${client.strikeCount > 1 ? 's' : ''} registrada${client.strikeCount > 1 ? 's' : ''}</span>`
      : `<span class="panel-pill panel-pill-ok"><span class="dot"></span>Sin faltas</span>`;

    wrap.innerHTML = `
      <div class="panel-client-card">
        <div class="panel-client-top">
          <div>
            <div class="panel-client-name">${client.name || '(sin nombre)'}</div>
            <div class="panel-client-meta"><span>${client.phone || ''}</span><span>${client.email || ''}</span></div>
          </div>
          ${strikeBadge}
        </div>
      </div>
      ${client.bonos.length ? '<div class="panel-section-label">Bonos activos</div>' : ''}
      <div class="panel-bonos"></div>
      <div class="panel-section-label">Todas las citas</div>
      <div class="panel-appts"></div>
    `;

    const bonosContainer = wrap.querySelector('.panel-bonos');
    client.bonos.forEach((bono) => bonosContainer.appendChild(renderBono(bono, client)));

    const apptsContainer = wrap.querySelector('.panel-appts');
    client.bookings.forEach((b) => apptsContainer.appendChild(renderAppt(b)));

    els.results.appendChild(wrap);
  }

  function renderBono(bono, client) {
    const el = document.createElement('div');
    el.className = 'panel-bono';
    const pct = bono.totalSessions ? Math.round((bono.sessionsUsed / bono.totalSessions) * 100) : 0;
    el.innerHTML = `
      <div class="panel-bono-top">
        <div class="panel-bono-name">${bono.serviceName}</div>
        <div class="panel-bono-sessions"><b>${bono.sessionsUsed}</b> de ${bono.totalSessions} usadas</div>
      </div>
      <div class="panel-progress-track"><div class="panel-progress-fill" style="width:${pct}%;"></div></div>
      <div class="panel-bono-actions">
        ${bono.sessionsRemaining > 0 ? '<button type="button" class="panel-btn panel-btn-primary panel-btn-sm panel-book-session">+ Agendar siguiente sesión</button>' : '<span class="panel-status">Bono completado</span>'}
      </div>
      <div class="panel-new-appt-slot"></div>
    `;
    const bookBtn = el.querySelector('.panel-book-session');
    if (bookBtn) {
      bookBtn.addEventListener('click', () => toggleBookSessionForm(el, bono, bookBtn));
    }
    return el;
  }

  async function toggleBookSessionForm(bonoEl, bono, btn) {
    const slot = bonoEl.querySelector('.panel-new-appt-slot');
    if (slot.innerHTML) { slot.innerHTML = ''; return; }

    let employees = [];
    try {
      const data = await panelFetch(`/employees?serviceIds=${encodeURIComponent(bono.serviceId || '')}`);
      employees = data.employees || [];
    } catch (e) { /* seguimos con la lista vacía si falla */ }

    slot.innerHTML = `
      <div class="panel-new-appt">
        <div class="panel-label">Agendar sesión ${bono.sessionsUsed + 1} de ${bono.totalSessions}</div>
        <div class="panel-field-row">
          <div class="panel-field"><label>Profesional</label>
            <select class="pf-employee">${employees.map((e) => `<option value="${e.id}">${e.name}</option>`).join('')}</select>
          </div>
          <div class="panel-field"><label>Fecha</label><input type="date" class="pf-date"></div>
          <div class="panel-field"><label>Hora</label><select class="pf-time"><option>Elige fecha primero</option></select></div>
        </div>
        <button type="button" class="panel-btn panel-btn-primary panel-confirm-session">Confirmar cita</button>
        <p class="panel-error" style="display:none;"></p>
      </div>
    `;

    const dateInput = slot.querySelector('.pf-date');
    const timeSelect = slot.querySelector('.pf-time');
    const employeeSelect = slot.querySelector('.pf-employee');
    const errorEl = slot.querySelector('.panel-error');

    async function loadTimes() {
      if (!dateInput.value || !employeeSelect.value) return;
      timeSelect.innerHTML = '<option>Cargando…</option>';
      try {
        const data = await panelFetch(`/availability?employeeId=${employeeSelect.value}&date=${dateInput.value}&serviceId=${encodeURIComponent(bono.serviceId || '')}`);
        const slots = data.slots || [];
        timeSelect.innerHTML = slots.length
          ? slots.map((t) => `<option value="${t}">${t}</option>`).join('')
          : '<option value="">Sin huecos ese día</option>';
      } catch (e) {
        timeSelect.innerHTML = '<option value="">Error al cargar</option>';
      }
    }
    dateInput.addEventListener('change', loadTimes);
    employeeSelect.addEventListener('change', loadTimes);

    slot.querySelector('.panel-confirm-session').addEventListener('click', async (ev) => {
      errorEl.style.display = 'none';
      if (!employeeSelect.value || !dateInput.value || !timeSelect.value) {
        errorEl.textContent = 'Elige profesional, fecha y hora.';
        errorEl.style.display = 'block';
        return;
      }
      ev.target.disabled = true;
      try {
        await panelFetch('/panel/book-session', {
          method: 'POST',
          body: JSON.stringify({ bonoId: bono.bonoId, employeeId: employeeSelect.value, date: dateInput.value, time: timeSelect.value }),
        });
        doSearch(); // recarga con los datos actualizados
      } catch (e) {
        errorEl.textContent = e.message;
        errorEl.style.display = 'block';
        ev.target.disabled = false;
      }
    });
  }

  function renderAppt(b) {
    const el = document.createElement('div');
    el.className = 'panel-appt';
    const statusPill = {
      confirmed: '<span class="panel-pill panel-pill-ok"><span class="dot"></span>Confirmada</span>',
      no_show: '<span class="panel-pill panel-pill-crit"><span class="dot"></span>No-show</span>',
      cancelled_refunded: '<span class="panel-pill panel-pill-warn"><span class="dot"></span>Cancelada (reembolsada)</span>',
      cancelled_no_refund: '<span class="panel-pill panel-pill-warn"><span class="dot"></span>Cancelada (sin reembolso)</span>',
    }[b.status] || `<span class="panel-pill panel-pill-warn"><span class="dot"></span>${b.status || ''}</span>`;

    el.innerHTML = `
      <div class="panel-appt-top">
        <div class="panel-appt-date">${fmtDateParts(b.date).month}<span class="day">${fmtDateParts(b.date).day}</span></div>
        <div class="panel-appt-body">
          <div class="svc">${b.serviceName}</div>
          <div class="with">Con ${b.employeeName || '—'} · ${b.time}</div>
        </div>
        <div>${statusPill}</div>
      </div>
      <div class="panel-appt-note-view" style="${b.notes ? '' : 'display:none;'}"><span class="tag">Nota:</span><span class="note-text">${b.notes || ''}</span></div>
      <div class="panel-appt-note-edit" style="display:none;">
        <textarea placeholder="Ej. potencia del láser, observaciones…">${b.notes || ''}</textarea>
      </div>
      <div class="panel-appt-actions">
        <button type="button" class="panel-btn panel-btn-ghost panel-btn-sm panel-note-toggle">✎ Nota</button>
        ${b.status === 'confirmed' && !b.isPast ? '<button type="button" class="panel-btn panel-btn-ghost panel-btn-sm panel-reschedule-toggle">Reprogramar</button>' : ''}
        ${b.status === 'confirmed' ? '<button type="button" class="panel-btn panel-btn-noshow panel-btn-sm panel-noshow-btn">Marcar como no-show</button>' : ''}
        ${b.status === 'confirmed' && b.isPast ? '<button type="button" class="panel-btn panel-btn-ghost panel-btn-sm panel-close-toggle">💶 Cerrar cita</button>' : ''}
      </div>
      <div class="panel-reschedule-slot"></div>
      <div class="panel-close-slot"></div>
    `;

    const noteEdit = el.querySelector('.panel-appt-note-edit');
    const noteView = el.querySelector('.panel-appt-note-view');
    el.querySelector('.panel-note-toggle').addEventListener('click', () => {
      const isOpen = noteEdit.style.display !== 'none';
      noteEdit.style.display = isOpen ? 'none' : 'block';
      if (!isOpen) return;
      const textarea = noteEdit.querySelector('textarea');
      panelFetch('/panel/note', { method: 'POST', body: JSON.stringify({ bookingId: b.bookingId, note: textarea.value }) })
        .then(() => {
          noteView.querySelector('.note-text').textContent = textarea.value;
          noteView.style.display = textarea.value ? 'flex' : 'none';
        })
        .catch((e) => alert(e.message));
    });

    const reschedBtn = el.querySelector('.panel-reschedule-toggle');
    if (reschedBtn) {
      reschedBtn.addEventListener('click', () => toggleReschedule(el, b));
    }

    const noShowBtn = el.querySelector('.panel-noshow-btn');
    if (noShowBtn) {
      noShowBtn.addEventListener('click', async () => {
        if (!confirm(`¿Marcar como no-show la cita de ${b.serviceName} el ${b.date}?`)) return;
        noShowBtn.disabled = true;
        try {
          const result = await panelFetch('/panel/no-show', { method: 'POST', body: JSON.stringify({ bookingId: b.bookingId }) });
          alert(result.isFirstTime ? 'Marcada. Primera falta: se ha perdonado y avisado por email.' : 'Marcada. Ya tenía una falta anterior: se ha descontado la sesión y avisado por email.');
          doSearch();
        } catch (e) {
          alert(e.message);
          noShowBtn.disabled = false;
        }
      });
    }

    const closeBtn = el.querySelector('.panel-close-toggle');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => toggleClose(el, b));
    }

    return el;
  }

  function toggleClose(apptEl, b) {
    const slot = apptEl.querySelector('.panel-close-slot');
    if (slot.innerHTML) { slot.innerHTML = ''; return; }
    const closedNote = b.finalAmount !== null && b.finalAmount !== undefined
      ? `<p class="panel-status">Ya cerrada — total ${b.finalAmount.toFixed(2)} €${b.remainderPaidHow ? ` (resto: ${b.remainderPaidHow})` : ''}</p>`
      : '';
    slot.innerHTML = `
      <div class="panel-new-appt">
        ${closedNote}
        <div class="panel-label">Cerrar cita — importe total real</div>
        <div class="panel-field-row">
          <div class="panel-field"><label>Importe total (€)</label><input type="number" step="0.01" class="pf-amount" value="${b.finalAmount || b.price || b.amountPaid || ''}"></div>
          <div class="panel-field"><label>Resto pagado en centro con</label>
            <select class="pf-paidhow">
              <option value="efectivo">Efectivo</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="bizum">Bizum</option>
            </select>
          </div>
        </div>
        <button type="button" class="panel-btn panel-btn-primary panel-confirm-close">Guardar</button>
        <p class="panel-error" style="display:none;"></p>
      </div>
    `;
    const amountInput = slot.querySelector('.pf-amount');
    const paidHowSelect = slot.querySelector('.pf-paidhow');
    const errorEl = slot.querySelector('.panel-error');
    slot.querySelector('.panel-confirm-close').addEventListener('click', async (ev) => {
      errorEl.style.display = 'none';
      ev.target.disabled = true;
      try {
        await panelFetch('/panel/close', {
          method: 'POST',
          body: JSON.stringify({ bookingId: b.bookingId, finalAmount: amountInput.value, paidHow: paidHowSelect.value }),
        });
        slot.innerHTML = '<p class="panel-status">Guardado ✓</p>';
      } catch (e) {
        errorEl.textContent = e.message;
        errorEl.style.display = 'block';
        ev.target.disabled = false;
      }
    });
  }

  async function toggleReschedule(apptEl, b) {
    const slot = apptEl.querySelector('.panel-reschedule-slot');
    if (slot.innerHTML) { slot.innerHTML = ''; return; }
    slot.innerHTML = `
      <div class="panel-new-appt">
        <div class="panel-field-row">
          <div class="panel-field"><label>Nueva fecha</label><input type="date" class="pf-date"></div>
          <div class="panel-field"><label>Nueva hora</label><select class="pf-time"><option>Elige fecha primero</option></select></div>
        </div>
        <button type="button" class="panel-btn panel-btn-primary panel-confirm-resched">Confirmar cambio</button>
        <p class="panel-error" style="display:none;"></p>
      </div>
    `;
    const dateInput = slot.querySelector('.pf-date');
    const timeSelect = slot.querySelector('.pf-time');
    const errorEl = slot.querySelector('.panel-error');

    dateInput.addEventListener('change', async () => {
      timeSelect.innerHTML = '<option>Cargando…</option>';
      try {
        const data = await panelFetch(`/panel/reschedule-slots?bookingId=${b.bookingId}&date=${dateInput.value}`);
        const slots = data.slots || [];
        timeSelect.innerHTML = slots.length ? slots.map((t) => `<option value="${t}">${t}</option>`).join('') : '<option value="">Sin huecos ese día</option>';
      } catch (e) {
        timeSelect.innerHTML = '<option value="">Error al cargar</option>';
      }
    });

    slot.querySelector('.panel-confirm-resched').addEventListener('click', async (ev) => {
      errorEl.style.display = 'none';
      if (!dateInput.value || !timeSelect.value) {
        errorEl.textContent = 'Elige fecha y hora.';
        errorEl.style.display = 'block';
        return;
      }
      ev.target.disabled = true;
      try {
        await panelFetch('/panel/reschedule', { method: 'POST', body: JSON.stringify({ bookingId: b.bookingId, date: dateInput.value, time: timeSelect.value }) });
        doSearch();
      } catch (e) {
        errorEl.textContent = e.message;
        errorEl.style.display = 'block';
        ev.target.disabled = false;
      }
    });
  }
})();
