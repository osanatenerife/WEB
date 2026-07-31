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
    reportToggle: document.getElementById('panel-report-toggle'),
    reportSlot: document.getElementById('panel-report-slot'),
    quoteToggle: document.getElementById('panel-quote-toggle'),
    quoteSlot: document.getElementById('panel-quote-slot'),
    importToggle: document.getElementById('panel-import-toggle'),
    importSlot: document.getElementById('panel-import-slot'),
    agendaToggle: document.getElementById('panel-agenda-toggle'),
    agendaSlot: document.getElementById('panel-agenda-slot'),
    giftToggle: document.getElementById('panel-gift-toggle'),
    giftSlot: document.getElementById('panel-gift-slot'),
    discountToggle: document.getElementById('panel-discount-toggle'),
    discountSlot: document.getElementById('panel-discount-slot'),
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
              <option value="bonos archipiélago">Bonos Archipiélago</option>
              <option value="bono adeje">Bono Adeje</option>
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

  // ── Informe trimestral en Excel (para el asesor cada 3 meses) ──
  els.reportToggle.addEventListener('click', () => {
    if (els.reportSlot.innerHTML) { els.reportSlot.innerHTML = ''; return; }
    const now = new Date();
    const currentQuarter = Math.floor(now.getMonth() / 3) + 1;
    els.reportSlot.innerHTML = `
      <div class="panel-new-appt">
        <div class="panel-label">Descargar informe trimestral</div>
        <div class="panel-field-row">
          <div class="panel-field"><label>Trimestre</label>
            <select class="pr-quarter">
              <option value="1">T1 (Ene-Mar)</option>
              <option value="2">T2 (Abr-Jun)</option>
              <option value="3">T3 (Jul-Sep)</option>
              <option value="4">T4 (Oct-Dic)</option>
            </select>
          </div>
          <div class="panel-field"><label>Año</label><input type="number" class="pr-year" value="${now.getFullYear()}"></div>
        </div>
        <button type="button" class="panel-btn panel-btn-primary panel-confirm-report">Descargar Excel</button>
        <p class="panel-error" style="display:none;"></p>
      </div>
    `;
    const slot = els.reportSlot;
    slot.querySelector('.pr-quarter').value = String(currentQuarter);
    const quarterSelect = slot.querySelector('.pr-quarter');
    const yearInput = slot.querySelector('.pr-year');
    const errorEl = slot.querySelector('.panel-error');
    slot.querySelector('.panel-confirm-report').addEventListener('click', async (ev) => {
      errorEl.style.display = 'none';
      ev.target.disabled = true;
      try {
        const res = await fetch(`${BOOKING_API_BASE}/panel/report?quarter=${quarterSelect.value}&year=${yearInput.value}`, {
          headers: { 'x-panel-key': panelKey },
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'No se pudo generar el informe.');
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Osana_Informe_Q${quarterSelect.value}_${yearInput.value}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (e) {
        errorEl.textContent = e.message;
        errorEl.style.display = 'block';
      }
      ev.target.disabled = false;
    });
  });

  // ── Presupuesto personalizado: genera un link de pago (con Klarna) para
  // un importe fuera de catálogo, para mandárselo a la clienta ──
  els.quoteToggle.addEventListener('click', () => {
    if (els.quoteSlot.innerHTML) { els.quoteSlot.innerHTML = ''; return; }
    els.quoteSlot.innerHTML = `
      <div class="panel-new-appt">
        <div class="panel-label">Generar link de pago personalizado</div>
        <div class="panel-field-row">
          <div class="panel-field"><label>Nombre de la clienta</label><input type="text" class="pq-name"></div>
          <div class="panel-field"><label>Teléfono</label><input type="text" class="pq-phone"></div>
          <div class="panel-field"><label>Email (para el link y el recibo)</label><input type="email" class="pq-email"></div>
        </div>
        <div class="panel-field-row">
          <div class="panel-field"><label>Descripción del presupuesto</label><input type="text" class="pq-desc" placeholder="Ej. Pack personalizado 5 sesiones"></div>
          <div class="panel-field"><label>Importe (€)</label><input type="number" step="0.01" class="pq-amount"></div>
          <div class="panel-field"><label>Categoría contable</label>
            <select class="pq-category">
              <option value="laser">Láser</option>
              <option value="corporal">Corporal</option>
              <option value="facial">Facial</option>
              <option value="cejas">Cejas / Depilación</option>
            </select>
          </div>
        </div>
        <button type="button" class="panel-btn panel-btn-primary panel-confirm-quote">Generar link de pago</button>
        <p class="panel-error" style="display:none;"></p>
        <div class="pq-result" style="display:none;"></div>
      </div>
    `;
    const slot = els.quoteSlot;
    const nameInput = slot.querySelector('.pq-name');
    const phoneInput = slot.querySelector('.pq-phone');
    const emailInput = slot.querySelector('.pq-email');
    const descInput = slot.querySelector('.pq-desc');
    const amountInput = slot.querySelector('.pq-amount');
    const categorySelect = slot.querySelector('.pq-category');
    const errorEl = slot.querySelector('.panel-error');
    const resultEl = slot.querySelector('.pq-result');
    slot.querySelector('.panel-confirm-quote').addEventListener('click', async (ev) => {
      errorEl.style.display = 'none';
      resultEl.style.display = 'none';
      if (!nameInput.value.trim() || !descInput.value.trim() || !amountInput.value) {
        errorEl.textContent = 'Indica al menos el nombre, la descripción y el importe.';
        errorEl.style.display = 'block';
        return;
      }
      ev.target.disabled = true;
      try {
        const data = await panelFetch('/panel/custom-quote', {
          method: 'POST',
          body: JSON.stringify({
            clientName: nameInput.value.trim(), clientPhone: phoneInput.value.trim(),
            clientEmail: emailInput.value.trim(), description: descInput.value.trim(),
            amount: amountInput.value, category: categorySelect.value,
          }),
        });
        const waText = encodeURIComponent(`Hola ${nameInput.value.trim()}, aquí tienes el link para pagar tu presupuesto (${descInput.value.trim()}, ${Number(amountInput.value).toFixed(2)} €): ${data.url}`);
        resultEl.innerHTML = `
          <p class="panel-status">Link generado ✓</p>
          <input type="text" class="pq-link-out" readonly value="${data.url}" style="width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:4px;font-family:inherit;font-size:12.5px;margin-bottom:10px;">
          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <button type="button" class="panel-btn panel-btn-ghost panel-btn-sm pq-copy">Copiar link</button>
            <a class="panel-btn panel-btn-ghost panel-btn-sm" href="https://wa.me/?text=${waText}" target="_blank" rel="noopener">Enviar por WhatsApp</a>
          </div>
        `;
        resultEl.style.display = 'block';
        resultEl.querySelector('.pq-copy').addEventListener('click', () => {
          resultEl.querySelector('.pq-link-out').select();
          navigator.clipboard.writeText(data.url);
        });
      } catch (e) {
        errorEl.textContent = e.message;
        errorEl.style.display = 'block';
      }
      ev.target.disabled = false;
    });
  });

  // ── Añadir reserva manual: da de alta en la Sheet una cita que ya existe
  // en el calendario de Google (reservada por teléfono/en persona), para
  // que la clienta pueda gestionarla luego desde "Mis Reservas" ──
  let importServicesCache = null;
  async function loadImportServicesOnce() {
    if (importServicesCache) return importServicesCache;
    const res = await fetch(`${BOOKING_API_BASE}/services?lang=es`);
    const data = await res.json();
    importServicesCache = data.services || [];
    return importServicesCache;
  }

  els.importToggle.addEventListener('click', async () => {
    if (els.importSlot.innerHTML) { els.importSlot.innerHTML = ''; return; }
    els.importSlot.innerHTML = `<div class="panel-new-appt"><p class="panel-status">Cargando tratamientos…</p></div>`;
    const allServices = await loadImportServicesOnce();
    const byCategory = {};
    allServices.forEach((s) => { (byCategory[s.category] = byCategory[s.category] || []).push(s); });
    const serviceOptions = Object.keys(byCategory).map((cat) => `
      <optgroup label="${cat}">
        ${byCategory[cat].map((s) => `<option value="${s.id}">${s.name} — ${s.price} €</option>`).join('')}
      </optgroup>
    `).join('');

    els.importSlot.innerHTML = `
      <div class="panel-new-appt">
        <div class="panel-label">Añadir reserva manual (cita ya existente en el calendario)</div>
        <p class="panel-status" style="margin-bottom:10px;">El evento tiene que existir YA en el calendario de Google de la profesional — aquí solo se busca y se enlaza con una fila nueva para que la clienta pueda verla en "Mis Reservas".</p>
        <div class="panel-field-row">
          <div class="panel-field"><label>Nombre de la clienta</label><input type="text" class="pi-name"></div>
          <div class="panel-field"><label>Teléfono</label><input type="text" class="pi-phone"></div>
          <div class="panel-field"><label>Email</label><input type="email" class="pi-email"></div>
        </div>
        <div class="panel-field-row">
          <div class="panel-field"><label>Tratamiento</label>
            <select class="pi-service"><option value="">Elige un tratamiento…</option>${serviceOptions}</select>
          </div>
          <div class="panel-field"><label>Profesional</label><select class="pi-employee"><option value="">Elige un tratamiento primero…</option></select></div>
        </div>
        <div class="panel-field-row">
          <div class="panel-field"><label>Fecha</label><input type="date" class="pi-date"></div>
          <div class="panel-field"><label>Hora</label><input type="time" class="pi-time"></div>
          <div class="panel-field"><label>Fecha de nacimiento (opcional)</label><input type="date" class="pi-birthdate"></div>
        </div>
        <label class="panel-checkbox-row" style="display:flex;align-items:center;gap:8px;margin:4px 0 10px;">
          <input type="checkbox" class="pi-is-bono"> Es una sesión de un bono ya vendido (varias sesiones)
        </label>
        <div class="panel-field-row pi-bono-fields" style="display:none;">
          <div class="panel-field"><label>Nº de esta sesión</label><input type="number" min="1" step="1" class="pi-session-number" placeholder="Ej. 2"></div>
          <div class="panel-field"><label>Total de sesiones del bono</label><input type="number" min="1" step="1" class="pi-total-sessions" placeholder="Ej. 3"></div>
          <div class="panel-field"><label>Precio total del bono (€)</label><input type="number" step="0.01" class="pi-bono-price"></div>
          <div class="panel-field"><label>Ya pagado del bono (€)</label><input type="number" step="0.01" class="pi-bono-paid"></div>
        </div>
        <div class="panel-field-row pi-normal-fields">
          <div class="panel-field"><label>Precio (€)</label><input type="number" step="0.01" class="pi-price"></div>
          <div class="panel-field"><label>Ya pagado (€)</label><input type="number" step="0.01" class="pi-paid" value="0"></div>
          <div class="panel-field"><label>Notas (opcional)</label><input type="text" class="pi-notes"></div>
        </div>
        <button type="button" class="panel-btn panel-btn-primary panel-confirm-import">Buscar evento y dar de alta</button>
        <p class="panel-error" style="display:none;"></p>
        <p class="panel-status pi-result" style="display:none;"></p>
      </div>
    `;
    const slot = els.importSlot;
    const nameInput = slot.querySelector('.pi-name');
    const phoneInput = slot.querySelector('.pi-phone');
    const emailInput = slot.querySelector('.pi-email');
    const serviceSelect = slot.querySelector('.pi-service');
    const employeeSelect = slot.querySelector('.pi-employee');
    const dateInput = slot.querySelector('.pi-date');
    const timeInput = slot.querySelector('.pi-time');
    const birthdateInput = slot.querySelector('.pi-birthdate');
    const isBonoCheck = slot.querySelector('.pi-is-bono');
    const bonoFieldsRow = slot.querySelector('.pi-bono-fields');
    const normalFieldsRow = slot.querySelector('.pi-normal-fields');
    const sessionNumberInput = slot.querySelector('.pi-session-number');
    const totalSessionsInput = slot.querySelector('.pi-total-sessions');
    const bonoPriceInput = slot.querySelector('.pi-bono-price');
    const bonoPaidInput = slot.querySelector('.pi-bono-paid');
    const priceInput = slot.querySelector('.pi-price');
    const paidInput = slot.querySelector('.pi-paid');
    const notesInput = slot.querySelector('.pi-notes');
    const errorEl = slot.querySelector('.panel-error');
    const resultEl = slot.querySelector('.pi-result');

    isBonoCheck.addEventListener('change', () => {
      bonoFieldsRow.style.display = isBonoCheck.checked ? 'flex' : 'none';
      normalFieldsRow.style.display = isBonoCheck.checked ? 'none' : 'flex';
    });

    serviceSelect.addEventListener('change', async () => {
      const svc = allServices.find((s) => s.id === serviceSelect.value);
      priceInput.value = svc ? svc.price : '';
      if (svc && !bonoPriceInput.value) bonoPriceInput.placeholder = totalSessionsInput.value ? (svc.price * Number(totalSessionsInput.value)).toFixed(2) : '';
      employeeSelect.innerHTML = '<option value="">Cargando…</option>';
      if (!serviceSelect.value) {
        employeeSelect.innerHTML = '<option value="">Elige un tratamiento primero…</option>';
        return;
      }
      const res = await fetch(`${BOOKING_API_BASE}/employees?serviceIds=${encodeURIComponent(serviceSelect.value)}`);
      const data = await res.json();
      employeeSelect.innerHTML = '<option value="">Elige una profesional…</option>'
        + (data.employees || []).map((e) => `<option value="${e.id}">${e.name}</option>`).join('');
    });

    slot.querySelector('.panel-confirm-import').addEventListener('click', async (ev) => {
      errorEl.style.display = 'none';
      resultEl.style.display = 'none';
      if (!nameInput.value.trim() || !phoneInput.value.trim() || !emailInput.value.trim()
        || !serviceSelect.value || !employeeSelect.value || !dateInput.value || !timeInput.value) {
        errorEl.textContent = 'Completa nombre, teléfono, email, tratamiento, profesional, fecha y hora.';
        errorEl.style.display = 'block';
        return;
      }
      if (isBonoCheck.checked && (!sessionNumberInput.value || !totalSessionsInput.value)) {
        errorEl.textContent = 'Indica el número de esta sesión y el total de sesiones del bono.';
        errorEl.style.display = 'block';
        return;
      }
      ev.target.disabled = true;
      try {
        const data = await panelFetch('/panel/import-legacy-booking', {
          method: 'POST',
          body: JSON.stringify({
            name: nameInput.value.trim(), phone: phoneInput.value.trim(), email: emailInput.value.trim(),
            birthdate: birthdateInput.value || '', serviceId: serviceSelect.value, employeeId: employeeSelect.value,
            date: dateInput.value, time: timeInput.value,
            price: priceInput.value, amountPaid: paidInput.value, notes: notesInput.value.trim(),
            isBono: isBonoCheck.checked,
            sessionNumber: sessionNumberInput.value, totalSessions: totalSessionsInput.value,
            bonoTotalPrice: bonoPriceInput.value, bonoAmountPaid: bonoPaidInput.value,
          }),
        });
        resultEl.textContent = isBonoCheck.checked
          ? `Reserva y bono dados de alta ✓ (id: ${data.bookingId}). El bono ya aparece en la ficha de la clienta en el panel.`
          : `Reserva dada de alta ✓ (id: ${data.bookingId}). La clienta ya puede verla en "Mis Reservas" con su teléfono y email.`;
        resultEl.style.display = 'block';
        [nameInput, phoneInput, emailInput, dateInput, timeInput, birthdateInput, priceInput, notesInput,
          sessionNumberInput, totalSessionsInput, bonoPriceInput, bonoPaidInput].forEach((i) => { i.value = ''; });
        paidInput.value = '0';
        serviceSelect.value = '';
        employeeSelect.innerHTML = '<option value="">Elige un tratamiento primero…</option>';
        isBonoCheck.checked = false;
        bonoFieldsRow.style.display = 'none';
        normalFieldsRow.style.display = 'flex';
      } catch (e) {
        errorEl.textContent = e.message;
        errorEl.style.display = 'block';
      }
      ev.target.disabled = false;
    });
  });

  function fmtDateParts(dateStr) {
    const d = new Date(`${dateStr}T12:00:00`);
    const day = d.toLocaleDateString('es-ES', { day: '2-digit' });
    const month = d.toLocaleDateString('es-ES', { month: 'short' }).toUpperCase().replace('.', '');
    return { day, month };
  }
  function fmtDateShort(dateStr) {
    const p = fmtDateParts(dateStr);
    return `${p.day} ${p.month}`;
  }

  function jumpToClient(phone) {
    els.agendaSlot.innerHTML = '';
    els.searchInput.value = phone || '';
    doSearch();
    els.searchInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ── Agenda: panel de control con todo lo que necesita atención ──
  els.agendaToggle.addEventListener('click', async () => {
    if (els.agendaSlot.innerHTML) { els.agendaSlot.innerHTML = ''; return; }
    els.agendaSlot.innerHTML = '<div class="panel-new-appt"><p class="panel-status">Cargando agenda…</p></div>';
    try {
      const data = await panelFetch('/panel/agenda?days=7');
      renderAgenda(data);
    } catch (e) {
      if (e.message === 'unauthorized') return;
      els.agendaSlot.innerHTML = `<div class="panel-new-appt"><p class="panel-error" style="display:block;">${e.message}</p></div>`;
    }
  });

  function agendaSection(title, emptyMsg, rowsHtml) {
    return `
      <div class="panel-section-label">${title}</div>
      ${rowsHtml || `<p class="panel-status">${emptyMsg}</p>`}
    `;
  }
  function agendaRow(mainHtml, phone, extraButtonsHtml) {
    return `
      <div class="panel-agenda-row">
        <div>${mainHtml}</div>
        <div class="actions">
          ${extraButtonsHtml || ''}
          <button type="button" class="panel-btn panel-btn-ghost panel-btn-sm agenda-search-btn" data-phone="${phone || ''}">Ver ficha</button>
        </div>
      </div>
    `;
  }

  function renderAgenda(data) {
    const unclosedHtml = data.unclosedBookings.map((b) => agendaRow(
      `<b>${b.name || '(sin nombre)'}</b> — ${b.serviceName} · ${fmtDateShort(b.date)} ${b.time} · ${b.employeeName || ''}`,
      b.phone,
    )).join('');

    const upcomingHtml = data.upcomingBookings.map((b) => agendaRow(
      `<b>${b.name || '(sin nombre)'}</b> — ${b.serviceName} · ${fmtDateShort(b.date)} ${b.time} · ${b.employeeName || ''}`,
      b.phone,
    )).join('');

    const followupsHtml = data.dueFollowups.map((f) => agendaRow(
      `<b>${f.clientName || '(sin nombre)'}</b> — vence ${fmtDateShort(f.dueDate)}${f.note ? ` · ${f.note}` : ''}`,
      f.clientPhone,
      `<button type="button" class="panel-btn panel-btn-primary panel-btn-sm agenda-followup-done" data-id="${f.followupId}">Hecho ✓</button>`,
    )).join('');

    const bonoPendingHtml = data.pendingBonoSessions.map((bono) => agendaRow(
      `<b>${bono.clientName || '(sin nombre)'}</b> — ${bono.serviceName} (${bono.sessionsUsed}/${bono.totalSessions} usadas)`,
      bono.clientPhone,
    )).join('');

    const bonoExpiringHtml = data.expiringBonos.map((bono) => agendaRow(
      `<b>${bono.clientName || '(sin nombre)'}</b> — ${bono.serviceName} (${bono.sessionsRemaining} sesiones sin usar) · caduca ${fmtDateShort(bono.expiryDate)}`,
      bono.clientPhone,
    )).join('');

    const quotesHtml = data.unpaidQuotes.map((q) => agendaRow(
      `<b>${q.clientName || '(sin nombre)'}</b> — ${q.description} · ${Number(q.amount).toFixed(2)} €`,
      q.clientPhone,
    )).join('');

    els.agendaSlot.innerHTML = `
      <div class="panel-new-appt">
        <div class="panel-label">Agenda — próximos 7 días</div>
        ${agendaSection('🔴 Citas sin cerrar', 'No hay citas pendientes de cerrar.', unclosedHtml)}
        ${agendaSection('📅 Próximas citas (7 días)', 'No hay citas en los próximos días.', upcomingHtml)}
        ${agendaSection('🔔 Seguimientos que se acercan', 'No hay seguimientos pendientes.', followupsHtml)}
        ${agendaSection('🎟️ Bonos con sesión por agendar', 'No hay bonos pendientes de agendar.', bonoPendingHtml)}
        ${agendaSection('⏳ Bonos cerca de caducar (30 días)', 'No hay bonos por caducar.', bonoExpiringHtml)}
        ${agendaSection('🧾 Presupuestos sin pagar', 'No hay presupuestos pendientes de pago.', quotesHtml)}
      </div>
    `;

    els.agendaSlot.querySelectorAll('.agenda-search-btn').forEach((btn) => {
      btn.addEventListener('click', () => jumpToClient(btn.dataset.phone));
    });
    els.agendaSlot.querySelectorAll('.agenda-followup-done').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await panelFetch('/panel/followup-done', { method: 'POST', body: JSON.stringify({ followupId: btn.dataset.id }) });
          btn.closest('.panel-agenda-row').remove();
        } catch (e) {
          btn.disabled = false;
        }
      });
    });
  }

  // ── Bono regalo: buscar por código y marcar como canjeado ──
  els.giftToggle.addEventListener('click', () => {
    if (els.giftSlot.innerHTML) { els.giftSlot.innerHTML = ''; return; }
    els.giftSlot.innerHTML = `
      <div class="panel-new-appt">
        <div class="panel-label">Buscar bono regalo por código</div>
        <div class="panel-field-row">
          <div class="panel-field"><label>Código</label><input type="text" class="gf-code" placeholder="Ej. OSANA-097E250C"></div>
        </div>
        <button type="button" class="panel-btn panel-btn-primary panel-search-gift">Buscar</button>
        <p class="panel-error" style="display:none;"></p>
        <div class="gf-result"></div>
      </div>
    `;
    const slot = els.giftSlot;
    const codeInput = slot.querySelector('.gf-code');
    const errorEl = slot.querySelector('.panel-error');
    const resultEl = slot.querySelector('.gf-result');

    async function searchGift() {
      errorEl.style.display = 'none';
      resultEl.innerHTML = '';
      const code = codeInput.value.trim();
      if (!code) return;
      try {
        const data = await panelFetch(`/panel/gift?code=${encodeURIComponent(code)}`);
        renderGiftResult(data.gift);
      } catch (e) {
        if (e.message === 'unauthorized') return;
        errorEl.textContent = e.message;
        errorEl.style.display = 'block';
      }
    }
    slot.querySelector('.panel-search-gift').addEventListener('click', searchGift);
    codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') searchGift(); });

    function renderGiftResult(gift) {
      const itemLabel = gift.giftType === 'service' ? gift.serviceName : `${gift.amount} € para gastar en cualquier tratamiento`;
      const isRedeemed = gift.status === 'redeemed';
      const statusPill = isRedeemed
        ? `<span class="panel-pill panel-pill-warn"><span class="dot"></span>Ya canjeado${gift.redeemedAt ? ` (${fmtDateShort(gift.redeemedAt.slice(0, 10))})` : ''}</span>`
        : `<span class="panel-pill panel-pill-ok"><span class="dot"></span>Sin canjear</span>`;
      resultEl.innerHTML = `
        <div class="panel-client-card" style="margin-top:16px;">
          <div class="panel-client-top">
            <div>
              <div class="panel-client-name">${gift.code}</div>
              <div class="panel-client-meta"><span>De ${gift.buyerName || '—'} para ${gift.recipientName || '—'}</span></div>
            </div>
            ${statusPill}
          </div>
          <p style="font-size:13px;margin:12px 0 4px;"><b>${itemLabel}</b></p>
          <p style="font-size:12.5px;color:var(--ink-soft);margin:0 0 4px;">Comprador: ${gift.buyerEmail || '—'}${gift.buyerPhone ? ` · ${gift.buyerPhone}` : ''}</p>
          <p style="font-size:12.5px;color:var(--ink-soft);margin:0 0 4px;">Caduca: ${gift.expiryDate ? fmtDateShort(gift.expiryDate) : '—'}</p>
          ${gift.message ? `<p style="font-size:12.5px;color:var(--ink-soft);margin:0 0 4px;">Mensaje: "${gift.message}"</p>` : ''}
          ${!isRedeemed ? '<button type="button" class="panel-btn panel-btn-primary panel-btn-sm gf-redeem" style="margin-top:10px;">Marcar como canjeado</button>' : ''}
        </div>
      `;
      const redeemBtn = resultEl.querySelector('.gf-redeem');
      if (redeemBtn) {
        redeemBtn.addEventListener('click', async () => {
          redeemBtn.disabled = true;
          try {
            await panelFetch('/panel/gift-redeem', { method: 'POST', body: JSON.stringify({ code: gift.code }) });
            searchGift();
          } catch (e) {
            errorEl.textContent = e.message;
            errorEl.style.display = 'block';
            redeemBtn.disabled = false;
          }
        });
      }
    }
  });

  // ── Descuentos: crear códigos restringidos a ciertos tratamientos y
  // fechas, listar los existentes, desactivarlos y avisar por email ──
  els.discountToggle.addEventListener('click', async () => {
    if (els.discountSlot.innerHTML) { els.discountSlot.innerHTML = ''; return; }
    els.discountSlot.innerHTML = '<div class="panel-new-appt"><p class="panel-status">Cargando…</p></div>';
    const allServices = await loadImportServicesOnce();
    const byCategory = {};
    allServices.forEach((s) => { (byCategory[s.category] = byCategory[s.category] || []).push(s); });
    const checkboxesHtml = Object.keys(byCategory).map((cat) => `
      <div class="panel-discount-cat">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--ink-faint);margin:10px 0 4px;">${cat}</div>
        ${byCategory[cat].map((s) => `
          <label class="panel-checkbox-row" style="display:flex;align-items:center;gap:8px;margin:2px 0;font-size:12.5px;">
            <input type="checkbox" class="dc-service" value="${s.id}"> ${s.name}
          </label>
        `).join('')}
      </div>
    `).join('');

    els.discountSlot.innerHTML = `
      <div class="panel-new-appt">
        <div class="panel-label">Crear código de descuento</div>
        <div class="panel-field-row">
          <div class="panel-field"><label>Código</label><input type="text" class="dc-code" placeholder="Ej. VERANO20" style="text-transform:uppercase;"></div>
          <div class="panel-field"><label>Tipo</label>
            <select class="dc-type">
              <option value="percent">% de descuento</option>
              <option value="amount">€ de descuento</option>
            </select>
          </div>
          <div class="panel-field"><label>Valor</label><input type="number" step="0.01" class="dc-value" placeholder="Ej. 20"></div>
        </div>
        <div class="panel-field-row">
          <div class="panel-field"><label>Desde</label><input type="date" class="dc-from"></div>
          <div class="panel-field"><label>Hasta</label><input type="date" class="dc-until"></div>
          <div class="panel-field"><label>Nota (opcional)</label><input type="text" class="dc-note" placeholder="Ej. lanzamiento Instagram"></div>
        </div>
        <div class="panel-label" style="margin-top:14px;">¿A qué tratamientos aplica?</div>
        <div class="panel-discount-services" style="max-height:220px;overflow-y:auto;border:1px solid var(--line);border-radius:4px;padding:10px 14px;margin-bottom:14px;">
          ${checkboxesHtml}
        </div>
        <button type="button" class="panel-btn panel-btn-primary panel-confirm-discount">Crear descuento</button>
        <p class="panel-error" style="display:none;"></p>
        <div class="panel-section-label" style="margin-top:26px;">Descuentos creados</div>
        <div class="dc-list"></div>
      </div>
    `;

    const slot = els.discountSlot;
    const codeInput = slot.querySelector('.dc-code');
    const typeSelect = slot.querySelector('.dc-type');
    const valueInput = slot.querySelector('.dc-value');
    const fromInput = slot.querySelector('.dc-from');
    const untilInput = slot.querySelector('.dc-until');
    const noteInput = slot.querySelector('.dc-note');
    const errorEl = slot.querySelector('.panel-error');
    const listEl = slot.querySelector('.dc-list');

    slot.querySelector('.panel-confirm-discount').addEventListener('click', async (ev) => {
      errorEl.style.display = 'none';
      const ids = Array.from(slot.querySelectorAll('.dc-service:checked')).map((c) => c.value);
      if (!codeInput.value.trim() || !ids.length || !valueInput.value || !fromInput.value || !untilInput.value) {
        errorEl.textContent = 'Completa el código, al menos un tratamiento, el valor y las dos fechas.';
        errorEl.style.display = 'block';
        return;
      }
      ev.target.disabled = true;
      try {
        await panelFetch('/panel/discount', {
          method: 'POST',
          body: JSON.stringify({
            code: codeInput.value.trim(), serviceIds: ids, discountType: typeSelect.value,
            discountValue: valueInput.value, validFrom: fromInput.value, validUntil: untilInput.value,
            note: noteInput.value.trim(),
          }),
        });
        codeInput.value = ''; valueInput.value = ''; fromInput.value = ''; untilInput.value = ''; noteInput.value = '';
        slot.querySelectorAll('.dc-service:checked').forEach((c) => { c.checked = false; });
        loadDiscountList();
      } catch (e) {
        errorEl.textContent = e.message;
        errorEl.style.display = 'block';
      }
      ev.target.disabled = false;
    });

    function renderDiscountRow(d) {
      const el = document.createElement('div');
      el.className = 'panel-agenda-row';
      const valueLabel = d.discountType === 'percent' ? `${d.discountValue}%` : `${d.discountValue} €`;
      const statusPill = !d.active
        ? '<span class="panel-pill panel-pill-warn"><span class="dot"></span>Desactivado</span>'
        : d.live
          ? '<span class="panel-pill panel-pill-ok"><span class="dot"></span>Vigente</span>'
          : '<span class="panel-pill panel-pill-warn"><span class="dot"></span>Fuera de fecha</span>';
      el.innerHTML = `
        <div>
          <b>${d.code}</b> — ${valueLabel} en ${d.serviceNames}<br>
          <span style="font-size:11.5px;color:var(--ink-soft);">${d.validFrom} → ${d.validUntil}${d.note ? ` · ${d.note}` : ''}${d.emailSentAt ? ' · ya enviado por email' : ''}</span>
        </div>
        <div class="actions">
          ${statusPill}
          <button type="button" class="panel-btn panel-btn-ghost panel-btn-sm dc-email-btn">📧 Enviar a clientas</button>
          ${d.active ? '<button type="button" class="panel-btn panel-btn-ghost panel-btn-sm dc-deactivate-btn">Desactivar</button>' : ''}
        </div>
      `;
      el.querySelector('.dc-email-btn').addEventListener('click', async (ev) => {
        if (!confirm('¿Enviar este descuento por email a todas las clientas registradas?')) return;
        ev.target.disabled = true;
        try {
          const data = await panelFetch('/panel/discount-email-blast', { method: 'POST', body: JSON.stringify({ discountId: d.discountId }) });
          ev.target.textContent = `Enviando a ${data.recipients}…`;
        } catch (e) {
          alert(e.message);
          ev.target.disabled = false;
        }
      });
      const deactivateBtn = el.querySelector('.dc-deactivate-btn');
      if (deactivateBtn) {
        deactivateBtn.addEventListener('click', async () => {
          deactivateBtn.disabled = true;
          try {
            await panelFetch('/panel/discount-deactivate', { method: 'POST', body: JSON.stringify({ discountId: d.discountId }) });
            loadDiscountList();
          } catch (e) {
            alert(e.message);
            deactivateBtn.disabled = false;
          }
        });
      }
      return el;
    }

    async function loadDiscountList() {
      listEl.innerHTML = '<p class="panel-status">Cargando…</p>';
      try {
        const data = await panelFetch('/panel/discounts');
        if (!data.discounts.length) { listEl.innerHTML = '<p class="panel-status">Aún no has creado ningún descuento.</p>'; return; }
        listEl.innerHTML = '';
        data.discounts.forEach((d) => listEl.appendChild(renderDiscountRow(d)));
      } catch (e) {
        listEl.innerHTML = `<p class="panel-error" style="display:block;">${e.message}</p>`;
      }
    }

    loadDiscountList();
  });

  function renderClient(client) {
    const wrap = document.createElement('div');

    const strikeBadge = client.strikeCount > 0
      ? `<span class="panel-pill panel-pill-warn"><span class="dot"></span>${client.strikeCount} falta${client.strikeCount > 1 ? 's' : ''} registrada${client.strikeCount > 1 ? 's' : ''}</span>`
      : `<span class="panel-pill panel-pill-ok"><span class="dot"></span>Sin faltas</span>`;
    const balance = Number(client.loyaltyBalance) || 0;

    wrap.innerHTML = `
      <div class="panel-client-card">
        <div class="panel-client-top">
          <div>
            <div class="panel-client-name">${client.name || '(sin nombre)'}</div>
            <div class="panel-client-meta"><span>${client.phone || ''}</span><span>${client.email || ''}</span></div>
          </div>
          ${strikeBadge}
        </div>
        <div class="panel-client-loyalty">
          <span class="panel-pill">💶 Saldo: ${balance.toFixed(2)} €</span>
          ${balance > 0 ? '<button type="button" class="panel-btn panel-btn-ghost panel-btn-sm panel-redeem-toggle">Canjear saldo</button>' : ''}
          <button type="button" class="panel-btn panel-btn-ghost panel-btn-sm panel-addloyalty-toggle">➕ Añadir saldo</button>
          <button type="button" class="panel-btn panel-btn-ghost panel-btn-sm panel-followup-toggle">🔔 Marcar seguimiento</button>
        </div>
        <div class="panel-redeem-slot"></div>
        <div class="panel-addloyalty-slot"></div>
        <div class="panel-followup-slot"></div>
      </div>
      ${client.bonos.length ? '<div class="panel-section-label">Bonos activos</div>' : ''}
      <div class="panel-bonos"></div>
      <div class="panel-section-label">Todas las citas</div>
      <div class="panel-appts"></div>
    `;

    const redeemBtn = wrap.querySelector('.panel-redeem-toggle');
    if (redeemBtn) {
      redeemBtn.addEventListener('click', () => toggleRedeem(wrap, client, balance));
    }

    wrap.querySelector('.panel-addloyalty-toggle').addEventListener('click', () => toggleAddLoyalty(wrap, client));

    wrap.querySelector('.panel-followup-toggle').addEventListener('click', () => toggleFollowup(wrap, client));

    const bonosContainer = wrap.querySelector('.panel-bonos');
    client.bonos.forEach((bono) => bonosContainer.appendChild(renderBono(bono, client)));

    const apptsContainer = wrap.querySelector('.panel-appts');
    client.bookings.forEach((b) => apptsContainer.appendChild(renderAppt(b, client)));

    els.results.appendChild(wrap);
  }

  function toggleFollowup(clientEl, client) {
    const slot = clientEl.querySelector('.panel-followup-slot');
    if (slot.innerHTML) { slot.innerHTML = ''; return; }
    slot.innerHTML = `
      <div class="panel-new-appt">
        <div class="panel-label">Marcar seguimiento de ${client.name || 'esta clienta'}</div>
        <div class="panel-field-row">
          <div class="panel-field"><label>Plazo</label>
            <select class="fu-timeframe">
              <option value="3dias">En 3 días</option>
              <option value="1semana">En 1 semana</option>
              <option value="1mes">En 1 mes</option>
              <option value="3meses">En 3 meses</option>
            </select>
          </div>
          <div class="panel-field"><label>Nota (opcional)</label><input type="text" class="fu-note" placeholder="Ej. preguntar cómo le fue el tratamiento"></div>
        </div>
        <button type="button" class="panel-btn panel-btn-primary panel-confirm-followup">Guardar seguimiento</button>
        <p class="panel-error" style="display:none;"></p>
      </div>
    `;
    const timeframeSelect = slot.querySelector('.fu-timeframe');
    const noteInput = slot.querySelector('.fu-note');
    const errorEl = slot.querySelector('.panel-error');
    slot.querySelector('.panel-confirm-followup').addEventListener('click', async (ev) => {
      errorEl.style.display = 'none';
      ev.target.disabled = true;
      try {
        await panelFetch('/panel/followup', {
          method: 'POST',
          body: JSON.stringify({
            clientName: client.name, clientPhone: client.phone, clientEmail: client.email,
            note: noteInput.value.trim(), timeframe: timeframeSelect.value,
          }),
        });
        slot.innerHTML = '<p class="panel-status">Seguimiento guardado ✓ — aparecerá en la Agenda cuando se acerque la fecha.</p>';
      } catch (e) {
        errorEl.textContent = e.message;
        errorEl.style.display = 'block';
        ev.target.disabled = false;
      }
    });
  }

  function toggleRedeem(clientEl, client, balance) {
    const slot = clientEl.querySelector('.panel-redeem-slot');
    if (slot.innerHTML) { slot.innerHTML = ''; return; }
    slot.innerHTML = `
      <div class="panel-new-appt">
        <div class="panel-label">Canjear saldo (máx. ${balance.toFixed(2)} €)</div>
        <div class="panel-field-row">
          <div class="panel-field"><label>Importe a canjear (€)</label><input type="number" step="0.01" class="rd-amount" max="${balance}"></div>
        </div>
        <button type="button" class="panel-btn panel-btn-primary panel-confirm-redeem">Aplicar descuento</button>
        <p class="panel-error" style="display:none;"></p>
      </div>
    `;
    const amountInput = slot.querySelector('.rd-amount');
    const errorEl = slot.querySelector('.panel-error');
    slot.querySelector('.panel-confirm-redeem').addEventListener('click', async (ev) => {
      errorEl.style.display = 'none';
      ev.target.disabled = true;
      try {
        const data = await panelFetch('/panel/redeem', {
          method: 'POST',
          body: JSON.stringify({ phone: client.phone, amount: amountInput.value }),
        });
        slot.innerHTML = `<p class="panel-status">Canjeado ✓ — nuevo saldo: ${data.newBalance.toFixed(2)} €</p>`;
      } catch (e) {
        errorEl.textContent = e.message;
        errorEl.style.display = 'block';
        ev.target.disabled = false;
      }
    });
  }

  function toggleAddLoyalty(clientEl, client) {
    const slot = clientEl.querySelector('.panel-addloyalty-slot');
    if (slot.innerHTML) { slot.innerHTML = ''; return; }
    slot.innerHTML = `
      <div class="panel-new-appt">
        <div class="panel-label">Añadir saldo a mano (p.ej. por un malentendido)</div>
        <div class="panel-field-row">
          <div class="panel-field"><label>Importe a añadir (€)</label><input type="number" step="0.01" class="al-amount"></div>
          <div class="panel-field"><label>Motivo</label><input type="text" class="al-note" placeholder="Ej. no se le acumuló el saldo de su última visita"></div>
        </div>
        <button type="button" class="panel-btn panel-btn-primary panel-confirm-addloyalty">Añadir saldo</button>
        <p class="panel-error" style="display:none;"></p>
      </div>
    `;
    const amountInput = slot.querySelector('.al-amount');
    const noteInput = slot.querySelector('.al-note');
    const errorEl = slot.querySelector('.panel-error');
    slot.querySelector('.panel-confirm-addloyalty').addEventListener('click', async (ev) => {
      errorEl.style.display = 'none';
      if (!amountInput.value || Number(amountInput.value) <= 0) {
        errorEl.textContent = 'Indica el importe a añadir.';
        errorEl.style.display = 'block';
        return;
      }
      if (!noteInput.value.trim()) {
        errorEl.textContent = 'Indica el motivo, para dejar constancia.';
        errorEl.style.display = 'block';
        return;
      }
      ev.target.disabled = true;
      try {
        const data = await panelFetch('/panel/loyalty-adjust', {
          method: 'POST',
          body: JSON.stringify({ phone: client.phone, amount: amountInput.value, note: noteInput.value.trim() }),
        });
        slot.innerHTML = `<p class="panel-status">Saldo añadido ✓ — nuevo saldo: ${data.newBalance.toFixed(2)} €</p>`;
      } catch (e) {
        errorEl.textContent = e.message;
        errorEl.style.display = 'block';
        ev.target.disabled = false;
      }
    });
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

  function renderAppt(b, client) {
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
        ${b.status === 'confirmed' && !b.isPast ? '<button type="button" class="panel-btn panel-btn-ghost panel-btn-sm panel-extend-toggle">⏱ Ampliar tiempo</button>' : ''}
        ${b.status === 'confirmed' ? '<button type="button" class="panel-btn panel-btn-noshow panel-btn-sm panel-noshow-btn">Marcar como no-show</button>' : ''}
        ${b.status === 'confirmed' && b.isPast ? '<button type="button" class="panel-btn panel-btn-ghost panel-btn-sm panel-close-toggle">💶 Cerrar cita</button>' : ''}
      </div>
      <div class="panel-reschedule-slot"></div>
      <div class="panel-extend-slot"></div>
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
      closeBtn.addEventListener('click', () => toggleClose(el, b, client));
    }

    const extendBtn = el.querySelector('.panel-extend-toggle');
    if (extendBtn) {
      extendBtn.addEventListener('click', () => toggleExtend(el, b));
    }

    return el;
  }

  function toggleExtend(apptEl, b) {
    const slot = apptEl.querySelector('.panel-extend-slot');
    if (slot.innerHTML) { slot.innerHTML = ''; return; }
    slot.innerHTML = `
      <div class="panel-new-appt">
        <div class="panel-label">Ampliar el tiempo bloqueado de esta cita</div>
        <div class="panel-field-row">
          <div class="panel-field"><label>Minutos extra</label><input type="number" min="5" step="5" class="ex-minutes" placeholder="Ej. 15"></div>
        </div>
        <button type="button" class="panel-btn panel-btn-primary panel-confirm-extend">Ampliar</button>
        <p class="panel-error" style="display:none;"></p>
      </div>
    `;
    const minutesInput = slot.querySelector('.ex-minutes');
    const errorEl = slot.querySelector('.panel-error');
    slot.querySelector('.panel-confirm-extend').addEventListener('click', async (ev) => {
      errorEl.style.display = 'none';
      if (!minutesInput.value || Number(minutesInput.value) <= 0) {
        errorEl.textContent = 'Indica cuántos minutos extra añadir.';
        errorEl.style.display = 'block';
        return;
      }
      ev.target.disabled = true;
      try {
        await panelFetch('/panel/extend-time', {
          method: 'POST',
          body: JSON.stringify({ bookingId: b.bookingId, extraMinutes: minutesInput.value }),
        });
        slot.innerHTML = '<p class="panel-status">Tiempo ampliado ✓</p>';
      } catch (e) {
        errorEl.textContent = e.message;
        errorEl.style.display = 'block';
        ev.target.disabled = false;
      }
    });
  }

  function toggleClose(apptEl, b, client) {
    const slot = apptEl.querySelector('.panel-close-slot');
    if (slot.innerHTML) { slot.innerHTML = ''; return; }
    const balance = client && Number(client.loyaltyBalance) || 0;
    const closedNote = b.finalAmount !== null && b.finalAmount !== undefined
      ? `<p class="panel-status">Ya cerrada — total ${b.finalAmount.toFixed(2)} €${b.remainderPaidHow ? ` (resto: ${b.remainderPaidHow}${b.remainderAmount2 ? ` + ${b.remainderPaidHow2} ${b.remainderAmount2.toFixed(2)} €` : ''})` : ''}${b.redeemedAmount ? ` · saldo canjeado: ${b.redeemedAmount.toFixed(2)} €` : ''}</p>`
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
              <option value="bonos archipiélago">Bonos Archipiélago</option>
              <option value="bono adeje">Bono Adeje</option>
            </select>
          </div>
        </div>
        ${balance > 0 ? `
        <div class="panel-field-row">
          <div class="panel-field"><label>Aplicar saldo de fidelización (€) — disponible: ${balance.toFixed(2)} € (mínimo 10 €)</label><input type="number" step="0.01" class="pf-redeem" min="10" max="${balance}"></div>
        </div>` : ''}
        <label class="panel-split-toggle"><input type="checkbox" class="pf-split"> El resto se pagó dividido en dos formas de pago</label>
        <div class="panel-field-row pf-split-row" style="display:none;">
          <div class="panel-field"><label>Importe con la 2ª forma de pago (€)</label><input type="number" step="0.01" class="pf-amount2"></div>
          <div class="panel-field"><label>2ª forma de pago</label>
            <select class="pf-paidhow2">
              <option value="efectivo">Efectivo</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="bizum">Bizum</option>
              <option value="bonos archipiélago">Bonos Archipiélago</option>
              <option value="bono adeje">Bono Adeje</option>
            </select>
          </div>
        </div>
        <button type="button" class="panel-btn panel-btn-primary panel-confirm-close">Guardar</button>
        <p class="panel-error" style="display:none;"></p>
      </div>
    `;
    const amountInput = slot.querySelector('.pf-amount');
    const paidHowSelect = slot.querySelector('.pf-paidhow');
    const redeemInput = slot.querySelector('.pf-redeem');
    const splitToggle = slot.querySelector('.pf-split');
    const splitRow = slot.querySelector('.pf-split-row');
    const amount2Input = slot.querySelector('.pf-amount2');
    const paidHow2Select = slot.querySelector('.pf-paidhow2');
    const errorEl = slot.querySelector('.panel-error');
    splitToggle.addEventListener('change', () => {
      splitRow.style.display = splitToggle.checked ? 'grid' : 'none';
    });
    slot.querySelector('.panel-confirm-close').addEventListener('click', async (ev) => {
      errorEl.style.display = 'none';
      ev.target.disabled = true;
      try {
        await panelFetch('/panel/close', {
          method: 'POST',
          body: JSON.stringify({
            bookingId: b.bookingId, finalAmount: amountInput.value, paidHow: paidHowSelect.value,
            remainderAmount2: splitToggle.checked ? amount2Input.value : 0,
            paidHow2: splitToggle.checked ? paidHow2Select.value : '',
            redeemAmount: redeemInput ? redeemInput.value : 0,
          }),
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
