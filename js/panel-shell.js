// ============================================================
// Estructura del panel: menú lateral (abajo en el móvil) y calendario del
// día por profesional. No cambia ninguna función de js/panel.js: coloca sus
// bloques en secciones y abre cada herramienta con su botón de siempre.
// ============================================================
(function () {
  const app = document.getElementById('panel-app');
  if (!app) return;

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v === undefined || v === null ? '' : v).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  const VIEWS = [
    { id: 'calendar', icon: '📅', label: 'Calendario' },
    { id: 'clients', icon: '👤', label: 'Clientas', blocks: ['.panel-mode-toggle', '#panel-existing-view', '#panel-new-view'] },
    { id: 'alerts', icon: '🔔', label: 'Avisos', tools: [{ label: 'Avisos', toggle: 'panel-agenda-toggle', slot: 'panel-agenda-slot' }] },
    { id: 'payments', icon: '🧾', label: 'Cobros', tools: [{ label: 'Cobros', toggle: 'panel-payments-toggle', slot: 'panel-payments-slot' }] },
    { id: 'sales', icon: '💰', label: 'Ventas', tools: [
      { label: 'Venta de producto', toggle: 'panel-sale-toggle', slot: 'panel-sale-slot' },
      { label: 'Presupuesto', toggle: 'panel-quote-toggle', slot: 'panel-quote-slot' },
      { label: 'Bono regalo', toggle: 'panel-gift-toggle', slot: 'panel-gift-slot' },
    ] },
    { id: 'marketing', icon: '📣', label: 'Marketing', tools: [
      { label: 'Descuentos', toggle: 'panel-discount-toggle', slot: 'panel-discount-slot' },
      { label: 'Campaña de email', toggle: 'panel-campaign-toggle', slot: 'panel-campaign-slot' },
    ] },
    { id: 'reports', icon: '📊', label: 'Informes', tools: [
      { label: 'Informe trimestral', toggle: 'panel-report-toggle', slot: 'panel-report-slot' },
      { label: 'Depurar huecos', toggle: 'panel-debugavail-toggle', slot: 'panel-debugavail-slot' },
    ] },
  ];

  document.body.classList.add('shell-on');
  document.querySelector('.panel-tools-row').classList.add('shell-hidden-tools');
  const topbar = document.querySelector('.panel-topbar');
  const logout = $('panel-logout');
  topbar.classList.add('shell-hidden-tools');

  // ---------- Menú ----------
  const nav = document.createElement('nav');
  nav.className = 'shell-nav';
  nav.setAttribute('aria-label', 'Secciones del panel');
  nav.innerHTML = `<div class="shell-brand">OSANA</div>${VIEWS.map((v) => `
    <button type="button" class="shell-nav-btn" data-view="${v.id}">
      <span class="shell-nav-icon" aria-hidden="true">${v.icon}</span><span>${v.label}</span>
    </button>`).join('')}
    <div class="shell-nav-spacer"></div>
    <button type="button" class="shell-nav-btn" data-logout>
      <span class="shell-nav-icon" aria-hidden="true">↩</span><span>Salir</span>
    </button>`;
  app.prepend(nav);
  nav.querySelector('[data-logout]').addEventListener('click', () => logout.click());

  // ---------- Secciones ----------
  const sections = {};
  VIEWS.forEach((v) => {
    const section = document.createElement('section');
    section.className = 'shell-view';
    section.hidden = true;
    section.innerHTML = `<h1 class="shell-view-title">${v.label}</h1>`;
    (v.blocks || []).forEach((selector) => {
      const el = document.querySelector(selector);
      if (el) section.appendChild(el);
    });
    if (v.tools && v.tools.length > 1) {
      const tabs = document.createElement('div');
      tabs.className = 'shell-tabs';
      v.tools.forEach((tool, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'shell-tab';
        b.textContent = tool.label;
        b.addEventListener('click', () => openTool(v, i));
        tabs.appendChild(b);
      });
      section.appendChild(tabs);
    }
    (v.tools || []).forEach((tool) => {
      const slot = $(tool.slot);
      if (slot) section.appendChild(slot);
    });
    app.appendChild(section);
    sections[v.id] = section;
  });

  const activeTool = {};

  // Cada herramienta abre o cierra su contenido con su botón: solo se pulsa
  // si está cerrada, para no cerrar algo que la persona estaba rellenando.
  function openTool(view, index) {
    activeTool[view.id] = index;
    view.tools.forEach((tool, i) => {
      $(tool.slot).style.display = i === index ? '' : 'none';
    });
    sections[view.id].querySelectorAll('.shell-tab').forEach((b, i) => b.classList.toggle('is-active', i === index));
    const tool = view.tools[index];
    if (!$(tool.slot).innerHTML.trim()) $(tool.toggle).click();
  }

  let currentView = null;
  function showView(id) {
    currentView = id;
    VIEWS.forEach((v) => { sections[v.id].hidden = v.id !== id; });
    nav.querySelectorAll('[data-view]').forEach((b) => {
      const on = b.dataset.view === id;
      b.classList.toggle('is-active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    const view = VIEWS.find((v) => v.id === id);
    if (view.tools) openTool(view, activeTool[id] || 0);
    if (id === 'calendar') loadCalendar();
    window.scrollTo(0, 0);
  }
  nav.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

  // Si otra herramienta abre una ficha (p. ej. "Ver ficha" desde Avisos), se
  // pasa a Clientas para que el resultado no quede en una sección oculta.
  new MutationObserver(() => {
    if (currentView !== 'clients' && $('panel-results').innerHTML.trim()) showView('clients');
  }).observe($('panel-results'), { childList: true });

  // El número de avisos lo escribe panel.js en su botón de siempre.
  const alertsBtn = nav.querySelector('[data-view="alerts"]');
  function syncBadge() {
    const m = $('panel-agenda-toggle').textContent.match(/\d+/);
    let badge = alertsBtn.querySelector('.shell-nav-badge');
    if (!m) { if (badge) badge.remove(); return; }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'shell-nav-badge';
      alertsBtn.appendChild(badge);
    }
    badge.textContent = m[0];
  }
  new MutationObserver(syncBadge).observe($('panel-agenda-toggle'), { childList: true, subtree: true, characterData: true });
  syncBadge();

  // ---------- Calendario ----------
  const PX_PER_MIN = 1.2;
  const pad = (n) => String(n).padStart(2, '0');
  const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  let calDate = toISO(new Date());
  let calRequest = 0;
  let employeesCache = null;

  const calSection = sections.calendar;
  calSection.querySelector('.shell-view-title').remove();
  calSection.insertAdjacentHTML('beforeend', `
    <div class="cal-toolbar">
      <h1 class="cal-date" id="cal-date-label"></h1>
      <button type="button" class="cal-btn" id="cal-prev" aria-label="Día anterior">‹</button>
      <button type="button" class="cal-btn" id="cal-today">Hoy</button>
      <button type="button" class="cal-btn" id="cal-next" aria-label="Día siguiente">›</button>
      <input type="date" class="cal-picker" id="cal-picker" aria-label="Elegir fecha">
      <button type="button" class="cal-btn cal-btn-primary" id="cal-new">+ Nueva cita</button>
    </div>
    <p class="cal-status" id="cal-status" role="status"></p>
    <div class="cal-scroll"><div class="cal-grid" id="cal-grid"></div></div>
    <div class="cal-legend">
      <span><i style="background:#efe6d6"></i>Confirmada</span>
      <span><i style="background:var(--sage-bg)"></i>Cerrada</span>
      <span><i style="background:var(--amber-bg)"></i>Pendiente de pago</span>
      <span><i style="background:var(--rose-bg)"></i>Falta</span>
    </div>`);

  function moveDay(delta) {
    const d = new Date(`${calDate}T12:00:00`);
    d.setDate(d.getDate() + delta);
    calDate = toISO(d);
    loadCalendar();
  }
  $('cal-prev').addEventListener('click', () => moveDay(-1));
  $('cal-next').addEventListener('click', () => moveDay(1));
  $('cal-today').addEventListener('click', () => { calDate = toISO(new Date()); loadCalendar(); });
  $('cal-picker').addEventListener('change', (e) => { if (e.target.value) { calDate = e.target.value; loadCalendar(); } });
  $('cal-new').addEventListener('click', () => {
    showView('clients');
    $('panel-mode-new-btn').click();
  });

  async function getEmployees() {
    if (employeesCache) return employeesCache;
    const res = await fetch(`${BOOKING_API_BASE}/employees`);
    const data = await res.json();
    employeesCache = data.employees || [];
    return employeesCache;
  }

  const toMinutes = (t) => {
    const m = String(t || '').match(/^(\d{1,2}):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };

  async function loadCalendar() {
    const request = ++calRequest;
    const status = $('cal-status');
    const label = new Date(`${calDate}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    $('cal-date-label').textContent = label;
    $('cal-picker').value = calDate;
    status.className = 'cal-status';
    status.textContent = 'Cargando…';
    const key = localStorage.getItem('osana_panel_key') || '';
    if (!key) { status.textContent = ''; return; }
    try {
      const [employees, res] = await Promise.all([
        getEmployees(),
        fetch(`${BOOKING_API_BASE}/panel/calendar?date=${calDate}`, { headers: { 'x-panel-key': key } }),
      ]);
      if (request !== calRequest) return;
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo cargar el calendario.');
      const untimed = renderCalendar(employees, data.bookings || []);
      const n = (data.bookings || []).length;
      status.textContent = n ? `${n} ${n === 1 ? 'cita' : 'citas'}` : 'Sin citas este día.';
      if (untimed) status.textContent += ` · ${untimed} sin hora válida: búscalas en Clientas.`;
    } catch (e) {
      if (request !== calRequest) return;
      status.className = 'cal-status cal-status-error';
      status.textContent = e.message || 'No se pudo cargar el calendario.';
    }
  }

  function renderCalendar(employees, bookings) {
    const columns = employees.map((e) => ({ id: e.id, name: e.name, items: [] }));
    const byId = new Map(columns.map((c) => [c.id, c]));
    const noColumn = { id: '', name: 'Sin asignar', items: [] };
    const untimed = [];
    bookings.forEach((b) => {
      if (toMinutes(b.time) === null) { untimed.push(b); return; }
      (byId.get(b.employeeId) || noColumn).items.push(b);
    });
    if (noColumn.items.length) columns.push(noColumn);

    let first = 9 * 60;
    let last = 20 * 60;
    bookings.forEach((b) => {
      const start = toMinutes(b.time);
      if (start === null) return;
      first = Math.min(first, start);
      last = Math.max(last, start + b.durationMinutes);
    });
    first = Math.floor(first / 60) * 60;
    last = Math.ceil(last / 60) * 60;
    const height = (last - first) * PX_PER_MIN;
    const rowSize = 60 * PX_PER_MIN;

    const grid = $('cal-grid');
    grid.style.gridTemplateColumns = `56px repeat(${columns.length}, minmax(170px, 1fr))`;
    let hours = '';
    for (let m = first + 60; m < last; m += 60) {
      hours += `<span class="cal-hour" style="top:${(m - first) * PX_PER_MIN}px">${pad(m / 60)}:00</span>`;
    }
    const isToday = calDate === toISO(new Date());
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const nowLine = isToday && nowMin >= first && nowMin <= last
      ? `<div class="cal-now" style="top:${(nowMin - first) * PX_PER_MIN}px"></div>` : '';

    // Citas que se solapan en una columna: se reparten el ancho, una al lado
    // de otra, para que ninguna tape a la otra.
    const layout = new Map();
    columns.forEach((c) => {
      const sorted = [...c.items].sort((x, y) => toMinutes(x.time) - toMinutes(y.time));
      let group = [];
      let groupEnd = -1;
      const flush = () => {
        const laneEnds = [];
        group.forEach((b) => {
          const start = toMinutes(b.time);
          let lane = laneEnds.findIndex((end) => end <= start);
          if (lane === -1) lane = laneEnds.length;
          laneEnds[lane] = start + b.durationMinutes;
          layout.set(b, lane);
        });
        group.forEach((b) => layout.set(b, { lane: layout.get(b), lanes: laneEnds.length }));
        group = [];
      };
      sorted.forEach((b) => {
        const start = toMinutes(b.time);
        if (group.length && start >= groupEnd) { flush(); groupEnd = -1; }
        group.push(b);
        groupEnd = Math.max(groupEnd, start + b.durationMinutes);
      });
      if (group.length) flush();
    });

    const eventHtml = (b) => {
      const top = (toMinutes(b.time) - first) * PX_PER_MIN;
      const h = Math.max(b.durationMinutes * PX_PER_MIN - 2, 26);
      const { lane, lanes } = layout.get(b);
      const place = `left:calc(${(lane / lanes) * 100}% + 3px);width:calc(${100 / lanes}% - 6px)`;
      const state = /no_show/.test(b.status) ? 'is-noshow'
        : b.status === 'done' || b.finalAmount ? 'is-done'
          : /pending/.test(b.status) ? 'is-pending' : '';
      return `<button type="button" class="cal-event ${state}" data-booking="${esc(b.bookingId)}" style="top:${top}px;height:${h}px;${place}">
        <b>${esc(b.time)} · ${esc(b.name)}</b><span>${esc(b.serviceName)}</span></button>`;
    };

    grid.innerHTML = `<div class="cal-corner"></div>${columns.map((c) => `<div class="cal-head">${esc(c.name)}</div>`).join('')}
      <div class="cal-hours" style="position:sticky;height:${height}px">${hours}</div>
      ${columns.map((c) => `<div class="cal-col" style="height:${height}px;background-size:100% ${rowSize}px">${nowLine}${c.items.map(eventHtml).join('')}</div>`).join('')}`;

    const lookup = new Map(bookings.map((b) => [b.bookingId, b]));
    grid.querySelectorAll('.cal-event').forEach((el) => {
      el.addEventListener('click', () => openDrawer(lookup.get(el.dataset.booking)));
    });
    const starts = bookings.map((b) => toMinutes(b.time)).filter((m) => m !== null);
    const scroller = grid.parentElement;
    const target = isToday && nowMin >= first && nowMin <= last ? nowMin : (starts.length ? Math.min(...starts) : first);
    scroller.scrollTop = Math.max(0, (target - first) * PX_PER_MIN - 30);
    return untimed.length;
  }

  // ---------- Detalle de la cita ----------
  const STATUS_LABEL = {
    confirmed: 'Confirmada', done: 'Cerrada', pending: 'Pendiente de pago', no_show: 'Falta', no_show_forgiven: 'Falta perdonada',
  };

  function openDrawer(b) {
    if (!b) return;
    const previousFocus = document.activeElement;
    const back = document.createElement('div');
    back.className = 'cal-drawer-back';
    const panel = document.createElement('aside');
    panel.className = 'cal-drawer';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Detalle de la cita');
    const digits = String(b.phone || '').replace(/\D/g, '');
    const row = (k, v) => (v ? `<dt>${k}</dt><dd>${esc(v)}</dd>` : '');
    panel.innerHTML = `
      <button type="button" class="cal-drawer-close" aria-label="Cerrar">✕</button>
      <h3>${esc(b.name)}</h3>
      <dl>
        ${row('Hora', `${b.time} · ${b.durationMinutes} min`)}
        ${row('Tratamiento', b.serviceName)}
        ${row('Profesional', b.employeeName)}
        ${row('Estado', STATUS_LABEL[b.status] || b.status)}
        ${row('Sesión', b.sessionNumber)}
        ${row('Precio', b.price ? `${b.price} €` : '')}
        ${row('Ya pagado', b.amountPaid ? `${b.amountPaid} €` : '')}
        ${row('Teléfono', b.phone)}
        ${row('Email', b.email)}
        ${row('Notas', b.notes)}
      </dl>
      <div class="cal-drawer-actions">
        <button type="button" class="is-main" data-open>Abrir ficha · cobrar, mover o cancelar</button>
        ${digits ? `<a href="tel:+${esc(digits)}">Llamar</a><a href="https://wa.me/${esc(digits)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
      </div>`;
    const close = () => {
      back.remove();
      panel.remove();
      document.removeEventListener('keydown', onKey);
      if (previousFocus) previousFocus.focus();
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    back.addEventListener('click', close);
    panel.querySelector('.cal-drawer-close').addEventListener('click', close);
    panel.querySelector('[data-open]').addEventListener('click', () => {
      close();
      showView('clients');
      $('panel-mode-existing-btn').click();
      $('panel-search-input').value = b.phone || b.name || '';
      $('panel-search-btn').click();
    });
    document.body.append(back, panel);
    panel.querySelector('.cal-drawer-close').focus();
  }

  // ---------- Arranque: al entrar (o nada más iniciar sesión) ----------
  let started = false;
  function startIfVisible() {
    if (started || app.style.display === 'none') return;
    started = true;
    showView('calendar');
  }
  new MutationObserver(startIfVisible).observe(app, { attributes: true, attributeFilter: ['style'] });
  startIfVisible();
})();
