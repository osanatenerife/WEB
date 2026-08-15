// ============================================================
// OSANA — Panel interno (búsqueda de clienta, historial, bonos,
// notas, reprogramar y marcar ausencias). Solo para el equipo.
// ============================================================
(function () {
  const KEY_STORAGE = 'osana_panel_key';
  let panelKey = localStorage.getItem(KEY_STORAGE) || '';

  // Cualquier texto que venga de un cliente (nombre, nota, mensaje de bono
  // regalo...) tiene que pasar por aquí antes de insertarse en innerHTML —
  // si no, un nombre tipo "<img src=x onerror=...>" se ejecutaría en el
  // navegador de cualquier persona del equipo que abra esa ficha.
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str === undefined || str === null ? '' : String(str);
    return div.innerHTML;
  }

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
    reportToggle: document.getElementById('panel-report-toggle'),
    reportSlot: document.getElementById('panel-report-slot'),
    paymentsToggle: document.getElementById('panel-payments-toggle'),
    paymentsSlot: document.getElementById('panel-payments-slot'),
    quoteToggle: document.getElementById('panel-quote-toggle'),
    quoteSlot: document.getElementById('panel-quote-slot'),
    modeExistingBtn: document.getElementById('panel-mode-existing-btn'),
    modeNewBtn: document.getElementById('panel-mode-new-btn'),
    existingView: document.getElementById('panel-existing-view'),
    newView: document.getElementById('panel-new-view'),
    newclientSlot: document.getElementById('panel-newclient-slot'),
    agendaToggle: document.getElementById('panel-agenda-toggle'),
    agendaSlot: document.getElementById('panel-agenda-slot'),
    giftToggle: document.getElementById('panel-gift-toggle'),
    giftSlot: document.getElementById('panel-gift-slot'),
    discountToggle: document.getElementById('panel-discount-toggle'),
    discountSlot: document.getElementById('panel-discount-slot'),
    campaignToggle: document.getElementById('panel-campaign-toggle'),
    campaignSlot: document.getElementById('panel-campaign-slot'),
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
    refreshAgendaBadge();
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

  // ── Comprobar cobros: para un rango de fechas, todo lo cerrado (citas +
  // extras) con su forma de pago y un total por forma de pago — para cuadrar
  // caja/Bizum/tarjeta sin tener que abrir clienta por clienta. ──
  els.paymentsToggle.addEventListener('click', () => {
    if (els.paymentsSlot.innerHTML) { els.paymentsSlot.innerHTML = ''; return; }
    const today = new Date().toISOString().slice(0, 10);
    els.paymentsSlot.innerHTML = `
      <div class="panel-new-appt">
        <div class="panel-label">Comprobar cobros (cuadre de caja)</div>
        <p class="panel-status" style="margin-bottom:10px;">Todo lo cobrado en el rango de fechas, con su forma de pago — para comparar con lo que tienes en caja, Bizum o datáfono. La seña pagada online (Stripe) no cuenta en los totales porque no pasa por el centro; se muestra solo como referencia junto a cada cita.</p>
        <div class="panel-field-row">
          <div class="panel-field"><label>Desde</label><input type="date" class="pp-from" value="${today}"></div>
          <div class="panel-field"><label>Hasta</label><input type="date" class="pp-to" value="${today}"></div>
          <div class="panel-field"><button type="button" class="panel-btn panel-btn-primary pp-search">Buscar</button></div>
        </div>
        <p class="panel-error" style="display:none;"></p>
        <div class="pp-result"></div>
      </div>
    `;
    const slot = els.paymentsSlot;
    const fromInput = slot.querySelector('.pp-from');
    const toInput = slot.querySelector('.pp-to');
    const errorEl = slot.querySelector('.panel-error');
    const resultEl = slot.querySelector('.pp-result');

    async function runSearch() {
      errorEl.style.display = 'none';
      resultEl.innerHTML = '<p class="panel-status">Buscando…</p>';
      try {
        const data = await panelFetch(`/panel/payments-log?from=${fromInput.value}&to=${toInput.value}`, { method: 'GET' });
        const totalsEntries = Object.entries(data.totals || {});
        const totalsHtml = totalsEntries.length
          ? `<p class="panel-status" style="margin:10px 0;"><b>Totales del rango:</b> ${totalsEntries.map(([k, v]) => `${k}: <b>${v.toFixed(2)} €</b>`).join(' · ')}</p>`
          : '<p class="panel-status">No hay cobros registrados en ese rango.</p>';

        // Cuántas líneas tienen la forma de pago sin asignar — antes había
        // que leer toda la lista de citas y extras una por una para
        // encontrarlas; ahora se ve de un vistazo arriba del todo.
        const unassignedCount = (data.closedBookings || []).reduce((n, b) => {
          const part1 = b.remainder - b.remainderAmount2;
          return n + (part1 > 0 && !b.remainderPaidHow ? 1 : 0) + (b.remainderAmount2 > 0 && !b.remainderPaidHow2 ? 1 : 0);
        }, 0) + (data.extraLines || []).filter((e) => !e.paidHow).length;
        const unassignedHtml = unassignedCount > 0
          ? `<p class="panel-error" style="display:block;margin:0 0 10px;">⚠️ ${unassignedCount} cobro${unassignedCount === 1 ? '' : 's'} sin forma de pago asignada en este rango — búscalos abajo (⚠️ sin asignar) y complétalos antes de cuadrar caja.</p>`
          : '';

        const payMethodOptions = (selected) => ['efectivo', 'tarjeta', 'bizum', 'bonos archipiélago', 'bono adeje']
          .map((v) => `<option value="${v}"${v === selected ? ' selected' : ''}>${v.charAt(0).toUpperCase() + v.slice(1)}</option>`).join('');

        const bookingsHtml = (data.closedBookings || []).map((b) => {
          const part1 = b.remainder - b.remainderAmount2;
          const parts = [];
          if (part1 > 0) parts.push(`${part1.toFixed(2)} € (${b.remainderPaidHow || '⚠️ sin asignar'})`);
          if (b.remainderAmount2 > 0) parts.push(`${b.remainderAmount2.toFixed(2)} € (${b.remainderPaidHow2 || '⚠️ sin asignar'})`);
          return `
            <div class="line-item" data-booking-id="${b.bookingId}">
              <div class="line-item-row">
                <div class="line-item-main"><div class="line-item-name">${escapeHtml(b.name)} <span class="line-item-meta">${b.date} ${b.time} · ${escapeHtml(b.serviceName)}</span></div></div>
                <div class="line-item-price">${b.finalAmount.toFixed(2)} €</div>
              </div>
              <div class="line-item-meta" style="padding:0 0 8px;">
                ${b.onlinePaid > 0 ? `${b.depositPaidHow ? `Pagado por adelantado en el centro: ${b.onlinePaid.toFixed(2)} € (${b.depositPaidHow})` : `Seña online: ${b.onlinePaid.toFixed(2)} €`} · ` : ''}${b.redeemed > 0 ? `Saldo canjeado: ${b.redeemed.toFixed(2)} € · ` : ''}En el centro: ${parts.length ? parts.join(' + ') : '0.00 €'}
              </div>
              <div class="pp-edit-row">
                <button type="button" class="panel-btn panel-btn-ghost panel-btn-sm pp-edit-toggle">✎ Editar</button>
                <button type="button" class="panel-btn panel-btn-ghost panel-btn-sm pp-goto-client" data-phone="${escapeHtml(b.phone || '')}">Ver ficha (corregir datos de la clienta)</button>
              </div>
              <div class="pp-edit-form" style="display:none;">
                <div class="panel-field-row">
                  <div class="panel-field"><label>Importe total (€)</label><input type="number" step="0.01" class="pp-edit-amount" value="${b.finalAmount}"></div>
                  <div class="panel-field"><label>Pagado con</label><select class="pp-edit-paidhow">${payMethodOptions(b.remainderPaidHow)}</select></div>
                </div>
                ${b.remainderAmount2 > 0 ? `
                <div class="panel-field-row">
                  <div class="panel-field"><label>Importe con la 2ª forma (€)</label><input type="number" step="0.01" class="pp-edit-amount2" value="${b.remainderAmount2}"></div>
                  <div class="panel-field"><label>2ª forma de pago</label><select class="pp-edit-paidhow2">${payMethodOptions(b.remainderPaidHow2)}</select></div>
                </div>` : ''}
                <button type="button" class="panel-btn panel-btn-primary panel-btn-sm pp-edit-save">Guardar corrección</button>
                <p class="panel-error pp-edit-error" style="display:none;"></p>
              </div>
            </div>`;
        }).join('') || '<p class="panel-status">Sin citas cerradas en este rango.</p>';

        const extrasHtml = (data.extraLines || []).map((e) => `
          <div class="line-item" data-sale-id="${e.saleId || ''}">
            <div class="line-item-row">
              <div class="line-item-main"><div class="line-item-name">${escapeHtml(e.product)} <span class="line-item-meta">${e.date} · extra${e.bookingId ? '' : ' suelto'}</span></div></div>
              <div class="line-item-price">${e.amount.toFixed(2)} €</div>
            </div>
            <div class="line-item-meta" style="padding:0 0 8px;">Pagado con: ${e.paidHow || '⚠️ sin asignar'}</div>
            ${e.saleId ? `
            <div class="pp-edit-row">
              <button type="button" class="panel-btn panel-btn-ghost panel-btn-sm pp-edit-extra-toggle">✎ Editar</button>
            </div>
            <div class="pp-edit-extra-form" style="display:none;">
              <div class="panel-field-row">
                <div class="panel-field"><label>Importe (€)</label><input type="number" step="0.01" class="pp-edit-extra-amount" value="${e.amount}"></div>
                <div class="panel-field"><label>Pagado con</label><select class="pp-edit-extra-paidhow">${payMethodOptions(e.paidHow)}</select></div>
              </div>
              <button type="button" class="panel-btn panel-btn-primary panel-btn-sm pp-edit-extra-save">Guardar corrección</button>
              <p class="panel-error pp-edit-extra-error" style="display:none;"></p>
            </div>` : ''}
          </div>`).join('') || '<p class="panel-status">Sin extras en este rango.</p>';

        const depositsHtml = (data.advanceDeposits || []).map((d) => `
          <div class="line-item">
            <div class="line-item-row">
              <div class="line-item-main"><div class="line-item-name">${escapeHtml(d.name)} <span class="line-item-meta">${d.date} · seña de la cita del ${d.apptDate} ${d.apptTime} · ${escapeHtml(d.serviceName)}</span></div></div>
              <div class="line-item-price">${d.amount.toFixed(2)} €</div>
            </div>
            <div class="line-item-meta" style="padding:0 0 8px;">Pagado con: ${d.paidHow}</div>
          </div>`).join('') || '<p class="panel-status">Sin señas cobradas en persona en este rango.</p>';

        resultEl.innerHTML = `
          ${unassignedHtml}
          ${totalsHtml}
          <div class="panel-section-label">Señas/pagos por adelantado cobrados en persona</div>
          <p class="panel-status" style="margin:0 0 10px;">Contados el día en que se cobraron de verdad, no el día de la cita.</p>
          ${depositsHtml}
          <div class="panel-section-label">Citas cerradas</div>
          ${bookingsHtml}
          <div class="panel-section-label">Extras</div>
          ${extrasHtml}
        `;

        // ── Corregir un importe/forma de pago con error, sin salir de
        // Comprobar cobros — reutiliza /panel/close, que ya sabe actualizar
        // una cita que ya estaba cerrada sin duplicar puntos ni canjes. ──
        resultEl.querySelectorAll('.pp-edit-toggle').forEach((btn) => {
          btn.addEventListener('click', () => {
            const form = btn.closest('.line-item').querySelector('.pp-edit-form');
            form.style.display = form.style.display === 'none' ? 'block' : 'none';
          });
        });
        resultEl.querySelectorAll('.pp-goto-client').forEach((btn) => {
          btn.addEventListener('click', () => jumpToClient(btn.dataset.phone));
        });
        resultEl.querySelectorAll('.pp-edit-save').forEach((btn) => {
          btn.addEventListener('click', async (ev) => {
            const row = btn.closest('.line-item');
            const bookingId = row.dataset.bookingId;
            const amountInput = row.querySelector('.pp-edit-amount');
            const paidHowSelect = row.querySelector('.pp-edit-paidhow');
            const amount2Input = row.querySelector('.pp-edit-amount2');
            const paidHow2Select = row.querySelector('.pp-edit-paidhow2');
            const errorEl2 = row.querySelector('.pp-edit-error');
            errorEl2.style.display = 'none';
            ev.target.disabled = true;
            try {
              await panelFetch('/panel/close', {
                method: 'POST',
                body: JSON.stringify({
                  bookingId, finalAmount: amountInput.value, paidHow: paidHowSelect.value,
                  remainderAmount2: amount2Input ? amount2Input.value : 0,
                  paidHow2: amount2Input ? paidHow2Select.value : '',
                }),
              });
              runSearch();
            } catch (e) {
              errorEl2.textContent = e.message;
              errorEl2.style.display = 'block';
              ev.target.disabled = false;
            }
          });
        });
        resultEl.querySelectorAll('.pp-edit-extra-toggle').forEach((btn) => {
          btn.addEventListener('click', () => {
            const form = btn.closest('.line-item').querySelector('.pp-edit-extra-form');
            form.style.display = form.style.display === 'none' ? 'block' : 'none';
          });
        });
        resultEl.querySelectorAll('.pp-edit-extra-save').forEach((btn) => {
          btn.addEventListener('click', async (ev) => {
            const row = btn.closest('.line-item');
            const saleId = row.dataset.saleId;
            const amountInput = row.querySelector('.pp-edit-extra-amount');
            const paidHowSelect = row.querySelector('.pp-edit-extra-paidhow');
            const errorEl2 = row.querySelector('.pp-edit-extra-error');
            errorEl2.style.display = 'none';
            ev.target.disabled = true;
            try {
              await panelFetch('/panel/product-sale-edit', {
                method: 'POST',
                body: JSON.stringify({ saleId, amount: amountInput.value, paidHow: paidHowSelect.value }),
              });
              runSearch();
            } catch (e) {
              errorEl2.textContent = e.message;
              errorEl2.style.display = 'block';
              ev.target.disabled = false;
            }
          });
        });
      } catch (e) {
        errorEl.textContent = e.message;
        errorEl.style.display = 'block';
        resultEl.innerHTML = '';
      }
    }
    slot.querySelector('.pp-search').addEventListener('click', runSearch);
    runSearch();
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
        const waText = encodeURIComponent(`Hola ${nameInput.value.trim()}, aquí tienes el link para pagar tu presupuesto (${descInput.value.trim()}, ${Number(amountInput.value).toFixed(2)} €): ${data.url}\n\nPuedes pagarlo de una vez o fraccionarlo en 3 pagos sin intereses con Klarna — al entrar al link, elige la opción Klarna y te dejará elegir cómo dividirlo.`);
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

  // Igual que loadImportServicesOnce: la lista completa de empleadas apenas
  // cambia durante una sesión de trabajo, así que no hace falta volver a
  // pedirla cada vez que se abre "Editar cita" — antes era una petición de
  // red extra en cada apertura.
  let allEmployeesCache = null;
  async function loadAllEmployeesOnce() {
    if (allEmployeesCache) return allEmployeesCache;
    const res = await fetch(`${BOOKING_API_BASE}/employees`);
    const data = await res.json();
    allEmployeesCache = data.employees || [];
    return allEmployeesCache;
  }

  // ── Clienta existente / clienta nueva: un único punto de entrada al
  // principio del panel, en vez de tener que adivinar cuál de varios
  // botones del todo de arriba usar para dar de alta a alguien nueva. ──
  function setClientMode(mode) {
    const isNew = mode === 'new';
    els.modeExistingBtn.classList.toggle('panel-mode-btn-active', !isNew);
    els.modeNewBtn.classList.toggle('panel-mode-btn-active', isNew);
    els.existingView.style.display = isNew ? 'none' : 'block';
    els.newView.style.display = isNew ? 'block' : 'none';
    if (isNew && !els.newclientSlot.innerHTML) renderVisitBuilder(els.newclientSlot, null);
  }
  els.modeExistingBtn.addEventListener('click', () => setClientMode('existing'));
  els.modeNewBtn.addEventListener('click', () => setClientMode('new'));

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
    setClientMode('existing');
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

  // Número en el propio botón "Agenda", para saber si hay algo urgente sin
  // tener que entrar a mirar — se pide una sola vez al cargar el panel.
  async function refreshAgendaBadge() {
    try {
      const data = await panelFetch('/panel/agenda-summary');
      const n = Number(data.attentionCount) || 0;
      els.agendaToggle.innerHTML = `📋 Agenda${n > 0 ? ` <span class="panel-agenda-badge">${n}</span>` : ''}`;
    } catch (e) { /* si falla, el botón se queda sin número — no es crítico */ }
  }

  function agendaSection(title, emptyMsg, rowsHtml) {
    return `
      <div class="panel-section-label">${title}</div>
      ${rowsHtml || `<p class="panel-status">${emptyMsg}</p>`}
    `;
  }
  function agendaRow(mainHtml, phone, extraButtonsHtml, crit) {
    return `
      <div class="panel-agenda-row${crit ? ' panel-agenda-row-crit' : ''}">
        <div>${mainHtml}</div>
        <div class="actions">
          ${extraButtonsHtml || ''}
          <button type="button" class="panel-btn panel-btn-ghost panel-btn-sm agenda-search-btn" data-phone="${phone || ''}">Ver ficha</button>
        </div>
      </div>
    `;
  }

  function renderAgenda(data) {
    // ── ⚠️ Necesita atención ya: citas sin cerrar + bonos con el
    // tratamiento roto + cobros recientes sin forma de pago asignada —
    // todo lo que puede complicar la contabilidad si no se arregla ya. ──
    const unclosedRows = data.unclosedBookings.map((b) => agendaRow(
      `<b>${escapeHtml(b.name) || '(sin nombre)'}</b> — ${escapeHtml(b.serviceName)} · ${fmtDateShort(b.date)} ${b.time} · ${escapeHtml(b.employeeName) || ''} <span class="panel-agenda-tag panel-agenda-tag-crit">Sin cerrar</span>`,
      b.phone, '', true,
    ));
    const brokenRows = (data.brokenServiceBonos || []).map((bono) => agendaRow(
      `<b>${escapeHtml(bono.clientName) || '(sin nombre)'}</b> — bono de ${escapeHtml(bono.serviceName)} <span class="panel-agenda-tag panel-agenda-tag-crit">Tratamiento del bono roto</span>`,
      bono.clientPhone, '', true,
    ));
    const unassignedRows = (data.unassignedPayments || []).map((p) => agendaRow(
      `<b>${escapeHtml(p.name) || (p.isExtra ? 'Venta suelta' : '(sin nombre)')}</b> — ${escapeHtml(p.serviceName)} · ${fmtDateShort(p.date)} <span class="panel-agenda-tag panel-agenda-tag-warn">Forma de pago sin asignar</span>`,
      p.phone, '', false,
    ));
    const attentionHtml = [...unclosedRows, ...brokenRows, ...unassignedRows].join('');
    const attentionCount = unclosedRows.length + brokenRows.length + unassignedRows.length;

    // ── 📅 Hoy: solo hoy expandido, el resto de la semana se pliega. ──
    const todayISO = new Date().toISOString().slice(0, 10);
    const upcomingRow = (b) => {
      const pill = b.finalAmount === null
        ? ''
        : (Math.max(0, b.finalAmount - (b.amountPaid || 0)) > 0.001
          ? '<span class="panel-agenda-tag panel-agenda-tag-warn">Pendiente</span>'
          : '<span class="panel-agenda-tag panel-agenda-tag-ok">✓ Pagado</span>');
      return agendaRow(
        `<b>${escapeHtml(b.name) || '(sin nombre)'}</b> — ${escapeHtml(b.serviceName)} · ${b.time} · ${escapeHtml(b.employeeName) || ''} ${pill}`,
        b.phone,
      );
    };
    const todayBookings = data.upcomingBookings.filter((b) => b.date === todayISO);
    const restBookings = data.upcomingBookings.filter((b) => b.date !== todayISO);
    const todayHtml = todayBookings.map(upcomingRow).join('');
    const restHtml = restBookings.length
      ? `<button type="button" class="panel-link-btn panel-agenda-showrest" style="margin:4px 0 10px;">Ver mañana y resto de la semana (${restBookings.length}) ▸</button>
         <div class="panel-agenda-rest" style="display:none;">${restBookings.map(upcomingRow).join('')}</div>`
      : '';

    // ── 🎟️ Bonos que necesitan una cita: junta "sin agendar" y "caduca
    // pronto" en una sola lista, más urgente primero. ──
    const bonoMap = new Map();
    data.pendingBonoSessions.forEach((bono) => {
      bonoMap.set(bono.bonoId, { ...bono, pending: true });
    });
    data.expiringBonos.forEach((bono) => {
      const existing = bonoMap.get(bono.bonoId) || { ...bono };
      bonoMap.set(bono.bonoId, { ...existing, ...bono, expiring: true });
    });
    const bonoRows = Array.from(bonoMap.values()).sort((a, b) => {
      const score = (x) => (x.pending && x.expiring ? 0 : x.expiring ? 1 : 2);
      return score(a) - score(b);
    });
    const bonosHtml = bonoRows.map((bono) => {
      const tags = [];
      if (bono.expiring) tags.push(`<span class="panel-agenda-tag panel-agenda-tag-warn">Caduca ${fmtDateShort(bono.expiryDate)}</span>`);
      if (bono.pending && !bono.expiring) tags.push('<span class="panel-agenda-tag">Sin agendar</span>');
      const meta = bono.sessionsRemaining !== undefined
        ? `${bono.sessionsRemaining} sesión(es) sin usar`
        : `${bono.sessionsUsed}/${bono.totalSessions} usadas`;
      return agendaRow(
        `<b>${escapeHtml(bono.clientName) || '(sin nombre)'}</b> — ${escapeHtml(bono.serviceName)} (${meta}) ${tags.join(' ')}`,
        bono.clientPhone,
      );
    }).join('');

    // ── 🔔 Seguimientos y presupuestos: lo de menos prisa, al final. ──
    const followupsHtml = data.dueFollowups.map((f) => agendaRow(
      `<b>${escapeHtml(f.clientName) || '(sin nombre)'}</b> — vence ${fmtDateShort(f.dueDate)}${f.note ? ` · ${escapeHtml(f.note)}` : ''}`,
      f.clientPhone,
      `<button type="button" class="panel-btn panel-btn-primary panel-btn-sm agenda-followup-done" data-id="${f.followupId}">Hecho ✓</button>`,
    )).join('');
    const quotesHtml = data.unpaidQuotes.map((q) => agendaRow(
      `<b>${escapeHtml(q.clientName) || '(sin nombre)'}</b> — ${escapeHtml(q.description)} · ${Number(q.amount).toFixed(2)} €`,
      q.clientPhone,
    )).join('');

    els.agendaSlot.innerHTML = `
      <div class="panel-new-appt">
        <div class="panel-agenda-summary">
          <div class="panel-agenda-stat panel-agenda-stat-crit"><b>${attentionCount}</b><span>necesitan atención</span></div>
          <div class="panel-agenda-stat"><b>${todayBookings.length}</b><span>citas hoy</span></div>
          <div class="panel-agenda-stat"><b>${bonoRows.length}</b><span>bonos por agendar</span></div>
        </div>
        ${agendaSection('⚠️ Necesita atención ya', 'Nada urgente — todo en orden.', attentionHtml)}
        ${agendaSection('📅 Hoy', 'No hay citas hoy.', todayHtml + restHtml)}
        ${agendaSection('🎟️ Bonos que necesitan una cita', 'No hay bonos pendientes de agendar.', bonosHtml)}
        ${agendaSection('🔔 Seguimientos y presupuestos', 'No hay nada pendiente.', followupsHtml + quotesHtml)}
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
          refreshAgendaBadge();
        } catch (e) {
          btn.disabled = false;
        }
      });
    });
    const showRestBtn = els.agendaSlot.querySelector('.panel-agenda-showrest');
    if (showRestBtn) {
      showRestBtn.addEventListener('click', () => {
        els.agendaSlot.querySelector('.panel-agenda-rest').style.display = 'block';
        showRestBtn.style.display = 'none';
      });
    }
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
              <div class="panel-client-meta"><span>De ${escapeHtml(gift.buyerName) || '—'} para ${escapeHtml(gift.recipientName) || '—'}</span></div>
            </div>
            ${statusPill}
          </div>
          <p style="font-size:13px;margin:12px 0 4px;"><b>${escapeHtml(itemLabel)}</b></p>
          <p style="font-size:12.5px;color:var(--ink-soft);margin:0 0 4px;">Comprador: ${escapeHtml(gift.buyerEmail) || '—'}${gift.buyerPhone ? ` · ${escapeHtml(gift.buyerPhone)}` : ''}</p>
          <p style="font-size:12.5px;color:var(--ink-soft);margin:0 0 4px;">Caduca: ${gift.expiryDate ? fmtDateShort(gift.expiryDate) : '—'}</p>
          ${gift.message ? `<p style="font-size:12.5px;color:var(--ink-soft);margin:0 0 4px;">Mensaje: "${escapeHtml(gift.message)}"</p>` : ''}
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

  els.campaignToggle.addEventListener('click', () => {
    if (els.campaignSlot.innerHTML) { els.campaignSlot.innerHTML = ''; return; }
    els.campaignSlot.innerHTML = `
      <div class="panel-new-appt">
        <div class="panel-label">Enviar campaña de email a todas las clientas</div>
        <p style="font-size:12px;color:var(--ink-soft);margin:-4px 0 12px;">Para fechas especiales, artículos, avisos de formaciones... Se envía a todas las clientas con email registrado. Escribe <code>{nombre}</code> donde quieras que aparezca el nombre de cada clienta. Si quieres incluir un código de descuento, créalo antes en "🏷️ Descuentos" y menciónalo en el texto.</p>
        <div class="panel-field"><label>Imagen de cabecera (opcional)</label><input type="file" accept="image/*" class="cp-image"></div>
        <img class="cp-image-preview" style="display:none;width:100%;max-width:420px;margin-top:8px;border-radius:4px;">
        <div class="panel-field" style="margin-top:10px;"><label>Asunto</label><input type="text" class="cp-subject" placeholder="Ej. Feliz Navidad, {nombre}"></div>
        <div class="panel-field" style="margin-top:10px;"><label>Mensaje</label><textarea class="cp-body" rows="8" style="width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:4px;font-family:inherit;font-size:13px;" placeholder="Hola {nombre},&#10;&#10;Escribe aquí el texto del email. Deja una línea en blanco entre párrafos."></textarea></div>
        <div class="panel-field-row" style="margin-top:10px;">
          <div class="panel-field"><label>Texto del botón (opcional)</label><input type="text" class="cp-cta-text" placeholder="Ej. Reserva tu sesión"></div>
          <div class="panel-field"><label>Enlace del botón</label><input type="text" class="cp-cta-url" placeholder="https://osana.es/reserva.html"></div>
        </div>
        <button type="button" class="panel-btn panel-btn-primary panel-confirm-campaign" style="margin-top:12px;">Enviar a todas las clientas</button>
        <p class="panel-error" style="display:none;"></p>
        <p class="panel-status" style="display:none;"></p>
      </div>
    `;
    const slot = els.campaignSlot;
    const imageInput = slot.querySelector('.cp-image');
    const imagePreview = slot.querySelector('.cp-image-preview');
    const subjectInput = slot.querySelector('.cp-subject');
    const bodyInput = slot.querySelector('.cp-body');
    const ctaTextInput = slot.querySelector('.cp-cta-text');
    const ctaUrlInput = slot.querySelector('.cp-cta-url');
    const errorEl = slot.querySelector('.panel-error');
    const statusEl = slot.querySelector('.panel-status');

    let headerImageDataUrl = '';
    imageInput.addEventListener('change', () => {
      const file = imageInput.files[0];
      errorEl.style.display = 'none';
      if (!file) { headerImageDataUrl = ''; imagePreview.style.display = 'none'; return; }
      if (file.size > 4 * 1024 * 1024) {
        errorEl.textContent = 'La imagen pesa demasiado, usa una de menos de 4 MB.';
        errorEl.style.display = 'block';
        imageInput.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        headerImageDataUrl = reader.result;
        imagePreview.src = headerImageDataUrl;
        imagePreview.style.display = 'block';
      };
      reader.readAsDataURL(file);
    });

    slot.querySelector('.panel-confirm-campaign').addEventListener('click', async (ev) => {
      errorEl.style.display = 'none';
      statusEl.style.display = 'none';
      if (!subjectInput.value.trim() || !bodyInput.value.trim()) {
        errorEl.textContent = 'Escribe el asunto y el mensaje.';
        errorEl.style.display = 'block';
        return;
      }
      if (!!ctaTextInput.value.trim() !== !!ctaUrlInput.value.trim()) {
        errorEl.textContent = 'Si añades un botón, indica el texto y el enlace.';
        errorEl.style.display = 'block';
        return;
      }
      if (!confirm('¿Enviar este email a todas las clientas registradas? No se puede deshacer.')) return;
      ev.target.disabled = true;
      try {
        const data = await panelFetch('/panel/campaign-email', {
          method: 'POST',
          body: JSON.stringify({
            subject: subjectInput.value.trim(), body: bodyInput.value.trim(),
            headerImageDataUrl: headerImageDataUrl || undefined,
            ctaText: ctaTextInput.value.trim() || undefined,
            ctaUrl: ctaUrlInput.value.trim() || undefined,
          }),
        });
        statusEl.textContent = `Enviando a ${data.recipients} clientas…`;
        statusEl.style.display = 'block';
      } catch (e) {
        errorEl.textContent = e.message;
        errorEl.style.display = 'block';
        ev.target.disabled = false;
      }
    });
  });

  function renderClient(client) {
    const wrap = document.createElement('div');

    const strikeBadge = client.strikeCount > 0
      ? `<span class="panel-pill panel-pill-warn"><span class="dot"></span>${client.strikeCount} falta${client.strikeCount > 1 ? 's' : ''} registrada${client.strikeCount > 1 ? 's' : ''}</span>`
      : `<span class="panel-pill panel-pill-ok"><span class="dot"></span>Sin faltas</span>`;
    const balance = Number(client.loyaltyBalance) || 0;

    // Citas de esta clienta ya pasadas (o de hoy) que todavía no se han
    // cerrado — se destacan arriba del todo para poder cobrarlas sin
    // tener que bajar a buscarlas entre el resto del historial.
    const unclosedToday = client.bookings.filter((b) => b.status === 'confirmed' && b.isPast
      && (b.finalAmount === null || b.finalAmount === undefined));
    const unclosedHtml = unclosedToday.length ? `
      <div class="panel-client-unclosed">
        <div class="panel-client-unclosed-label">📌 Sin cerrar</div>
        ${unclosedToday.map((b) => `
          <div class="panel-client-unclosed-row">
            <span>${escapeHtml(b.serviceName)} · ${fmtDateShort(b.date)} ${b.time}</span>
            <div class="panel-client-unclosed-actions">
              <button type="button" class="panel-btn panel-btn-primary panel-btn-sm panel-unclosed-close" data-booking-id="${b.bookingId}">💶 Cerrar y cobrar</button>
              <button type="button" class="panel-btn panel-btn-ghost panel-btn-sm panel-unclosed-resched" data-booking-id="${b.bookingId}">🗓️ Reprogramar</button>
              <button type="button" class="panel-btn panel-btn-ghost panel-btn-sm panel-unclosed-noshow" data-booking-id="${b.bookingId}">🚫 No se presentó</button>
            </div>
          </div>
        `).join('')}
      </div>
    ` : '';

    wrap.innerHTML = `
      <div class="panel-client-card">
        <div class="panel-client-top">
          <div>
            <div class="panel-client-name">${escapeHtml(client.name) || '(sin nombre)'}</div>
            <div class="panel-client-meta"><span>${escapeHtml(client.phone) || ''}</span><span>${escapeHtml(client.email) || ''}</span></div>
          </div>
          ${strikeBadge}
        </div>
        <div class="panel-client-loyalty">
          <span class="panel-pill">💶 Saldo: ${balance.toFixed(2)} €</span>
          <button type="button" class="panel-btn panel-btn-accent panel-btn-sm panel-visitbuilder-toggle">+ Nueva visita</button>
        </div>
        <div class="panel-client-minilinks">
          ${balance > 0 ? '<button type="button" class="panel-link-btn panel-redeem-toggle">Canjear saldo</button>' : ''}
          <button type="button" class="panel-link-btn panel-addloyalty-toggle">➕ Añadir saldo</button>
          <button type="button" class="panel-link-btn panel-followup-toggle">🔔 Marcar seguimiento</button>
          <button type="button" class="panel-link-btn panel-editclient-toggle">✎ Editar datos</button>
        </div>
        <div class="panel-redeem-slot"></div>
        <div class="panel-addloyalty-slot"></div>
        <div class="panel-followup-slot"></div>
        <div class="panel-editclient-slot"></div>
        <div class="panel-visitbuilder-slot"></div>
        ${unclosedHtml}
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

    wrap.querySelector('.panel-editclient-toggle').addEventListener('click', () => toggleEditClient(wrap, client));

    wrap.querySelector('.panel-visitbuilder-toggle').addEventListener('click', () => {
      const vbSlot = wrap.querySelector('.panel-visitbuilder-slot');
      if (vbSlot.innerHTML) { vbSlot.innerHTML = ''; return; }
      renderVisitBuilder(vbSlot, client);
    });

    const bonosContainer = wrap.querySelector('.panel-bonos');
    client.bonos.forEach((bono) => bonosContainer.appendChild(renderBono(bono)));

    const apptsContainer = wrap.querySelector('.panel-appts');
    client.bookings.forEach((b) => apptsContainer.appendChild(renderAppt(b, client, wrap)));

    // El botón "Cerrar y cobrar" de arriba abre el mismo panel de "Editar
    // cita" que ya existe abajo, en vez de duplicar el flujo de cobro —
    // solo ahorra tener que buscar la cita entre todo el historial.
    function findApptEl(bookingId) {
      const id = window.CSS && CSS.escape ? CSS.escape(bookingId) : bookingId;
      return apptsContainer.querySelector(`.panel-appt[data-booking-id="${id}"]`);
    }
    wrap.querySelectorAll('.panel-unclosed-close').forEach((btn) => {
      btn.addEventListener('click', () => {
        const apptEl = findApptEl(btn.dataset.bookingId);
        if (!apptEl) return;
        const toggleBtn = apptEl.querySelector('.panel-editbooking-toggle');
        if (toggleBtn && !apptEl.querySelector('.panel-editbooking-slot').innerHTML) toggleBtn.click();
        apptEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
    wrap.querySelectorAll('.panel-unclosed-resched').forEach((btn) => {
      btn.addEventListener('click', () => {
        const apptEl = findApptEl(btn.dataset.bookingId);
        if (!apptEl) return;
        const toggleBtn = apptEl.querySelector('.panel-reschedule-toggle');
        if (toggleBtn && !apptEl.querySelector('.panel-reschedule-slot').innerHTML) toggleBtn.click();
        apptEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
    wrap.querySelectorAll('.panel-unclosed-noshow').forEach((btn) => {
      btn.addEventListener('click', () => {
        const apptEl = findApptEl(btn.dataset.bookingId);
        if (!apptEl) return;
        const realBtn = apptEl.querySelector('.panel-noshow-btn');
        if (realBtn) realBtn.click();
      });
    });

    els.results.appendChild(wrap);
  }

  // ── "+ Nueva visita": pantalla única que reemplaza los antiguos botones
  // separados "Nueva reserva" y "Agendar próxima sesión" — se marcan los
  // bonos activos y/o se añaden tratamientos del catálogo, y se agenda
  // todo junto. Reutiliza los mismos endpoints de siempre (book-session,
  // book-combined-sessions, import-legacy-booking) — no se ha inventado
  // ningún mecanismo de reserva nuevo, solo se junta la pantalla.
  //
  // Límite real conocido: agendar un bono YA EXISTENTE junto con un
  // tratamiento NUEVO del catálogo, en el mismo hueco, no está soportado
  // hoy por ningún endpoint (ninguno crea un evento de calendario
  // compartido entre los dos casos a la vez) — si se marcan los dos a la
  // vez, se avisa en vez de fingir que funciona.
  async function renderVisitBuilder(slot, client, prefill) {
    slot.innerHTML = `<div class="panel-new-appt"><p class="panel-status">Cargando…</p></div>`;
    const allServices = await loadImportServicesOnce();
    const byCategory = {};
    allServices.forEach((s) => { (byCategory[s.category] = byCategory[s.category] || []).push(s); });
    const catalogOptionsHtml = Object.keys(byCategory).map((cat) => `
      <optgroup label="${cat}">
        ${byCategory[cat].map((s) => `<option value="${s.id}">${s.name} — ${s.price} €</option>`).join('')}
      </optgroup>
    `).join('');

    function resolveServiceId(bo) {
      if (allServices.find((s) => s.id === bo.serviceId)) return bo.serviceId;
      return (allServices.find((s) => s.name === bo.serviceName) || {}).id || '';
    }
    // Si el bono tiene marcado "¿Hoy toca otro tratamiento?", ese id manda
    // sobre el del bono en sí — para calcular bien duración/huecos/profesional.
    function bonoEffectiveServiceId(bo) {
      const ov = vbState.overrides[bo.bonoId];
      return (ov && ov.serviceId) || resolveServiceId(bo);
    }

    // client === null significa "clienta nueva, todavía sin ficha" — mismo
    // formulario, pero sin bonos que marcar y con nombre/teléfono/email a
    // rellenar a mano (antes esto vivía en un formulario aparte,
    // "Añadir reserva manual", con su propio flujo independiente).
    const isNewClient = !client;
    const activeBonos = isNewClient ? [] : client.bonos.filter((bo) => bo.sessionsRemaining > 0);
    const vbState = {
      selectedBonoIds: [],
      added: [], // { localId, serviceId, isBono, bonoSessions, bonoPrice, bonoPriceTouched }
      whenMode: 'new',
      editingIdx: null,
      overrides: {}, // bonoId -> { open, serviceId } — "¿hoy toca otro tratamiento?"
      sessionEdits: {}, // bonoId -> { open, used, total } — "✎ corregir sesiones"
      // Nombre/teléfono/email/profesional/fecha/hora se guardan aquí y no
      // solo en el DOM — cada vez que se marca un bono o se añade un
      // tratamiento, toda la pantalla se vuelve a dibujar de cero, y sin
      // esto lo ya escrito (p.ej. el nombre de una clienta nueva) se
      // perdía en cada cambio.
      ncName: '', ncPhone: '', ncEmail: '', ncBirthdate: '',
      employeeId: (prefill && prefill.employeeId) || '', date: '', time: '',
    };
    let nextLocalId = 1;
    // "Agendar próxima sesión" desde una cita ya existente — precarga los
    // mismos tratamientos (sueltos, no bonos) para no tener que volver a
    // elegirlos uno a uno; se pueden quitar los que no toque repetir antes
    // de confirmar la nueva fecha/hora.
    if (prefill && Array.isArray(prefill.addServiceIds)) {
      prefill.addServiceIds.forEach((id) => {
        if (allServices.find((s) => s.id === id)) {
          vbState.added.push({ localId: nextLocalId++, serviceId: id, isBono: false });
        }
      });
    }

    function mode() {
      const hasBono = vbState.selectedBonoIds.length > 0;
      const hasCatalog = vbState.added.length > 0;
      if (hasBono && hasCatalog) return 'mixed';
      if (hasBono) return vbState.selectedBonoIds.length > 1 ? 'multi-bono' : 'single-bono';
      if (hasCatalog) return 'catalog';
      return 'empty';
    }

    function picksHtml() {
      return activeBonos.map((bo) => {
        const checked = vbState.selectedBonoIds.includes(bo.bonoId);
        const owes = Number(bo.remainingAmount) > 0;
        const ov = vbState.overrides[bo.bonoId] || {};
        const se = vbState.sessionEdits[bo.bonoId] || {};
        let extra = '';
        if (checked) {
          const ovName = ov.serviceId ? (allServices.find((s) => s.id === ov.serviceId) || {}).name : '';
          extra += `<button type="button" class="vb-mini-link vb-override-toggle" data-bono="${bo.bonoId}">🔁 ${ovName ? `Hoy: ${escapeHtml(ovName)} (cambiar)` : '¿Hoy toca otro tratamiento?'}</button>`;
          extra += `<button type="button" class="vb-mini-link vb-sessionedit-toggle" data-bono="${bo.bonoId}">✎ corregir sesiones</button>`;
          if (ov.open) {
            extra += `<select class="vb-override-select" data-bono="${bo.bonoId}">
              <option value="">Usar el tratamiento del bono (${escapeHtml(bo.serviceName)})</option>
              ${catalogOptionsHtml}
            </select>`;
          }
          if (se.open) {
            extra += `<div class="vb-sessionedit-inline">
              <div class="panel-field-row">
                <div class="panel-field"><label>Sesiones ya usadas de verdad</label><input type="number" min="0" step="1" class="vb-se-used" data-bono="${bo.bonoId}" value="${se.used !== undefined ? se.used : bo.sessionsUsed}"></div>
                <div class="panel-field"><label>Total de sesiones del bono</label><input type="number" min="1" step="1" class="vb-se-total" data-bono="${bo.bonoId}" value="${se.total !== undefined ? se.total : bo.totalSessions}"></div>
              </div>
              <button type="button" class="panel-btn panel-btn-accent panel-btn-sm vb-se-save" data-bono="${bo.bonoId}">Guardar corrección</button>
            </div>`;
          }
        }
        return `
        <label class="vb-pick${checked ? ' vb-pick-checked' : ''}${checked && owes ? ' vb-pick-owes' : ''}">
          <input type="checkbox" class="vb-pick-check" value="${bo.bonoId}" ${checked ? 'checked' : ''}>
          <div class="vb-pick-body">
            <div class="vb-pick-name">${escapeHtml(bo.serviceName)}</div>
            <div class="vb-pick-meta">Sesión ${(Number(bo.sessionsUsed) || 0) + 1} de ${bo.totalSessions}${owes ? ` · pendiente de pago del bono: ${bo.remainingAmount.toFixed(2)} €` : ''}</div>
            ${extra ? `<div class="vb-pick-extra">${extra}</div>` : ''}
          </div>
        </label>`;
      }).join('');
    }

    function addedRowHtml(t, idx) {
      const svc = allServices.find((s) => s.id === t.serviceId);
      const editing = vbState.editingIdx === idx;
      let row = `
        <div class="vb-added-wrap">
          <div class="vb-added-row">
            <div class="vb-pick-body">
              <div class="vb-pick-name">${escapeHtml(svc ? svc.name : '')}${t.isBono ? ' <span class="vb-bono-flag">🎟 bono</span>' : ''}</div>
              <div class="vb-pick-meta">${svc ? svc.price + ' €' : ''}</div>
            </div>
            ${!t.isBono && vbState.added.length === 1 ? `<button type="button" class="panel-btn panel-btn-ghost panel-btn-sm vb-convert-bono" data-idx="${idx}">🎟 Es un bono</button>` : ''}
            <button type="button" class="panel-btn panel-btn-ghost panel-btn-sm vb-remove-added" data-idx="${idx}">Quitar</button>
          </div>`;
      if (editing) {
        row += `
          <div class="vb-bono-inline">
            <div class="panel-field-row">
              <div class="panel-field"><label>Total de sesiones del bono</label><input type="number" min="1" step="1" class="vb-bono-sessions" value="${t.bonoSessions || ''}" placeholder="Ej. 2, 3, 6…"></div>
              <div class="panel-field"><label>Esta cita es la sesión nº</label><input type="number" min="1" step="1" class="vb-bono-sessionnum" value="${t.bonoSessionNumber || 1}"></div>
              <div class="panel-field"><label>Precio total del bono (€)</label><input type="number" step="0.01" class="vb-bono-price" value="${t.bonoPrice || ''}" placeholder="Precio a medida"></div>
            </div>
            <p class="field-hint" style="font-size:11px;color:var(--ink-faint);margin:-6px 0 10px;">Si el bono ya se vendió antes y ya tenía sesiones hechas (p.ej. lo estás dando de alta ahora pero ya iba por la 2 de 3), cambia el número de sesión — no hace falta que empiece siempre en 1.</p>
            <div style="display:flex;gap:8px;">
              <button type="button" class="panel-btn panel-btn-accent panel-btn-sm vb-confirm-bono" data-idx="${idx}">Guardar como bono</button>
              <button type="button" class="panel-link-btn vb-cancel-bono" data-idx="${idx}">Cancelar</button>
            </div>
          </div>`;
      }
      row += `</div>`;
      return row;
    }

    function render() {
      const m = mode();
      const durationMinutes = vbState.selectedBonoIds
        .map((id) => activeBonos.find((bo) => bo.bonoId === id))
        .filter(Boolean)
        .reduce((sum, bo) => sum + ((allServices.find((s) => s.id === bonoEffectiveServiceId(bo)) || {}).durationMinutes || 0), 0)
        + vbState.added.reduce((sum, t) => sum + ((allServices.find((s) => s.id === t.serviceId) || {}).durationMinutes || 0), 0);

      const catalogSuggestedPrice = vbState.added.reduce((sum, t) => {
        if (t.isBono) return sum + (Number(t.bonoPrice) || 0);
        const svc = allServices.find((s) => s.id === t.serviceId);
        return sum + (svc ? Number(svc.price) : 0);
      }, 0);

      const canPast = m === 'single-bono' || m === 'catalog';

      slot.innerHTML = `
        <div class="panel-new-appt">
          <div class="panel-label">${isNewClient ? '+ Nueva reserva — clienta nueva' : `+ Nueva visita — ${escapeHtml(client.name) || 'esta clienta'}`}</div>
          <p class="panel-status" style="margin-bottom:10px;">${isNewClient ? 'Rellena sus datos y añade lo que se lleva hoy del catálogo.' : 'Marca los bonos activos y/o añade tratamientos del catálogo — se agendan juntos, en un solo hueco.'}</p>
          ${isNewClient ? `
          <div class="panel-field-row">
            <div class="panel-field"><label class="vb-name-label">Nombre de la clienta</label><input type="text" class="vb-nc-name" value="${escapeHtml(vbState.ncName)}"></div>
            <div class="panel-field"><label class="vb-phone-label">Teléfono</label><input type="text" class="vb-nc-phone" value="${escapeHtml(vbState.ncPhone)}"></div>
            <div class="panel-field"><label class="vb-email-label">Email</label><input type="email" class="vb-nc-email" value="${escapeHtml(vbState.ncEmail)}"></div>
          </div>
          <div class="panel-field-row">
            <div class="panel-field"><label>Fecha de nacimiento (opcional)</label><input type="date" class="vb-nc-birthdate" value="${vbState.ncBirthdate}"></div>
          </div>` : ''}
          ${activeBonos.length ? `<div class="vb-picks">${picksHtml()}</div>` : ''}
          ${vbState.added.length ? vbState.added.map((t, i) => addedRowHtml(t, i)).join('') : ''}
          <div class="panel-field-row" style="margin-top:4px;">
            <div class="panel-field" style="flex:1;"><select class="vb-catalog-select"><option value="">+ Añadir un tratamiento del catálogo…</option>${catalogOptionsHtml}</select></div>
          </div>
          ${m === 'mixed' ? '<p class="panel-error" style="display:block;margin-top:10px;">Un bono ya existente y un tratamiento nuevo no se pueden agendar juntos en el mismo hueco todavía — agenda primero uno y, cuando termine esta visita, añade el otro por separado.</p>' : ''}
          ${m !== 'empty' && m !== 'mixed' ? `
          <hr style="border:none;border-top:1px solid var(--line);margin:18px 0;">
          <div class="panel-field-row">
            <div class="vb-fork">
              <button type="button" class="vb-fork-btn${vbState.whenMode === 'new' ? ' vb-fork-selected' : ''}" data-when="new">🗓️ Cita nueva<span>Respeta huecos reales</span></button>
              ${canPast ? `<button type="button" class="vb-fork-btn${vbState.whenMode === 'past' ? ' vb-fork-selected' : ''}" data-when="past">↩️ Ya pasó — solo registrar<span>Cualquier fecha/hora</span></button>` : ''}
            </div>
          </div>
          <div class="panel-field-row">
            <div class="panel-field"><label>Profesional</label><select class="vb-employee"><option value="">Cargando…</option></select></div>
            <div class="panel-field"><label>Fecha</label><input type="date" class="vb-date" value="${vbState.date}"></div>
            <div class="panel-field vb-time-field"><label>Hora</label>${vbState.whenMode === 'past' ? `<input type="time" class="vb-time-manual" value="${vbState.time}">` : '<select class="vb-time"><option value="">Elige profesional y fecha…</option></select>'}</div>
          </div>
          <p class="panel-status vb-duration" style="display:${durationMinutes ? 'block' : 'none'};margin:-6px 0 10px;">Duración total del hueco: ${durationMinutes} min</p>
          <div class="panel-field-row">
            <div class="panel-field" style="flex:1;"><label>Notas (potencia, observaciones…) — una nota para toda la visita</label><textarea class="vb-notes" rows="2"></textarea></div>
          </div>
          ${m === 'catalog' ? `
          <div class="panel-field-row">
            <div class="panel-field"><label>${vbState.added.some((t) => t.isBono) ? 'Precio total del bono (€)' : 'Precio total (€)'}</label><input type="number" step="0.01" class="vb-price" value="${catalogSuggestedPrice || ''}"></div>
            <div class="panel-field"><label>Ya pagado (€)</label><input type="number" step="0.01" class="vb-paid" value="0"></div>
            <div class="panel-field"><label>Pagado con</label><select class="vb-paidhow"><option value="tarjeta">Tarjeta</option><option value="efectivo">Efectivo</option><option value="bizum">Bizum</option></select></div>
          </div>` : ''}
          <button type="button" class="panel-btn panel-btn-primary vb-confirm">Confirmar visita</button>` : ''}
          <p class="panel-error vb-error" style="display:none;"></p>
        </div>
      `;

      wire();
    }

    function wire() {
      const ncNameInput = slot.querySelector('.vb-nc-name');
      if (ncNameInput) ncNameInput.addEventListener('input', () => { vbState.ncName = ncNameInput.value; });
      const ncPhoneInput = slot.querySelector('.vb-nc-phone');
      if (ncPhoneInput) ncPhoneInput.addEventListener('input', () => { vbState.ncPhone = ncPhoneInput.value; });
      const ncEmailInput = slot.querySelector('.vb-nc-email');
      if (ncEmailInput) ncEmailInput.addEventListener('input', () => { vbState.ncEmail = ncEmailInput.value; });
      const ncBirthdateInput = slot.querySelector('.vb-nc-birthdate');
      if (ncBirthdateInput) ncBirthdateInput.addEventListener('input', () => { vbState.ncBirthdate = ncBirthdateInput.value; });

      slot.querySelectorAll('.vb-pick-check').forEach((cb) => {
        cb.addEventListener('change', () => {
          vbState.selectedBonoIds = Array.from(slot.querySelectorAll('.vb-pick-check:checked')).map((c) => c.value);
          render();
        });
      });
      slot.querySelectorAll('.vb-override-toggle').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.bono;
          vbState.overrides[id] = { ...vbState.overrides[id], open: !(vbState.overrides[id] || {}).open };
          render();
        });
      });
      slot.querySelectorAll('.vb-override-select').forEach((sel) => {
        sel.addEventListener('change', () => {
          const id = sel.dataset.bono;
          vbState.overrides[id] = { ...vbState.overrides[id], serviceId: sel.value };
          render();
        });
      });
      slot.querySelectorAll('.vb-sessionedit-toggle').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.bono;
          vbState.sessionEdits[id] = { ...vbState.sessionEdits[id], open: !(vbState.sessionEdits[id] || {}).open };
          render();
        });
      });
      slot.querySelectorAll('.vb-se-used, .vb-se-total').forEach((inp) => {
        inp.addEventListener('input', () => {
          const id = inp.dataset.bono;
          const usedInp = slot.querySelector(`.vb-se-used[data-bono="${id}"]`);
          const totalInp = slot.querySelector(`.vb-se-total[data-bono="${id}"]`);
          vbState.sessionEdits[id] = { ...vbState.sessionEdits[id], used: usedInp.value, total: totalInp.value };
        });
      });
      slot.querySelectorAll('.vb-se-save').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.bono;
          const usedInp = slot.querySelector(`.vb-se-used[data-bono="${id}"]`);
          const totalInp = slot.querySelector(`.vb-se-total[data-bono="${id}"]`);
          btn.disabled = true;
          try {
            await panelFetch('/panel/edit-bono', {
              method: 'POST',
              body: JSON.stringify({ bonoId: id, totalSessions: totalInp.value, sessionsUsed: usedInp.value }),
            });
            doSearch();
          } catch (e) {
            btn.disabled = false;
            alert(e.message);
          }
        });
      });
      const catalogSelect = slot.querySelector('.vb-catalog-select');
      if (catalogSelect) {
        catalogSelect.addEventListener('change', () => {
          if (!catalogSelect.value) return;
          vbState.added.push({ localId: nextLocalId++, serviceId: catalogSelect.value, isBono: false });
          render();
        });
      }
      slot.querySelectorAll('.vb-remove-added').forEach((btn) => {
        btn.addEventListener('click', () => { vbState.added.splice(Number(btn.dataset.idx), 1); vbState.editingIdx = null; render(); });
      });
      slot.querySelectorAll('.vb-convert-bono').forEach((btn) => {
        btn.addEventListener('click', () => { vbState.editingIdx = Number(btn.dataset.idx); render(); });
      });
      slot.querySelectorAll('.vb-cancel-bono').forEach((btn) => {
        btn.addEventListener('click', () => { vbState.editingIdx = null; render(); });
      });
      slot.querySelectorAll('.vb-confirm-bono').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.idx);
          const t = vbState.added[idx];
          const sessionsInput = slot.querySelector('.vb-bono-sessions');
          const sessionNumInput = slot.querySelector('.vb-bono-sessionnum');
          const priceInput = slot.querySelector('.vb-bono-price');
          t.bonoSessions = Number(sessionsInput.value) || 1;
          t.bonoSessionNumber = Math.min(t.bonoSessions, Number(sessionNumInput.value) || 1);
          t.bonoPrice = Number(priceInput.value) || 0;
          t.isBono = true;
          vbState.editingIdx = null;
          render();
        });
      });
      const bonoSessionsInput = slot.querySelector('.vb-bono-sessions');
      if (bonoSessionsInput) {
        const idx = vbState.editingIdx;
        const t = vbState.added[idx];
        const priceInput = slot.querySelector('.vb-bono-price');
        const svc = allServices.find((s) => s.id === t.serviceId);
        bonoSessionsInput.addEventListener('input', (e) => {
          const n = Number(e.target.value) || 0;
          if (!t.bonoPriceTouched && svc) priceInput.value = n > 0 ? (svc.price * n).toFixed(2) : '';
        });
        priceInput.addEventListener('input', () => { t.bonoPriceTouched = true; });
      }

      const forkNewBtn = slot.querySelector('[data-when="new"]');
      const forkPastBtn = slot.querySelector('[data-when="past"]');
      if (forkNewBtn) forkNewBtn.addEventListener('click', () => { vbState.whenMode = 'new'; render(); });
      if (forkPastBtn) forkPastBtn.addEventListener('click', () => { vbState.whenMode = 'past'; render(); });

      const employeeSelect = slot.querySelector('.vb-employee');
      const dateInput = slot.querySelector('.vb-date');
      const timeSelect = slot.querySelector('.vb-time');
      const errorEl = slot.querySelector('.vb-error');
      const confirmBtn = slot.querySelector('.vb-confirm');

      async function refreshEmployees() {
        if (!employeeSelect) return;
        const m = mode();
        const ids = m === 'catalog'
          ? vbState.added.map((t) => t.serviceId)
          : vbState.selectedBonoIds.map((id) => bonoEffectiveServiceId(activeBonos.find((bo) => bo.bonoId === id))).filter(Boolean);
        employeeSelect.innerHTML = '<option value="">Cargando…</option>';
        const res = await fetch(`${BOOKING_API_BASE}/employees?serviceIds=${encodeURIComponent(ids.join(','))}`);
        const data = await res.json();
        const emps = data.employees || [];
        employeeSelect.innerHTML = emps.length
          ? '<option value="">Elige una profesional…</option>' + emps.map((e) => `<option value="${e.id}">${e.name}</option>`).join('')
          : '<option value="">Ninguna profesional puede con todos a la vez</option>';
        // Igual que el nombre/teléfono, la profesional/fecha/hora ya
        // elegidas se recuperan aquí — el desplegable se reconstruye entero
        // cada vez que se marca otro tratamiento, y sin esto se perdía la
        // selección aunque la profesional siguiera siendo válida.
        if (vbState.employeeId && emps.some((e) => e.id === vbState.employeeId)) {
          employeeSelect.value = vbState.employeeId;
        }
        if (vbState.whenMode === 'new') refreshSlots();
      }

      async function refreshSlots() {
        if (!timeSelect || vbState.whenMode !== 'new') return;
        if (!employeeSelect.value || !dateInput.value) { timeSelect.innerHTML = '<option value="">Elige profesional y fecha…</option>'; return; }
        const m = mode();
        const ids = m === 'catalog'
          ? vbState.added.map((t) => t.serviceId)
          : vbState.selectedBonoIds.map((id) => bonoEffectiveServiceId(activeBonos.find((bo) => bo.bonoId === id))).filter(Boolean);
        const primary = ids[0];
        const rest = ids.slice(1);
        timeSelect.innerHTML = '<option value="">Cargando…</option>';
        try {
          const data = await panelFetch(`/availability?employeeId=${employeeSelect.value}&date=${dateInput.value}&serviceId=${encodeURIComponent(primary)}&extraServiceIds=${encodeURIComponent(rest.join(','))}`, { method: 'GET' });
          const slots = data.slots || [];
          timeSelect.innerHTML = slots.length ? slots.map((t) => `<option value="${t}">${t}</option>`).join('') : '<option value="">Sin huecos ese día</option>';
          if (vbState.time && slots.includes(vbState.time)) timeSelect.value = vbState.time;
        } catch (e) {
          timeSelect.innerHTML = '<option value="">Error al cargar huecos</option>';
        }
      }

      if (employeeSelect) {
        refreshEmployees();
        employeeSelect.addEventListener('change', () => { vbState.employeeId = employeeSelect.value; refreshSlots(); });
      }
      if (dateInput) dateInput.addEventListener('change', () => { vbState.date = dateInput.value; refreshSlots(); });
      if (timeSelect) timeSelect.addEventListener('change', () => { vbState.time = timeSelect.value; });
      const timeManualInput = slot.querySelector('.vb-time-manual');
      if (timeManualInput) timeManualInput.addEventListener('input', () => { vbState.time = timeManualInput.value; });

      if (confirmBtn) {
        confirmBtn.addEventListener('click', async (ev) => {
          errorEl.style.display = 'none';
          const m = mode();
          const isPast = vbState.whenMode === 'past';
          const timeVal = isPast ? slot.querySelector('.vb-time-manual').value : (timeSelect && timeSelect.value);
          const notesVal = slot.querySelector('.vb-notes').value.trim();
          if (!employeeSelect.value || !dateInput.value || (!isPast && !timeVal)) {
            errorEl.textContent = 'Elige profesional, fecha y hora.';
            errorEl.style.display = 'block';
            return;
          }
          let ncName = '';
          let ncPhone = '';
          let ncEmail = '';
          let ncBirthdate = '';
          if (isNewClient) {
            ncName = slot.querySelector('.vb-nc-name').value.trim();
            ncPhone = slot.querySelector('.vb-nc-phone').value.trim();
            ncEmail = slot.querySelector('.vb-nc-email').value.trim();
            ncBirthdate = slot.querySelector('.vb-nc-birthdate').value;
            // El teléfono hace falta SIEMPRE, incluso en "Ya pasó" — es lo
            // único que enlaza esta visita con la ficha de la clienta al
            // buscarla luego. Dejarlo en blanco no crea una cita "anónima
            // válida", crea una cita huérfana: no aparece en su historial
            // y no suma ni saldo ni bono a nadie.
            if (!ncPhone) {
              errorEl.textContent = 'Indica al menos el teléfono de la clienta — sin él, esta visita no se podrá encontrar luego ni sumar puntos a nadie.';
              errorEl.style.display = 'block';
              return;
            }
            if (!isPast && (!ncName || !ncEmail)) {
              errorEl.textContent = 'Indica nombre y email de la clienta (o marca "Ya pasó" si de momento solo hace falta el teléfono).';
              errorEl.style.display = 'block';
              return;
            }
          }
          ev.target.disabled = true;
          try {
            if (m === 'single-bono') {
              const bono = activeBonos.find((bo) => bo.bonoId === vbState.selectedBonoIds[0]);
              const override = vbState.overrides[bono.bonoId];
              await panelFetch('/panel/book-session', {
                method: 'POST',
                body: JSON.stringify({
                  bonoId: bono.bonoId, employeeId: employeeSelect.value, date: dateInput.value,
                  time: timeVal, notes: notesVal, force: isPast || undefined,
                  treatmentOverrideId: override ? override.serviceId : undefined,
                }),
              });
            } else if (m === 'multi-bono') {
              const treatmentOverrides = {};
              vbState.selectedBonoIds.forEach((id) => {
                const ov = vbState.overrides[id];
                if (ov && ov.serviceId) treatmentOverrides[id] = ov.serviceId;
              });
              await panelFetch('/panel/book-combined-sessions', {
                method: 'POST',
                body: JSON.stringify({
                  bonoIds: vbState.selectedBonoIds, employeeId: employeeSelect.value,
                  date: dateInput.value, time: timeVal, notes: notesVal, treatmentOverrides,
                }),
              });
            } else if (m === 'catalog') {
              const priceInput = slot.querySelector('.vb-price');
              const paidInput = slot.querySelector('.vb-paid');
              const paidHowSelect = slot.querySelector('.vb-paidhow');
              const primary = vbState.added[0];
              const extras = vbState.added.slice(1);
              // Si se convierte en bono, "Precio"/"Ya pagado" son el precio
              // del bono en sí (va a bonoTotalPrice/bonoAmountPaid) — no se
              // duplican también en price/amountPaid de la cita, o se
              // contaría como cobrado dos veces (el bono por su lado y la
              // cita por el suyo).
              await panelFetch('/panel/import-legacy-booking', {
                method: 'POST',
                body: JSON.stringify({
                  name: isNewClient ? ncName : client.name,
                  phone: isNewClient ? ncPhone : client.phone,
                  email: isNewClient ? ncEmail : client.email,
                  birthdate: isNewClient ? ncBirthdate : undefined,
                  serviceId: primary.serviceId, employeeId: employeeSelect.value,
                  date: dateInput.value, time: isPast ? undefined : timeVal,
                  price: primary.isBono ? '' : priceInput.value,
                  amountPaid: primary.isBono ? 0 : paidInput.value,
                  paidHow: paidHowSelect.value,
                  notes: notesVal, accountingOnly: isPast,
                  isBono: primary.isBono, sessionNumber: primary.bonoSessionNumber || 1, totalSessions: primary.bonoSessions,
                  bonoTotalPrice: primary.isBono ? priceInput.value : undefined,
                  bonoAmountPaid: primary.isBono ? paidInput.value : undefined,
                  extraServiceIds: extras.map((t) => t.serviceId),
                }),
              });
            }
            slot.innerHTML = '<p class="panel-status">Visita agendada ✓</p>';
            if (isNewClient) {
              // En vez de dejarla ahí con un mensaje suelto, se pasa
              // directamente a "Clienta existente" con su ficha ya
              // cargada — es la misma clienta a partir de ahora.
              els.searchInput.value = ncPhone;
              setClientMode('existing');
              doSearch();
            } else {
              doSearch();
            }
            refreshAgendaBadge();
          } catch (e) {
            errorEl.textContent = e.message;
            errorEl.style.display = 'block';
            ev.target.disabled = false;
          }
        });
      }
    }

    render();
  }

  function toggleFollowup(clientEl, client) {
    const slot = clientEl.querySelector('.panel-followup-slot');
    if (slot.innerHTML) { slot.innerHTML = ''; return; }
    slot.innerHTML = `
      <div class="panel-new-appt">
        <div class="panel-label">Marcar seguimiento de ${escapeHtml(client.name) || 'esta clienta'}</div>
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
        <p style="font-size:11px;color:var(--rose);margin:0 0 10px;">⚠ Esto solo baja el saldo de la clienta — NO reduce el precio de ninguna cita. Si es para pagar una cita de hoy, es mejor descontarlo directamente en "Cerrar cita" (ahí sí se resta solo del total). Usa esto solo cuando no hay ninguna cita de por medio.</p>
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
      const amountToConfirm = Number(amountInput.value) || 0;
      if (!confirm(`¿Descontar ${amountToConfirm.toFixed(2)} € del saldo? Esto NO reduce el precio de ninguna cita — si estás cobrando una cita ahora mismo, resta esta cantidad tú misma de lo que cobres.`)) return;
      ev.target.disabled = true;
      try {
        const data = await panelFetch('/panel/redeem', {
          method: 'POST',
          body: JSON.stringify({ phone: client.phone, amount: amountInput.value }),
        });
        slot.innerHTML = `<p class="panel-status">Descontado ✓ — nuevo saldo: ${data.newBalance.toFixed(2)} €. Recuerda: si era para una cita, resta ${amountToConfirm.toFixed(2)} € de lo que cobres.</p>`;
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

  // Corrige nombre/teléfono/email en TODO el historial de la clienta a la
  // vez (reservas, bonos, faltas y puntos) — para arreglar un dato mal
  // introducido sin que los puntos ya ganados se queden huérfanos bajo el
  // dato viejo.
  function toggleEditClient(clientEl, client) {
    const slot = clientEl.querySelector('.panel-editclient-slot');
    if (slot.innerHTML) { slot.innerHTML = ''; return; }
    slot.innerHTML = `
      <div class="panel-new-appt">
        <div class="panel-label">Corregir los datos de esta clienta (se aplica a todo su historial)</div>
        <div class="panel-field-row">
          <div class="panel-field"><label>Nombre</label><input type="text" class="ec-name" value="${escapeHtml(client.name || '')}"></div>
          <div class="panel-field"><label>Teléfono</label><input type="text" class="ec-phone" value="${escapeHtml(client.phone || '')}"></div>
          <div class="panel-field"><label>Email</label><input type="email" class="ec-email" value="${escapeHtml(client.email || '')}"></div>
          <div class="panel-field"><label>Fecha de nacimiento</label><input type="date" class="ec-birthdate" value="${escapeHtml(client.birthdate || '')}"></div>
        </div>
        <button type="button" class="panel-btn panel-btn-primary panel-confirm-editclient">Guardar corrección</button>
        <p class="panel-error" style="display:none;"></p>
        <p class="panel-status" style="display:none;"></p>
      </div>
    `;
    const nameInput = slot.querySelector('.ec-name');
    const phoneInput = slot.querySelector('.ec-phone');
    const emailInput = slot.querySelector('.ec-email');
    const birthdateInput = slot.querySelector('.ec-birthdate');
    const errorEl = slot.querySelector('.panel-error');
    const statusEl = slot.querySelector('.panel-status');
    slot.querySelector('.panel-confirm-editclient').addEventListener('click', async (ev) => {
      errorEl.style.display = 'none';
      statusEl.style.display = 'none';
      if (!nameInput.value.trim() || !phoneInput.value.trim()) {
        errorEl.textContent = 'El nombre y el teléfono no pueden quedar vacíos.';
        errorEl.style.display = 'block';
        return;
      }
      ev.target.disabled = true;
      try {
        const data = await panelFetch('/panel/edit-client', {
          method: 'POST',
          body: JSON.stringify({
            oldPhone: client.phone, name: nameInput.value.trim(),
            phone: phoneInput.value.trim(), email: emailInput.value.trim(),
            birthdate: birthdateInput.value,
          }),
        });
        statusEl.textContent = `Corregido ✓ (${data.bookingsUpdated} cita${data.bookingsUpdated === 1 ? '' : 's'} actualizada${data.bookingsUpdated === 1 ? '' : 's'}).`;
        statusEl.style.display = 'block';
        // El teléfono/nombre buscado pudo cambiar — actualizamos el buscador
        // con el dato nuevo antes de recargar, o la búsqueda anterior ya no
        // encontraría a esta clienta.
        els.searchInput.value = phoneInput.value.trim();
        doSearch();
      } catch (e) {
        errorEl.textContent = e.message;
        errorEl.style.display = 'block';
        ev.target.disabled = false;
      }
    });
  }

  function renderBono(bono) {
    const el = document.createElement('div');
    el.className = 'panel-bono';
    const pct = bono.totalSessions ? Math.round((bono.sessionsUsed / bono.totalSessions) * 100) : 0;
    const remaining = Number(bono.remainingAmount) || 0;
    el.innerHTML = `
      <div class="panel-bono-top">
        <div class="panel-bono-name">${bono.serviceName}</div>
        <div class="panel-bono-sessions"><b>${bono.sessionsUsed}</b> de ${bono.totalSessions} usadas</div>
      </div>
      <div class="panel-progress-track"><div class="panel-progress-fill" style="width:${pct}%;"></div></div>
      ${remaining > 0 ? `<p class="panel-status" style="margin-top:6px;">Pendiente de pago del bono: <b>${remaining.toFixed(2)} €</b></p>` : ''}
      ${!bono.sessionsRemaining ? '<p class="panel-status">Bono completado</p>' : ''}
      <div class="panel-bono-actions">
        <button type="button" class="panel-btn panel-btn-ghost panel-btn-sm panel-editbono-toggle">✎ Corregir nº de sesiones</button>
      </div>
      <div class="panel-editbono-slot"></div>
    `;
    el.querySelector('.panel-editbono-toggle').addEventListener('click', () => toggleEditBono(el, bono));
    return el;
  }

  // Corrige a mano el total/usadas de un bono (p.ej. se dio de alta con un
  // número equivocado, o se contó una sesión de más/de menos por error) sin
  // tener que entrar a la Google Sheet.
  function toggleEditBono(bonoEl, bono) {
    const slot = bonoEl.querySelector('.panel-editbono-slot');
    if (slot.innerHTML) { slot.innerHTML = ''; return; }
    slot.innerHTML = `
      <div class="panel-new-appt">
        <div class="panel-label">Corregir "${escapeHtml(bono.serviceName)}"</div>
        <div class="panel-field-row">
          <div class="panel-field"><label>Sesiones ya usadas de verdad</label><input type="number" min="0" step="1" class="eb-used-sessions" value="${bono.sessionsUsed}"></div>
          <div class="panel-field"><label>Total de sesiones del bono</label><input type="number" min="1" step="1" class="eb-total-sessions" value="${bono.totalSessions}"></div>
        </div>
        <p class="panel-status eb-preview" style="margin:0 0 10px;"></p>
        <button type="button" class="panel-btn panel-btn-primary panel-btn-sm panel-confirm-editbono">Guardar corrección</button>
        <p class="panel-error" style="display:none;"></p>
      </div>
    `;
    const totalInput = slot.querySelector('.eb-total-sessions');
    const usedInput = slot.querySelector('.eb-used-sessions');
    const previewEl = slot.querySelector('.eb-preview');
    const errorEl = slot.querySelector('.panel-error');
    // Vista previa en vivo — para pillar antes de guardar si los dos números
    // se han puesto al revés (usadas/total, no total/usadas).
    function updatePreview() {
      const used = Number(usedInput.value) || 0;
      const total = Number(totalInput.value) || 0;
      previewEl.textContent = total > 0 ? `Quedará como: ${Math.min(used, total)} de ${total} usadas` : '';
    }
    usedInput.addEventListener('input', updatePreview);
    totalInput.addEventListener('input', updatePreview);
    updatePreview();
    slot.querySelector('.panel-confirm-editbono').addEventListener('click', async (ev) => {
      errorEl.style.display = 'none';
      ev.target.disabled = true;
      try {
        await panelFetch('/panel/edit-bono', {
          method: 'POST',
          body: JSON.stringify({ bonoId: bono.bonoId, totalSessions: totalInput.value, sessionsUsed: usedInput.value }),
        });
        doSearch();
      } catch (e) {
        errorEl.textContent = e.message;
        errorEl.style.display = 'block';
        ev.target.disabled = false;
      }
    });
  }

  async function toggleBookSessionForm(bonoEl, bono, btn, client) {
    const slot = bonoEl.querySelector('.panel-new-appt-slot');
    if (slot.innerHTML) { slot.innerHTML = ''; return; }

    let allServices = [];
    try { allServices = await loadImportServicesOnce(); } catch (e) { /* seguimos con la lista vacía si falla */ }
    // bono.serviceId puede estar vacío o ya no corresponder a ningún
    // tratamiento real en algún bono antiguo — si pasa, lo localizamos por
    // su nombre (bono.serviceName, que sí solemos tener bien) en vez de
    // dejar la reserva bloqueada por un dato que la clienta no puede
    // arreglar. Se usa en vez de bono.serviceId en todo lo de abajo.
    const bonoServiceId = (allServices.find((s) => s.id === bono.serviceId) && bono.serviceId)
      || (allServices.find((s) => s.name === bono.serviceName) || {}).id || '';

    let employees = [];
    try {
      const data = await panelFetch(`/employees?serviceIds=${encodeURIComponent(bonoServiceId)}`);
      employees = data.employees || [];
    } catch (e) { /* seguimos con la lista vacía si falla */ }

    // Sugerimos como "minutos extra" por defecto los mismos que se usaron
    // en la última sesión de este mismo bono (p.ej. sesiones avanzadas de
    // láser que cada vez llevan más tiempo) — así no hay que recordarlo ni
    // recalcularlo cada vez, solo ajustarlo si hiciera falta.
    let defaultExtraMinutes = '';
    try {
      const baseService = allServices.find((s) => s.id === bonoServiceId);
      const previousSessions = (client && client.bookings || [])
        .filter((b) => b.bonoId === bono.bonoId && Number(b.durationMinutes) > 0)
        .sort((a, b) => new Date(`${b.date}T${b.time}`) - new Date(`${a.date}T${a.time}`));
      if (baseService && previousSessions.length) {
        const extra = Number(previousSessions[0].durationMinutes) - baseService.durationMinutes;
        if (extra > 0) defaultExtraMinutes = extra;
      }
    } catch (e) { /* si falla, se deja vacío y se pone a mano */ }

    const byCategory = {};
    allServices.forEach((s) => { (byCategory[s.category] = byCategory[s.category] || []).push(s); });
    const treatmentOverrideOptions = Object.keys(byCategory).map((cat) => `
      <optgroup label="${cat}">
        ${byCategory[cat].map((s) => `<option value="${s.id}">${s.name} — ${s.price} €</option>`).join('')}
      </optgroup>
    `).join('');

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
        <label class="panel-split-toggle"><input type="checkbox" class="pf-force"> Ya se hizo (hoy más tarde, o se te olvidó anotarla) — no comprobar hueco, se registra a la hora que digas</label>
        <div class="panel-field-row pf-force-row" style="display:none;">
          <div class="panel-field"><label>Hora real</label><input type="time" class="pf-time-manual"></div>
        </div>
        <div class="panel-field-row">
          <div class="panel-field" style="flex:2;"><label>Tratamiento de hoy (si usan el bono para otra zona/tratamiento del mismo precio)</label>
            <select class="pf-treatment-override"><option value="">${escapeHtml(bono.serviceName)} (el del bono)</option>${treatmentOverrideOptions}</select>
          </div>
          <div class="panel-field"><label>Nº de sesiones que consume esta visita</label><input type="number" min="1" max="${bono.sessionsRemaining}" step="1" class="pf-sessions-used" value="1"></div>
        </div>
        <div class="panel-field-row">
          <div class="panel-field"><label>Minutos extra (opcional)${defaultExtraMinutes ? ' — igual que la última vez' : ''}</label><input type="number" min="0" step="5" class="pf-extra-minutes" placeholder="Ej. 15" value="${defaultExtraMinutes}"></div>
          <div class="panel-field" style="flex:1;"><label>Notas (potencia, zona tratada, observaciones…)</label><textarea class="pf-notes" placeholder="Ej. potencia 18, zona íntimo completo"></textarea></div>
        </div>
        <button type="button" class="panel-btn panel-btn-primary panel-confirm-session">Confirmar cita</button>
        <p class="panel-error" style="display:none;"></p>
      </div>
    `;

    const dateInput = slot.querySelector('.pf-date');
    const timeSelect = slot.querySelector('.pf-time');
    const employeeSelect = slot.querySelector('.pf-employee');
    const treatmentOverrideSelect = slot.querySelector('.pf-treatment-override');
    const sessionsUsedInput = slot.querySelector('.pf-sessions-used');
    const extraMinutesInput = slot.querySelector('.pf-extra-minutes');
    const notesInput = slot.querySelector('.pf-notes');
    const errorEl = slot.querySelector('.panel-error');
    const forceToggle = slot.querySelector('.pf-force');
    const forceRow = slot.querySelector('.pf-force-row');
    const timeManualInput = slot.querySelector('.pf-time-manual');
    forceToggle.addEventListener('change', () => {
      forceRow.style.display = forceToggle.checked ? 'grid' : 'none';
      timeSelect.disabled = forceToggle.checked;
    });

    async function loadTimes() {
      if (!dateInput.value || !employeeSelect.value) return;
      timeSelect.innerHTML = '<option>Cargando…</option>';
      try {
        const extra = Number(extraMinutesInput.value) || 0;
        const svcId = treatmentOverrideSelect.value || bonoServiceId || '';
        const data = await panelFetch(`/availability?employeeId=${employeeSelect.value}&date=${dateInput.value}&serviceId=${encodeURIComponent(svcId)}&extraMinutes=${extra}`);
        const slots = data.slots || [];
        timeSelect.innerHTML = slots.length
          ? slots.map((t) => `<option value="${t}">${t}</option>`).join('')
          : '<option value="">Sin huecos ese día</option>';
      } catch (e) {
        timeSelect.innerHTML = `<option value="">Error: ${escapeHtml(e.message)}</option>`;
      }
    }
    dateInput.addEventListener('change', loadTimes);
    employeeSelect.addEventListener('change', loadTimes);
    extraMinutesInput.addEventListener('change', loadTimes);
    treatmentOverrideSelect.addEventListener('change', loadTimes);

    slot.querySelector('.panel-confirm-session').addEventListener('click', async (ev) => {
      errorEl.style.display = 'none';
      const useForce = forceToggle.checked;
      const time = useForce ? timeManualInput.value : timeSelect.value;
      if (!employeeSelect.value || !dateInput.value || !time) {
        errorEl.textContent = useForce ? 'Elige profesional, fecha y la hora real.' : 'Elige profesional, fecha y hora.';
        errorEl.style.display = 'block';
        return;
      }
      if (useForce && !confirm('¿Registrar esta sesión sin comprobar hueco? Es para dejar constancia de una que ya se hizo, no para reservar una nueva.')) return;
      ev.target.disabled = true;
      try {
        await panelFetch('/panel/book-session', {
          method: 'POST',
          body: JSON.stringify({
            bonoId: bono.bonoId, employeeId: employeeSelect.value, date: dateInput.value, time,
            sessionsToUse: sessionsUsedInput.value, extraMinutes: extraMinutesInput.value, notes: notesInput.value.trim(),
            // Si bono.serviceId estaba vacío/roto y tuvimos que resolverlo por
            // nombre, lo mandamos como "tratamiento de hoy" aunque el equipo no
            // haya tocado el desplegable, para que el backend no se quede sin
            // saber qué tratamiento usar.
            treatmentOverrideId: treatmentOverrideSelect.value || (bonoServiceId !== bono.serviceId ? bonoServiceId : undefined) || undefined,
            force: useForce || undefined,
          }),
        });
        doSearch(); // recarga con los datos actualizados
      } catch (e) {
        errorEl.textContent = e.message;
        errorEl.style.display = 'block';
        ev.target.disabled = false;
      }
    });
  }

  function renderAppt(b, client, wrap) {
    const el = document.createElement('div');
    el.className = 'panel-appt';
    el.dataset.bookingId = b.bookingId;
    const statusPill = {
      confirmed: '<span class="panel-pill panel-pill-ok"><span class="dot"></span>Confirmada</span>',
      no_show: '<span class="panel-pill panel-pill-crit"><span class="dot"></span>No-show</span>',
      cancelled_refunded: '<span class="panel-pill panel-pill-warn"><span class="dot"></span>Cancelada (reembolsada)</span>',
      cancelled_no_refund: '<span class="panel-pill panel-pill-warn"><span class="dot"></span>Cancelada (sin reembolso)</span>',
    }[b.status] || `<span class="panel-pill panel-pill-warn"><span class="dot"></span>${b.status || ''}</span>`;

    // Pagado/pendiente de un vistazo, sin tener que abrir "Cerrar cita" o
    // "Editar cita" para calcularlo — solo tiene sentido en citas activas.
    let paymentLine = '';
    if (b.status === 'confirmed') {
      if (b.finalAmount !== null && b.finalAmount !== undefined) {
        paymentLine = '<div class="with">✓ Pagado</div>';
      } else if (!b.bonoId && b.price === '0' && Number(b.amountPaid) === 0) {
        // Tratamiento de una visita combinada (varios tratamientos sueltos
        // en el mismo hueco) cuyo precio se cobra en OTRA de las líneas de
        // la misma visita, no en esta — mostrar "✓ Pagado" aquí sería
        // engañoso (nada se ha cobrado todavía por esta línea en concreto).
        paymentLine = '<div class="with" style="opacity:.7;">Va incluido en el precio de otro tratamiento de esta misma visita</div>';
      } else {
        const pending = Math.max(0, (Number(b.price) || 0) - (Number(b.amountPaid) || 0));
        paymentLine = pending > 0
          ? `<div class="with">Pendiente: <b>${pending.toFixed(2)} €</b></div>`
          : '<div class="with">✓ Pagado</div>';
      }
    }

    el.innerHTML = `
      <div class="panel-appt-top">
        <div class="panel-appt-date">${fmtDateParts(b.date).month}<span class="day">${fmtDateParts(b.date).day}</span></div>
        <div class="panel-appt-body">
          <div class="client">${escapeHtml(client && client.name ? client.name : '')}${client && client.phone ? ` · ${escapeHtml(client.phone)}` : ''}</div>
          <div class="svc">${escapeHtml(b.serviceName)}</div>
          <div class="with">Con ${escapeHtml(b.employeeName) || '—'} · ${b.time}</div>
          ${paymentLine}
        </div>
        <div>${statusPill}</div>
      </div>
      <div class="panel-appt-note-view" style="${b.notes ? '' : 'display:none;'}"><span class="tag">Nota:</span><span class="note-text">${escapeHtml(b.notes)}</span></div>
      <div class="panel-appt-note-edit" style="display:none;">
        <textarea placeholder="Ej. potencia del láser, observaciones…">${escapeHtml(b.notes)}</textarea>
      </div>
      <div class="panel-appt-actions">
        <button type="button" class="panel-btn panel-btn-ghost panel-btn-sm panel-note-toggle">✎ Nota</button>
        ${b.status !== 'cancelled_refunded' ? '<button type="button" class="panel-btn panel-btn-ghost panel-btn-sm panel-editbooking-toggle">✎ Editar cita</button>' : ''}
        ${b.status === 'confirmed' ? '<button type="button" class="panel-btn panel-btn-ghost panel-btn-sm panel-reschedule-toggle">Reprogramar</button>' : ''}
        ${b.status === 'confirmed' && !b.bonoId && client ? '<button type="button" class="panel-btn panel-btn-ghost panel-btn-sm panel-booknext-toggle">🔁 Agendar próxima sesión</button>' : ''}
        ${b.status === 'confirmed' && !b.isPast ? '<button type="button" class="panel-btn panel-btn-ghost panel-btn-sm panel-extend-toggle">⏱ Ampliar tiempo</button>' : ''}
        ${b.status === 'confirmed' ? '<button type="button" class="panel-btn panel-btn-warn panel-btn-sm panel-noshow-btn">Marcar como no-show</button>' : ''}
        ${b.status !== 'cancelled_refunded' ? `<button type="button" class="panel-btn panel-btn-noshow panel-btn-sm panel-delete-btn">${b.bonoId ? '↩ No se hizo — devolver sesión' : '🗑 Eliminar'}</button>` : ''}
      </div>
      <div class="panel-editbooking-slot"></div>
      <div class="panel-reschedule-slot"></div>
      <div class="panel-extend-slot"></div>
    `;

    const editBookingBtn = el.querySelector('.panel-editbooking-toggle');
    if (editBookingBtn) {
      editBookingBtn.addEventListener('click', () => toggleEditBooking(el, b, client));
    }

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
      reschedBtn.addEventListener('click', () => toggleReschedule(el, b, client));
    }

    const bookNextBtn = el.querySelector('.panel-booknext-toggle');
    if (bookNextBtn) {
      bookNextBtn.addEventListener('click', () => {
        // Tratamientos sueltos que compartían hueco con este (misma visita
        // combinada) se precargan también, para no tener que volver a
        // elegirlos uno a uno — se pueden quitar los que no toque repetir.
        const siblings = (client.bookings || []).filter((x) => x.bookingId !== b.bookingId
          && x.status === 'confirmed' && !x.bonoId && x.date === b.date && x.time === b.time && x.employeeId === b.employeeId);
        const group = [b, ...siblings];
        const vbSlot = wrap.querySelector('.panel-visitbuilder-slot');
        vbSlot.innerHTML = '';
        renderVisitBuilder(vbSlot, client, { addServiceIds: group.map((g) => g.serviceId), employeeId: b.employeeId });
        vbSlot.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
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

    const deleteBtn = el.querySelector('.panel-delete-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async () => {
        const confirmMsg = b.bonoId
          ? `¿"${b.serviceName}" no se hizo el ${b.date} (${client && client.name ? client.name : ''})? Se le devuelve la sesión al bono (no se cuenta como usada) y esta línea desaparece de la cita — el resto de tratamientos de la misma visita, si los hay, no se tocan.`
          : `¿Eliminar la cita de ${b.serviceName} el ${b.date} (${client && client.name ? client.name : ''})? Libera el hueco del calendario y deja de contar como facturación. Esta acción no borra ningún cobro ya hecho en Stripe — eso, si hiciera falta, se reembolsa aparte.`;
        if (!confirm(confirmMsg)) return;
        deleteBtn.disabled = true;
        try {
          await panelFetch('/panel/delete-booking', { method: 'POST', body: JSON.stringify({ bookingId: b.bookingId }) });
          doSearch();
        } catch (e) {
          alert(e.message);
          deleteBtn.disabled = false;
        }
      });
    }

    const extendBtn = el.querySelector('.panel-extend-toggle');
    if (extendBtn) {
      extendBtn.addEventListener('click', () => toggleExtend(el, b));
    }

    return el;
  }

  // Corrige el tratamiento, profesional, precio, importe pagado o nº de
  // sesión de una cita ya registrada — por si al darla de alta a mano te
  // equivocaste en algo (p.ej. puso Raquel y en realidad fue Vanessa).
  const EXTRA_CATS = [
    { id: 'facial', label: 'Facial' }, { id: 'corporal', label: 'Corporal' }, { id: 'laser', label: 'Láser' },
    { id: 'cejas', label: 'Cejas' }, { id: 'venta', label: 'Producto' },
  ];

  // Desplegable "Pagado con" de una línea extra: por defecto "auto" (se
  // resuelve al cerrar la cita, igual que el resto) — solo hace falta
  // tocarlo si esa línea en concreto se paga de una forma distinta al resto
  // de la visita (p.ej. tratamiento con tarjeta, extra en efectivo).
  function extraPaidHowSelectHtml(cls, selected) {
    const opts = [
      ['auto', 'Igual que el resto de la cita (se decide al cerrar)'],
      ['efectivo', 'Efectivo'], ['tarjeta', 'Tarjeta'], ['bizum', 'Bizum'],
      ['bonos archipiélago', 'Bonos Archipiélago'], ['bono adeje', 'Bono Adeje'],
    ];
    const cur = selected || 'auto';
    return `<select class="${cls}">${opts.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  }

  // ── Panel único de "Editar cita": líneas (tratamientos + extras), añadir
  // línea (tratamiento o extra sin tiempo), notas, profesional y cobro
  // (incluye lo que antes era "Cerrar cita" aparte) — todo en un mismo sitio,
  // en vez de repartido en varios botones/secciones distintas. ──
  async function toggleEditBooking(apptEl, b, client) {
    const slot = apptEl.querySelector('.panel-editbooking-slot');
    if (slot.innerHTML) { slot.innerHTML = ''; return; }
    slot.innerHTML = `<div class="panel-new-appt"><p class="panel-status">Cargando…</p></div>`;
    const allServices = await loadImportServicesOnce();
    const byCategory = {};
    allServices.forEach((s) => { (byCategory[s.category] = byCategory[s.category] || []).push(s); });
    const serviceOptionsHtml = (selectedId) => Object.keys(byCategory).map((cat) => `
      <optgroup label="${cat}">
        ${byCategory[cat].map((s) => `<option value="${s.id}" ${s.id === selectedId ? 'selected' : ''}>${s.name} — ${s.price} €</option>`).join('')}
      </optgroup>
    `).join('');
    const allEmployees = await loadAllEmployeesOnce();
    const employeeOptions = allEmployees
      .map((e) => `<option value="${e.id}" ${e.id === b.employeeId ? 'selected' : ''}>${e.name}</option>`)
      .join('');
    const isBonoSession = !!b.bonoId;
    const idParts = String(b.serviceId || '').split(',').map((s) => s.trim()).filter(Boolean);
    const nameParts = String(b.serviceName || '').split(' + ');
    const namesAligned = nameParts.length === idParts.length;
    const nameForIdx = (id, i) => (namesAligned ? nameParts[i] : (allServices.find((s) => s.id === id) || {}).name || id);
    const extras = Array.isArray(b.extras) ? b.extras : [];
    const unresolvedExtrasTotal = extras.filter((e) => !e.paidHow).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const balance = client && Number(client.loyaltyBalance) || 0;
    // Normalmente solo se cierra una cita después de que pase (isPast) — pero
    // si ya se ha cobrado algo por adelantado en persona (p.ej. clienta que
    // paga en el centro una cita para más adelante), tiene que poderse
    // cerrar desde ya, sin esperar a esa fecha.
    const isClosable = b.status === 'confirmed' && (b.isPast || Number(b.amountPaid) > 0);

    function bonoFormHtml(targetId, targetName) {
      return `
        <div class="line-item-edit line-item-bono-form" style="display:none;">
          <p style="font-size:12px;color:var(--ink-faint);margin:0 0 10px;">"${escapeHtml(targetName)}" pasa a ser la sesión indicada de un bono nuevo — los demás tratamientos de esta cita, si los hay, no se tocan.</p>
          <div class="panel-field-row">
            <div class="panel-field"><label>Esta cita es la sesión nº</label><input type="number" min="1" step="1" class="li-bono-session" value="1"></div>
            <div class="panel-field"><label>Total de sesiones del bono</label><input type="number" min="1" step="1" class="li-bono-total"></div>
          </div>
          <div class="panel-field-row">
            <div class="panel-field"><label>Precio total del bono (€)</label><input type="number" step="0.01" class="li-bono-price"></div>
          </div>
          <label class="panel-checkbox-row" style="display:flex;align-items:center;gap:8px;margin:6px 0 10px;">
            <input type="checkbox" class="li-bono-fully-paid" checked> Ya está pagado del todo
          </label>
          <div class="panel-field-row li-bono-fullpaid-row">
            <div class="panel-field"><label>Pagado con</label>
              <select class="li-bono-paidhow"><option value="efectivo">Efectivo</option><option value="bizum">Bizum</option><option value="tarjeta">Tarjeta</option></select>
            </div>
          </div>
          <div class="panel-field-row li-bono-partial-row" style="display:none;">
            <div class="panel-field"><label>Efectivo (€)</label><input type="number" step="0.01" min="0" class="li-bono-paid-cash" value="0"></div>
            <div class="panel-field"><label>Bizum (€)</label><input type="number" step="0.01" min="0" class="li-bono-paid-bizum" value="0"></div>
            <div class="panel-field"><label>Tarjeta (€)</label><input type="number" step="0.01" min="0" class="li-bono-paid-card" value="0"></div>
          </div>
          <button type="button" class="panel-btn panel-btn-accent panel-btn-sm li-bono-save-btn">🎟 Convertir en bono</button>
          <div class="li-bono-next-slot" style="margin-top:14px;"></div>
        </div>`;
    }

    // Si la línea del bono todavía tiene sesiones libres, se puede agendar
    // la siguiente ahí mismo — antes solo se podía desde la tarjeta del
    // bono en "Bonos activos", aparte de la propia cita.
    const linkedBono = isBonoSession && client && Array.isArray(client.bonos)
      ? client.bonos.find((bo) => bo.bonoId === b.bonoId) : null;

    const treatmentLinesHtml = idParts.map((id, i) => {
      const isBonoCore = isBonoSession && i === 0;
      const name = nameForIdx(id, i);
      const canBookNext = isBonoCore && linkedBono && Number(linkedBono.sessionsRemaining) > 0;
      return `
        <div class="line-item" data-treatment-idx="${i}">
          <div class="line-item-row">
            <div class="line-item-main"><div class="line-item-name">${escapeHtml(name)}${isBonoCore ? ' <span class="line-item-meta">(del bono)</span>' : ''}</div></div>
            <div class="line-item-actions">
              <button type="button" class="panel-btn panel-btn-accent panel-btn-sm li-edit-toggle">✎ Editar</button>
              ${!isBonoCore ? `<button type="button" class="panel-btn panel-btn-accent panel-btn-sm li-bono-toggle">🎟 Bono</button>` : ''}
              ${canBookNext ? `<button type="button" class="panel-btn panel-btn-accent panel-btn-sm li-next-session-toggle">+ Siguiente sesión</button>` : ''}
              ${idParts.length > 1 ? `<button type="button" class="panel-btn panel-btn-accent panel-btn-sm li-remove-btn">🗑 Quitar</button>` : ''}
            </div>
          </div>
          <div class="line-item-edit" style="display:none;">
            <div class="panel-field-row">
              <div class="panel-field" style="flex:2;"><label>Tratamiento</label><select class="li-swap-service">${serviceOptionsHtml(id)}</select></div>
              ${isBonoCore ? `<div class="panel-field"><label>Nº de esta sesión</label><input type="number" min="1" step="1" class="li-session-number" value="${b.sessionNumber || ''}"></div>` : ''}
            </div>
            <div style="display:flex; gap:8px;">
              <button type="button" class="panel-btn panel-btn-primary panel-btn-sm li-save-btn">Guardar línea</button>
              <button type="button" class="panel-btn panel-btn-ghost panel-btn-sm li-cancel-btn">Cancelar</button>
            </div>
          </div>
          ${!isBonoCore ? bonoFormHtml(id, name) : ''}
          ${canBookNext ? '<div class="li-next-session-slot" style="display:none;"><div class="panel-new-appt-slot"></div></div>' : ''}
        </div>`;
    }).join('');

    const extraLinesHtml = extras.map((ex) => {
      const catLabel = (EXTRA_CATS.find((c) => c.id === ex.category) || {}).label || 'Producto';
      return `
        <div class="line-item" data-sale-id="${ex.saleId}">
          <div class="line-item-row">
            <div class="line-item-main"><div class="line-item-name">${escapeHtml(ex.product)} <span class="line-item-meta">(extra · ${catLabel})</span></div></div>
            <div class="line-item-price">${ex.amount.toFixed(2)} €</div>
            <div class="line-item-actions">
              <button type="button" class="panel-btn panel-btn-accent panel-btn-sm li-extra-edit-toggle">✎ Editar</button>
              <button type="button" class="panel-btn panel-btn-accent panel-btn-sm li-extra-remove-btn">🗑 Quitar</button>
            </div>
          </div>
          <div class="line-item-edit" style="display:none;">
            <div class="cat-pills">${EXTRA_CATS.map((c) => `<div class="cat-pill li-extra-cat${c.id === (ex.category || 'venta') ? ' active' : ''}" data-cat="${c.id}">${c.label}</div>`).join('')}</div>
            <input type="hidden" class="li-extra-cat-value" value="${ex.category || 'venta'}">
            <div class="panel-field-row">
              <div class="panel-field" style="flex:2;"><label>Detalle</label><input type="text" class="li-extra-detail" value="${escapeHtml(ex.product)}"></div>
              <div class="panel-field"><label>Importe (€)</label><input type="number" step="0.01" class="li-extra-amount" value="${ex.amount}"></div>
            </div>
            <div class="panel-field-row">
              <div class="panel-field"><label>Pagado con</label>${extraPaidHowSelectHtml('li-extra-paidhow', ex.paidHow)}</div>
            </div>
            <div style="display:flex; gap:8px;">
              <button type="button" class="panel-btn panel-btn-primary panel-btn-sm li-extra-save-btn">Guardar línea</button>
              <button type="button" class="panel-btn panel-btn-ghost panel-btn-sm li-extra-cancel-btn">Cancelar</button>
            </div>
          </div>
        </div>`;
    }).join('');

    const alreadyPaid = Number(b.amountPaid) || 0;
    const expectedTotal = Number(b.price) || alreadyPaid;
    const pendingAtCenter = Math.max(0, expectedTotal - alreadyPaid);
    const closedNote = b.finalAmount !== null && b.finalAmount !== undefined
      ? `<p class="panel-status">Ya cerrada — total ${b.finalAmount.toFixed(2)} €${b.remainderPaidHow ? ` (resto: ${b.remainderPaidHow}${b.remainderAmount2 ? ` + ${b.remainderPaidHow2} ${b.remainderAmount2.toFixed(2)} €` : ''})` : ''}${b.redeemedAmount ? ` · saldo canjeado: ${b.redeemedAmount.toFixed(2)} €` : ''}</p>`
      : '';

    slot.innerHTML = `
      <div class="panel-new-appt">
        <div class="panel-label">Editar cita</div>
        ${balance > 0 ? `<span class="panel-pill panel-loyalty-pill">💰 Saldo de fidelización: ${balance.toFixed(2)} €</span>` : ''}

        <div class="panel-section-label" style="margin-top:14px;">Líneas de esta cita</div>
        ${treatmentLinesHtml}${extraLinesHtml}

        <div class="panel-section-label">Añadir una línea</div>
        <div class="type-tabs">
          <div class="type-tab active" data-type="treatment">Tratamiento (con hora reservada)</div>
          <div class="type-tab" data-type="extra">Extra (sin tiempo, solo contabilidad)</div>
        </div>
        <div class="add-line-treatment">
          <div class="panel-field-row">
            <div class="panel-field" style="flex:2;"><select class="eb-add-service"><option value="">Elige un tratamiento…</option>${serviceOptionsHtml()}</select></div>
            <div class="panel-field"><button type="button" class="panel-btn panel-btn-accent eb-confirm-add">+ Añadir</button></div>
          </div>
          <label class="panel-split-toggle"><input type="checkbox" class="eb-add-no-time"> Ya se hizo, no hace falta comprobar hueco ni alargar la cita en el calendario</label>
        </div>
        <div class="add-line-extra" style="display:none;">
          <p style="font-size:12px;color:var(--ink-faint);margin:0 0 10px;">Para cualquier cosa que se cobre en esta visita sin necesitar hueco de agenda — un tratamiento hecho de más, un producto, etc.</p>
          <div class="cat-pills">${EXTRA_CATS.map((c, i) => `<div class="cat-pill eb-extra-cat${i === 0 ? ' active' : ''}" data-cat="${c.id}">${c.label}</div>`).join('')}</div>
          <input type="hidden" class="eb-extra-cat-value" value="${EXTRA_CATS[0].id}">
          <div class="panel-field-row">
            <div class="panel-field" style="flex:2;"><label>Detalle (qué fue)</label><input type="text" class="eb-extra-detail" placeholder="Ej. Limpieza facial, Crema hidratante…"></div>
            <div class="panel-field"><label>Importe (€)</label><input type="number" step="0.01" class="eb-extra-amount"></div>
          </div>
          <div class="panel-field-row">
            <div class="panel-field"><label>Pagado con</label>${extraPaidHowSelectHtml('eb-extra-paidhow', '')}</div>
          </div>
          <p style="font-size:11px;color:var(--ink-faint);margin:0 0 10px;">Déjalo en "Igual que el resto" si se paga junto con el tratamiento — solo cámbialo si esta línea en concreto se paga de otra forma.</p>
          <button type="button" class="panel-btn panel-btn-accent eb-confirm-extra">+ Añadir extra</button>
        </div>

        <div class="panel-section-label">Notas de la cita</div>
        <div class="panel-field-row">
          <div class="panel-field" style="flex:1;"><textarea class="eb-notes" rows="2" placeholder="Ej. potencia 18, zona íntimo completo">${escapeHtml(b.notes)}</textarea></div>
        </div>

        <div class="panel-section-label">Profesional</div>
        <div class="panel-field-row">
          <div class="panel-field"><select class="eb-employee"><option value="">No cambiar</option>${employeeOptions}</select></div>
        </div>

        <div class="panel-section-label">Cobro</div>
        ${closedNote}
        ${!closedNote ? `<p class="panel-status">Ya pagado antes: <b>${alreadyPaid.toFixed(2)} €</b>${b.depositPaidHow ? ` (${b.depositPaidHow})` : ''} · Queda por cobrar (estimado): <b>${pendingAtCenter.toFixed(2)} €</b></p>` : ''}
        ${unresolvedExtrasTotal > 0 ? `<p class="panel-status">Además, hay <b>${unresolvedExtrasTotal.toFixed(2)} €</b> en extras sin forma de pago asignada — se resuelven solos al cerrar la cita, con la misma forma de pago del resto.</p>` : ''}
        <p style="font-size:11px;color:var(--ink-faint);margin:0 0 10px;">El importe de aquí es solo el del tratamiento propio de esta cita — los extras van aparte y no hace falta sumarlos.</p>
        <div class="panel-field-row">
          <div class="panel-field"><label>Precio total (€)</label><input type="number" step="0.01" class="eb-price" value="${b.price || ''}"></div>
          <div class="panel-field"><label>Ya pagado (€)</label><input type="number" step="0.01" class="eb-paid" value="${b.amountPaid || ''}"></div>
          <div class="panel-field"><label>Ese "ya pagado", ¿cobrado en persona con…?</label>
            <select class="eb-deposit-paidhow">
              <option value=""${!b.depositPaidHow ? ' selected' : ''}>No — es una seña pagada online</option>
              <option value="efectivo"${b.depositPaidHow === 'efectivo' ? ' selected' : ''}>Efectivo</option>
              <option value="tarjeta"${b.depositPaidHow === 'tarjeta' ? ' selected' : ''}>Tarjeta</option>
              <option value="bizum"${b.depositPaidHow === 'bizum' ? ' selected' : ''}>Bizum</option>
            </select>
          </div>
        </div>
        ${!isClosable ? '<button type="button" class="panel-btn panel-btn-primary panel-confirm-editbooking">Guardar cambios</button>' : ''}
        <p class="panel-error" style="display:none;"></p>
        <p class="panel-status eb-status" style="display:none;"></p>

        ${isClosable ? `
        <div class="line-item-edit" style="margin-top:16px;">
          <div class="panel-label" style="margin-bottom:8px;">Cerrar cita — importe total real</div>
          <p style="font-size:11px;color:var(--ink-faint);margin:0 0 10px;">Este botón guarda también el precio/pagado/profesional/notas de arriba a la vez — no hace falta pulsar "Guardar cambios" aparte.</p>
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
          <p class="panel-status pf-remainder-preview" style="margin:-6px 0 10px;"></p>
          <div class="panel-field-row">
            <div class="panel-field"><label>Bono regalo (código, opcional)</label><input type="text" class="pf-giftcode" placeholder="Ej. REGALO2026"></div>
          </div>
          ${balance > 0 ? `
          <div class="panel-field-row">
            <div class="panel-field"><label>Descontar saldo de fidelización (€) — disponible ${balance.toFixed(2)} € (mínimo 10 €)</label><input type="number" step="0.01" class="pf-redeem" min="10" max="${balance}"></div>
          </div>` : ''}
          ${linkedBono && Number(linkedBono.remainingAmount) > 0 ? `
          <div class="panel-field-row">
            <div class="panel-field"><label>Este bono aún tiene pendiente ${Number(linkedBono.remainingAmount).toFixed(2)} € — ¿cuánto paga de eso hoy? (€)</label><input type="number" step="0.01" min="0" max="${Number(linkedBono.remainingAmount)}" class="pf-bono-paydown"></div>
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
          <button type="button" class="panel-btn panel-btn-primary panel-confirm-close">💶 Guardar y cerrar cita</button>
          <p class="panel-error pf-error" style="display:none;"></p>
        </div>` : ''}
      </div>
    `;

    const errorEl = slot.querySelector('.panel-error');
    const statusEl = slot.querySelector('.eb-status');

    // ── Pestañas "Añadir una línea": Tratamiento / Extra ──
    const addLineTreatmentBox = slot.querySelector('.add-line-treatment');
    const addLineExtraBox = slot.querySelector('.add-line-extra');
    slot.querySelectorAll('.type-tabs .type-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        slot.querySelectorAll('.type-tabs .type-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        const isTreatment = tab.getAttribute('data-type') === 'treatment';
        addLineTreatmentBox.style.display = isTreatment ? 'block' : 'none';
        addLineExtraBox.style.display = isTreatment ? 'none' : 'block';
      });
    });
    slot.querySelectorAll('.add-line-extra .eb-extra-cat').forEach((pill) => {
      pill.addEventListener('click', () => {
        slot.querySelectorAll('.add-line-extra .eb-extra-cat').forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        slot.querySelector('.eb-extra-cat-value').value = pill.getAttribute('data-cat');
      });
    });

    // ── Guardar cambios (precio/pagado/profesional/notas) — solo existe este
    // botón aparte cuando la cita todavía no se puede cerrar; si ya se
    // puede, "Guardar y cerrar cita" hace las dos cosas de una vez (ver más
    // abajo, junto a "Cerrar cita").
    const saveBtn = slot.querySelector('.panel-confirm-editbooking');
    if (saveBtn) {
      saveBtn.addEventListener('click', async (ev) => {
        errorEl.style.display = 'none';
        statusEl.style.display = 'none';
        ev.target.disabled = true;
        try {
          const employeeSelect = slot.querySelector('.eb-employee');
          const priceInput = slot.querySelector('.eb-price');
          const paidInput = slot.querySelector('.eb-paid');
          const depositPaidHowSelect = slot.querySelector('.eb-deposit-paidhow');
          const notesInput = slot.querySelector('.eb-notes');
          await panelFetch('/panel/edit-booking', {
            method: 'POST',
            body: JSON.stringify({
              bookingId: b.bookingId,
              employeeId: employeeSelect.value || undefined,
              price: priceInput.value,
              amountPaid: paidInput.value,
              depositPaidHow: depositPaidHowSelect.value,
            }),
          });
          if (notesInput.value !== (b.notes || '')) {
            await panelFetch('/panel/note', { method: 'POST', body: JSON.stringify({ bookingId: b.bookingId, note: notesInput.value }) });
          }
          doSearch();
        } catch (e) {
          errorEl.textContent = e.message;
          errorEl.style.display = 'block';
          ev.target.disabled = false;
        }
      });
    }

    // ── Añadir tratamiento ──
    slot.querySelector('.eb-confirm-add').addEventListener('click', async (ev) => {
      const addServiceSelect = slot.querySelector('.eb-add-service');
      if (!addServiceSelect.value) {
        errorEl.textContent = 'Elige qué tratamiento añadir.';
        errorEl.style.display = 'block';
        return;
      }
      errorEl.style.display = 'none';
      ev.target.disabled = true;
      try {
        const noTimeInput = slot.querySelector('.eb-add-no-time');
        await panelFetch('/panel/edit-booking', {
          method: 'POST',
          body: JSON.stringify({
            bookingId: b.bookingId,
            addServiceId: addServiceSelect.value,
            addWithoutTimeExtend: noTimeInput && noTimeInput.checked ? true : undefined,
          }),
        });
        doSearch();
      } catch (e) {
        errorEl.textContent = e.message;
        errorEl.style.display = 'block';
        ev.target.disabled = false;
      }
    });

    // ── Añadir extra ──
    slot.querySelector('.eb-confirm-extra').addEventListener('click', async (ev) => {
      const detailInput = slot.querySelector('.eb-extra-detail');
      const amountInput = slot.querySelector('.eb-extra-amount');
      const catValue = slot.querySelector('.eb-extra-cat-value').value;
      const paidHowValue = slot.querySelector('.eb-extra-paidhow').value;
      if (!detailInput.value.trim() || !amountInput.value) {
        errorEl.textContent = 'Indica el detalle y el importe del extra.';
        errorEl.style.display = 'block';
        return;
      }
      errorEl.style.display = 'none';
      ev.target.disabled = true;
      try {
        await panelFetch('/panel/product-sale', {
          method: 'POST',
          body: JSON.stringify({
            date: b.date, product: detailInput.value.trim(), amount: amountInput.value,
            category: catValue, bookingId: b.bookingId,
            paidHow: paidHowValue === 'auto' ? undefined : paidHowValue,
            clientPhone: client ? client.phone : '', clientName: client ? client.name : '', clientEmail: client ? client.email : '',
          }),
        });
        doSearch();
      } catch (e) {
        errorEl.textContent = e.message;
        errorEl.style.display = 'block';
        ev.target.disabled = false;
      }
    });

    // ── Cada línea de tratamiento: Editar / Bono / Quitar ──
    slot.querySelectorAll('.line-item[data-treatment-idx]').forEach((lineEl) => {
      const idx = Number(lineEl.getAttribute('data-treatment-idx'));
      const id = idParts[idx];
      const name = nameForIdx(id, idx);
      const isBonoCore = isBonoSession && idx === 0;
      const editBox = lineEl.querySelector('.line-item-edit:not(.line-item-bono-form)');
      const editToggle = lineEl.querySelector('.li-edit-toggle');
      editToggle.addEventListener('click', () => {
        editBox.style.display = editBox.style.display === 'none' ? 'block' : 'none';
      });
      lineEl.querySelector('.li-cancel-btn').addEventListener('click', () => { editBox.style.display = 'none'; });

      const nextSessionToggle = lineEl.querySelector('.li-next-session-toggle');
      if (nextSessionToggle) {
        nextSessionToggle.addEventListener('click', async () => {
          const nextSlot = lineEl.querySelector('.li-next-session-slot');
          const inner = nextSlot.querySelector('.panel-new-appt-slot');
          if (nextSlot.style.display !== 'none') { nextSlot.style.display = 'none'; return; }
          nextSlot.style.display = 'block';
          if (!inner.innerHTML) await toggleBookSessionForm(nextSlot, linkedBono, null, client);
        });
      }

      lineEl.querySelector('.li-save-btn').addEventListener('click', async (ev) => {
        const newId = lineEl.querySelector('.li-swap-service').value;
        const sessionInput = lineEl.querySelector('.li-session-number');
        errorEl.style.display = 'none';
        ev.target.disabled = true;
        try {
          if (newId && newId !== id) {
            await panelFetch('/panel/edit-booking', {
              method: 'POST',
              body: JSON.stringify({ bookingId: b.bookingId, swapServiceId: { from: id, to: newId } }),
            });
          }
          if (isBonoCore && sessionInput && sessionInput.value && String(sessionInput.value) !== String(b.sessionNumber || '')) {
            await panelFetch('/panel/edit-booking', {
              method: 'POST',
              body: JSON.stringify({ bookingId: b.bookingId, sessionNumber: sessionInput.value }),
            });
          }
          doSearch();
        } catch (e) {
          errorEl.textContent = e.message;
          errorEl.style.display = 'block';
          ev.target.disabled = false;
        }
      });

      const bonoToggle = lineEl.querySelector('.li-bono-toggle');
      if (bonoToggle) {
        const bonoBox = lineEl.querySelector('.line-item-bono-form');
        bonoToggle.addEventListener('click', () => {
          bonoBox.style.display = bonoBox.style.display === 'none' ? 'block' : 'none';
        });

        const fullyPaidCheck = bonoBox.querySelector('.li-bono-fully-paid');
        const fullPaidRow = bonoBox.querySelector('.li-bono-fullpaid-row');
        const partialRow = bonoBox.querySelector('.li-bono-partial-row');
        fullyPaidCheck.addEventListener('change', () => {
          fullPaidRow.style.display = fullyPaidCheck.checked ? 'flex' : 'none';
          partialRow.style.display = fullyPaidCheck.checked ? 'none' : 'flex';
        });

        bonoBox.querySelector('.li-bono-save-btn').addEventListener('click', async (ev) => {
          const totalInput = bonoBox.querySelector('.li-bono-total');
          const sessionInput = bonoBox.querySelector('.li-bono-session');
          const bonoPriceInput = bonoBox.querySelector('.li-bono-price');
          const paidHowSelect = bonoBox.querySelector('.li-bono-paidhow');
          const cashInput = bonoBox.querySelector('.li-bono-paid-cash');
          const bizumInput = bonoBox.querySelector('.li-bono-paid-bizum');
          const cardInput = bonoBox.querySelector('.li-bono-paid-card');
          if (!totalInput.value || !sessionInput.value) {
            errorEl.textContent = 'Indica el número de esta sesión y el total de sesiones del bono.';
            errorEl.style.display = 'block';
            return;
          }
          // "Ya está pagado del todo" pone el precio entero en la forma de
          // pago elegida — para el caso normal, sin tener que repartir a
          // mano entre efectivo/bizum/tarjeta. Solo hace falta desmarcarlo
          // si de verdad queda algo pendiente de cobrar del bono.
          let cash = 0; let bizum = 0; let card = 0;
          if (fullyPaidCheck.checked) {
            const fullAmount = Number(bonoPriceInput.value) || 0;
            if (paidHowSelect.value === 'efectivo') cash = fullAmount;
            else if (paidHowSelect.value === 'bizum') bizum = fullAmount;
            else card = fullAmount;
          } else {
            cash = Number(cashInput.value) || 0;
            bizum = Number(bizumInput.value) || 0;
            card = Number(cardInput.value) || 0;
          }
          const confirmMsg = fullyPaidCheck.checked
            ? `¿Convertir "${name}" en la sesión ${sessionInput.value}/${totalInput.value} de un bono nuevo, pagado del todo (${(cash + bizum + card).toFixed(2)} €, ${paidHowSelect.value})?`
            : `¿Convertir "${name}" en la sesión ${sessionInput.value}/${totalInput.value} de un bono nuevo? Pagado hasta ahora: ${(cash + bizum + card).toFixed(2)} €.`;
          if (!confirm(confirmMsg)) return;
          errorEl.style.display = 'none';
          ev.target.disabled = true;
          try {
            const data = await panelFetch('/panel/edit-booking', {
              method: 'POST',
              body: JSON.stringify({
                bookingId: b.bookingId, convertToBono: true, bonoTargetServiceId: id,
                bonoSessionNumber: sessionInput.value, bonoTotalSessions: totalInput.value, bonoTotalPrice: bonoPriceInput.value,
                bonoPaidCash: cash, bonoPaidBizum: bizum, bonoPaidCard: card,
              }),
            });
            ev.target.style.display = 'none';
            statusEl.textContent = 'Bono registrado ✓ — elige cuándo es la próxima sesión aquí abajo.';
            statusEl.style.display = 'block';
            const total = Number(totalInput.value);
            const used = Number(sessionInput.value);
            const syntheticBono = {
              bonoId: data.convertedBonoId, serviceId: id, serviceName: name,
              sessionsUsed: used, totalSessions: total, sessionsRemaining: Math.max(0, total - used),
            };
            const nextSlot = bonoBox.querySelector('.li-bono-next-slot');
            nextSlot.innerHTML = '<div class="panel-new-appt-slot"></div>';
            if (syntheticBono.sessionsRemaining > 0) {
              await toggleBookSessionForm(nextSlot, syntheticBono, null, client);
            }
          } catch (e) {
            errorEl.textContent = e.message;
            errorEl.style.display = 'block';
            ev.target.disabled = false;
          }
        });
      }

      const removeBtn = lineEl.querySelector('.li-remove-btn');
      if (removeBtn) {
        removeBtn.addEventListener('click', async (ev) => {
          const confirmMsg = isBonoCore
            ? '¿Quitar el tratamiento del bono de esta cita? Se le devolverá la sesión a la clienta (no se cuenta como usada) y esta cita se queda solo con los tratamientos extra, si los hay.'
            : '¿Quitar este tratamiento de la cita? Los demás se quedan igual.';
          if (!confirm(confirmMsg)) return;
          errorEl.style.display = 'none';
          ev.target.disabled = true;
          try {
            await panelFetch('/panel/edit-booking', {
              method: 'POST',
              body: JSON.stringify({ bookingId: b.bookingId, removeServiceId: id }),
            });
            doSearch();
          } catch (e) {
            errorEl.textContent = e.message;
            errorEl.style.display = 'block';
            ev.target.disabled = false;
          }
        });
      }
    });

    // ── Cada línea "extra": Editar / Quitar ──
    slot.querySelectorAll('.line-item[data-sale-id]').forEach((lineEl) => {
      const saleId = lineEl.getAttribute('data-sale-id');
      const editBox = lineEl.querySelector('.line-item-edit');
      lineEl.querySelector('.li-extra-edit-toggle').addEventListener('click', () => {
        editBox.style.display = editBox.style.display === 'none' ? 'block' : 'none';
      });
      lineEl.querySelector('.li-extra-cancel-btn').addEventListener('click', () => { editBox.style.display = 'none'; });
      lineEl.querySelectorAll('.li-extra-cat').forEach((pill) => {
        pill.addEventListener('click', () => {
          lineEl.querySelectorAll('.li-extra-cat').forEach((p) => p.classList.remove('active'));
          pill.classList.add('active');
          lineEl.querySelector('.li-extra-cat-value').value = pill.getAttribute('data-cat');
        });
      });
      lineEl.querySelector('.li-extra-save-btn').addEventListener('click', async (ev) => {
        errorEl.style.display = 'none';
        ev.target.disabled = true;
        try {
          await panelFetch('/panel/product-sale-edit', {
            method: 'POST',
            body: JSON.stringify({
              saleId,
              product: lineEl.querySelector('.li-extra-detail').value.trim(),
              amount: lineEl.querySelector('.li-extra-amount').value,
              category: lineEl.querySelector('.li-extra-cat-value').value,
              paidHow: lineEl.querySelector('.li-extra-paidhow').value,
            }),
          });
          doSearch();
        } catch (e) {
          errorEl.textContent = e.message;
          errorEl.style.display = 'block';
          ev.target.disabled = false;
        }
      });
      lineEl.querySelector('.li-extra-remove-btn').addEventListener('click', async (ev) => {
        if (!confirm('¿Quitar esta línea extra de la cuenta de esta cita?')) return;
        errorEl.style.display = 'none';
        ev.target.disabled = true;
        try {
          await panelFetch('/panel/product-sale-edit', { method: 'POST', body: JSON.stringify({ saleId, deleted: true }) });
          doSearch();
        } catch (e) {
          errorEl.textContent = e.message;
          errorEl.style.display = 'block';
          ev.target.disabled = false;
        }
      });
    });

    // ── Cerrar cita (si procede) ──
    const closeBox = slot.querySelector('.panel-confirm-close');
    if (closeBox) {
      const amountInput = slot.querySelector('.pf-amount');
      const paidHowSelect = slot.querySelector('.pf-paidhow');
      const redeemInput = slot.querySelector('.pf-redeem');
      const giftCodeInput = slot.querySelector('.pf-giftcode');
      const bonoPaydownInput = slot.querySelector('.pf-bono-paydown');
      const splitToggle = slot.querySelector('.pf-split');
      const splitRow = slot.querySelector('.pf-split-row');
      const amount2Input = slot.querySelector('.pf-amount2');
      const paidHow2Select = slot.querySelector('.pf-paidhow2');
      const pfErrorEl = slot.querySelector('.pf-error');
      const remainderPreview = slot.querySelector('.pf-remainder-preview');
      // Muestra en vivo cuánto queda de verdad por cobrar en el centro —
      // antes solo se veía el importe total, y no quedaba claro que una
      // cita ya pagada del todo (p.ej. seña online = precio) no tiene
      // nada más que cobrar aquí, aunque el desplegable de forma de pago
      // se siguiera mostrando como si hiciera falta elegir una.
      function updateRemainderPreview() {
        const total = Number(amountInput.value) || 0;
        const remainder = Math.max(0, round2ForDisplay(total - alreadyPaid));
        remainderPreview.textContent = remainder > 0
          ? `Queda por cobrar en el centro: ${remainder.toFixed(2)} €`
          : '✓ Ya está pagado del todo — no queda nada más por cobrar en el centro.';
      }
      function round2ForDisplay(n) { return Math.round(n * 100) / 100; }
      amountInput.addEventListener('input', updateRemainderPreview);
      updateRemainderPreview();
      splitToggle.addEventListener('change', () => {
        splitRow.style.display = splitToggle.checked ? 'grid' : 'none';
      });
      closeBox.addEventListener('click', async (ev) => {
        pfErrorEl.style.display = 'none';
        const totalToConfirm = Number(amountInput.value) || 0;
        if (!confirm(`¿Confirmas el cierre con un total de ${totalToConfirm.toFixed(2)} €?`)) return;
        ev.target.disabled = true;
        try {
          // Un solo botón guarda precio/pagado/profesional/notas Y cierra la
          // cita, en vez de obligar a pulsar "Guardar cambios" aparte antes
          // (eso recargaba la búsqueda entera y volvía a cerrar este panel,
          // así que había que reabrirlo para poder cerrar la cita después).
          const employeeSelect = slot.querySelector('.eb-employee');
          const priceInput = slot.querySelector('.eb-price');
          const paidInput = slot.querySelector('.eb-paid');
          const depositPaidHowSelect = slot.querySelector('.eb-deposit-paidhow');
          const notesInput = slot.querySelector('.eb-notes');
          await panelFetch('/panel/edit-booking', {
            method: 'POST',
            body: JSON.stringify({
              bookingId: b.bookingId,
              employeeId: employeeSelect.value || undefined,
              price: priceInput.value,
              amountPaid: paidInput.value,
              depositPaidHow: depositPaidHowSelect.value,
            }),
          });
          if (notesInput.value !== (b.notes || '')) {
            await panelFetch('/panel/note', { method: 'POST', body: JSON.stringify({ bookingId: b.bookingId, note: notesInput.value }) });
          }
          await panelFetch('/panel/close', {
            method: 'POST',
            body: JSON.stringify({
              bookingId: b.bookingId, finalAmount: amountInput.value, paidHow: paidHowSelect.value,
              remainderAmount2: splitToggle.checked ? amount2Input.value : 0,
              paidHow2: splitToggle.checked ? paidHow2Select.value : '',
              redeemAmount: redeemInput ? redeemInput.value : 0,
              giftCode: giftCodeInput ? giftCodeInput.value.trim() : '',
              bonoPaydown: bonoPaydownInput ? bonoPaydownInput.value : 0,
            }),
          });
          doSearch();
          refreshAgendaBadge();
        } catch (e) {
          pfErrorEl.textContent = e.message;
          pfErrorEl.style.display = 'block';
          ev.target.disabled = false;
        }
      });
    }
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

  async function toggleReschedule(apptEl, b, client) {
    const slot = apptEl.querySelector('.panel-reschedule-slot');
    if (slot.innerHTML) { slot.innerHTML = ''; return; }

    // Si otros tratamientos de la misma clienta comparten fecha/hora/
    // profesional (una visita combinada), se puede elegir cuáles mover —
    // los que se dejen sin marcar se quedan en su hora actual.
    const siblings = (client && client.bookings || []).filter((x) => x.bookingId !== b.bookingId
      && x.status === 'confirmed' && x.date === b.date && x.time === b.time && x.employeeId === b.employeeId);
    const group = [b, ...siblings];
    const picksHtml = group.length > 1 ? group.map((x) => `
      <label class="resched-pick" style="display:flex;align-items:center;gap:10px;border:1px solid var(--sage);border-radius:4px;padding:9px 12px;margin-bottom:6px;background:var(--sage-bg);">
        <input type="checkbox" class="resched-pick-check" value="${x.bookingId}" checked>
        <div>${escapeHtml(x.serviceName)}</div>
      </label>
    `).join('') : '';

    slot.innerHTML = `
      <div class="panel-new-appt">
        <div class="panel-label">Reprogramar — ${escapeHtml(b.serviceName)} (ahora: ${b.date} a las ${b.time})</div>
        ${group.length > 1 ? `
          <p class="panel-status" style="margin-bottom:10px;">Esta cita comparte hueco con otros tratamientos de la misma visita. Marca los que quieres mover — los que dejes sin marcar se quedan donde estaban.</p>
          <div class="resched-picks">${picksHtml}</div>
        ` : ''}
        <div class="panel-field-row">
          <div class="panel-field"><label>Nueva fecha</label><input type="date" class="pf-date"></div>
          <div class="panel-field"><label>Nueva hora (huecos libres)</label><select class="pf-time"><option>Elige fecha primero</option></select></div>
          <div class="panel-field"><label>O escribe una hora a mano</label><input type="time" step="300" class="pf-time-manual"></div>
        </div>
        <p style="font-size:11.5px;color:var(--ink-soft);margin:-6px 0 10px;">Si escribes la hora a mano, se usa esa en vez del desplegable — úsalo si sabes que en realidad sí hay hueco aunque el sistema no lo vea.</p>
        <button type="button" class="panel-btn panel-btn-primary panel-confirm-resched">Confirmar cambio</button>
        <p class="panel-error" style="display:none;"></p>
      </div>
    `;
    const dateInput = slot.querySelector('.pf-date');
    const timeSelect = slot.querySelector('.pf-time');
    const timeManualInput = slot.querySelector('.pf-time-manual');
    const errorEl = slot.querySelector('.panel-error');
    const checks = Array.from(slot.querySelectorAll('.resched-pick-check'));

    dateInput.addEventListener('change', async () => {
      timeSelect.innerHTML = '<option>Cargando…</option>';
      try {
        const data = await panelFetch(`/panel/reschedule-slots?bookingId=${b.bookingId}&date=${dateInput.value}`);
        const slots = data.slots || [];
        timeSelect.innerHTML = slots.length ? slots.map((t) => `<option value="${t}">${t}</option>`).join('') : '<option value="">Sin huecos ese día</option>';
      } catch (e) {
        timeSelect.innerHTML = `<option value="">Error: ${escapeHtml(e.message)}</option>`;
      }
    });

    slot.querySelector('.panel-confirm-resched').addEventListener('click', async (ev) => {
      errorEl.style.display = 'none';
      const manualTime = timeManualInput.value; // "HH:MM" o vacío
      const chosenTime = manualTime || timeSelect.value;
      if (!dateInput.value || !chosenTime) {
        errorEl.textContent = 'Elige fecha y hora.';
        errorEl.style.display = 'block';
        return;
      }
      const selectedIds = checks.length ? checks.filter((c) => c.checked).map((c) => c.value) : [b.bookingId];
      if (!selectedIds.length) {
        errorEl.textContent = 'Marca al menos un tratamiento para mover.';
        errorEl.style.display = 'block';
        return;
      }
      if (manualTime && !confirm(`Vas a forzar la cita a las ${manualTime}, aunque el sistema no la vea como libre. ¿Seguro?`)) return;
      ev.target.disabled = true;
      try {
        if (selectedIds.length > 1) {
          await panelFetch('/panel/reschedule-combined', {
            method: 'POST',
            body: JSON.stringify({ bookingIds: selectedIds, date: dateInput.value, time: chosenTime, force: !!manualTime }),
          });
        } else {
          await panelFetch('/panel/reschedule', {
            method: 'POST',
            body: JSON.stringify({ bookingId: selectedIds[0], date: dateInput.value, time: chosenTime, force: !!manualTime }),
          });
        }
        doSearch();
      } catch (e) {
        errorEl.textContent = e.message;
        errorEl.style.display = 'block';
        ev.target.disabled = false;
      }
    });
  }
})();
