// ============================================================
// OSANA — Panel de edición (solo visible con ?edit en la URL)
// Permite modificar textos, precios y colores en el navegador,
// y exportar los cambios para publicarlos de verdad.
// ============================================================
(function () {
  const params = new URLSearchParams(location.search);
  if (!params.has('edit')) return;

  const COLOR_VARS = [
    ['--cream', 'Fondo general (crema)'],
    ['--cream2', 'Fondo secciones claras'],
    ['--dark', 'Negro / detalles'],
    ['--brown', 'Marrón (cabeceras, acentos)'],
    ['--gold', 'Dorado (acento principal)'],
    ['--sage', 'Verde salvia (acento suave)'],
    ['--txt', 'Texto principal'],
  ];

  const EDITABLE_SELECTORS = [
    '.hero-title-mix .line-italic', '.hero-title-mix .line-caps', '.hero-title', '.hero-sub', '.hero-eyebrow',
    '.section-title', '.section-eyebrow', '.pillar-title', '.pillar-text',
    '.statement-title', '.statement-text', '.stat-n', '.stat-label',
    '.tile-name', '.tile-desc',
    '.svc-name', '.svc-sub', '.svc-desc', '.svc-desde-price', '.svc-cta-note', '.svc-badge',
    '.sub-block-name', '.sub-block-desc', '.sub-block-price', '.sub-title',
    '.ptable td', '.ptable th',
    '.course-name', '.course-oneliner', '.course-duration', '.course-price', '.course-details-body li', '.course-photo-badge',
    '.promo-tag', '.promo-title', '.promo-desc', '.promo-price-old', '.promo-price-new', '.promo-valid',
    '.promo-featured-title', '.promo-featured-desc',
    '.page-hero-title', '.page-hero-text', '.page-hero-eyebrow',
    '.contact-val', '.contact-sub', '.contact-label',
    '.footer-brand-text', '.booking-title', '.booking-text', '.booking-eyebrow',
    '.intro-text', '.intro-count', '.ticker-item'
  ];

  const STORAGE_KEY = 'osana_edits::' + location.pathname;
  const COLOR_KEY = 'osana_colors';

  function selectorPath(el) {
    const path = [];
    let cur = el;
    while (cur && cur.nodeType === 1) {
      if (cur.id) { path.unshift('#' + CSS.escape(cur.id)); return path.join('>'); }
      let seg = cur.tagName.toLowerCase();
      const parent = cur.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
        if (same.length > 1) seg += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')';
      }
      path.unshift(seg);
      if (!parent || cur === document.body) break;
      cur = parent;
    }
    return path.join('>');
  }

  function loadJSON(key) {
    try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { return {}; }
  }
  function saveJSON(key, obj) { localStorage.setItem(key, JSON.stringify(obj)); }

  function applyColors() {
    const saved = loadJSON(COLOR_KEY);
    Object.entries(saved).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));
    return saved;
  }

  function applyTextEdits() {
    const saved = loadJSON(STORAGE_KEY);
    Object.entries(saved).forEach(([sel, html]) => {
      try {
        const el = document.querySelector(sel);
        if (el) el.innerHTML = html;
      } catch (e) {}
    });
  }

  function buildPanel() {
    const btn = document.createElement('button');
    btn.id = 'osed-btn';
    btn.textContent = '✦ Editar página';
    document.body.appendChild(btn);

    const panel = document.createElement('div');
    panel.id = 'osed-panel';
    panel.innerHTML = `
      <div class="osed-header">
        <span class="osed-title">Editor Osana</span>
        <button class="osed-close" aria-label="Cerrar">✕</button>
      </div>
      <div class="osed-note">
        Modo vista previa: los cambios se guardan en <strong>este navegador</strong>.
        Para publicarlos de verdad en la web real, pulsa "Descargar página"
        (o "Copiar colores") y pásamelos — o dímelo y los aplico yo.
      </div>

      <div class="osed-section">Modo edición de texto</div>
      <div class="osed-row">
        <label class="osed-toggle">
          <input type="checkbox" id="osed-text-toggle">
          <span>Activar edición de textos y precios</span>
        </label>
        <p class="osed-hint">Con esto activado, haz clic en cualquier título, descripción o precio de la página para escribir encima.</p>
      </div>

      <div class="osed-section">Colores</div>
      <div id="osed-colors"></div>

      <div class="osed-section">Exportar</div>
      <div class="osed-row">
        <button id="osed-download" class="osed-action">↓ Descargar esta página (.html)</button>
        <button id="osed-copy-colors" class="osed-action">📋 Copiar colores (CSS)</button>
        <button id="osed-reset" class="osed-action osed-action-danger">Restablecer esta página</button>
        <div id="osed-msg" class="osed-msg"></div>
      </div>
    `;
    document.body.appendChild(panel);

    const colorsWrap = panel.querySelector('#osed-colors');
    const savedColors = applyColors();
    COLOR_VARS.forEach(([varName, label]) => {
      const current = savedColors[varName] || getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || '#000000';
      const hex = current.startsWith('#') ? current : rgbToHex(current);
      const row = document.createElement('div');
      row.className = 'osed-color-row';
      row.innerHTML = `<span>${label}</span><input type="color" value="${hex}">`;
      row.querySelector('input').addEventListener('input', (e) => {
        document.documentElement.style.setProperty(varName, e.target.value);
        const colors = loadJSON(COLOR_KEY);
        colors[varName] = e.target.value;
        saveJSON(COLOR_KEY, colors);
      });
      colorsWrap.appendChild(row);
    });

    function rgbToHex(rgb) {
      const m = rgb.match(/\d+/g);
      if (!m) return '#000000';
      return '#' + m.slice(0, 3).map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
    }

    function setTextMode(on) {
      document.body.classList.toggle('osed-editing', on);
      const els = document.querySelectorAll(EDITABLE_SELECTORS.join(','));
      els.forEach(el => {
        el.contentEditable = on ? 'true' : 'false';
        if (on) {
          el.classList.add('osed-editable');
          el.addEventListener('blur', onBlurSave);
        } else {
          el.classList.remove('osed-editable');
          el.removeEventListener('blur', onBlurSave);
        }
      });
    }

    function onBlurSave(e) {
      const sel = selectorPath(e.target);
      if (!sel) return;
      const edits = loadJSON(STORAGE_KEY);
      edits[sel] = e.target.innerHTML;
      saveJSON(STORAGE_KEY, edits);
      flashMsg('Guardado ✓');
    }

    function flashMsg(text) {
      const msg = panel.querySelector('#osed-msg');
      msg.textContent = text;
      msg.classList.add('show');
      setTimeout(() => msg.classList.remove('show'), 2000);
    }

    panel.querySelector('#osed-text-toggle').addEventListener('change', (e) => setTextMode(e.target.checked));
    panel.querySelector('.osed-close').addEventListener('click', () => panel.classList.remove('open'));
    btn.addEventListener('click', () => panel.classList.toggle('open'));

    panel.querySelector('#osed-download').addEventListener('click', () => {
      const clone = document.documentElement.cloneNode(true);
      clone.querySelectorAll('#osed-panel, #osed-btn').forEach(n => n.remove());
      clone.querySelectorAll('.osed-editable').forEach(n => { n.removeAttribute('contenteditable'); n.classList.remove('osed-editable'); });
      clone.classList.remove('osed-editing');
      const html = '<!DOCTYPE html>\n' + clone.outerHTML;
      const blob = new Blob([html], { type: 'text/html' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (location.pathname.split('/').pop() || 'pagina') + '-editado.html';
      a.click();
      flashMsg('Descargado ✓');
    });

    panel.querySelector('#osed-copy-colors').addEventListener('click', () => {
      const colors = loadJSON(COLOR_KEY);
      const css = ':root {\n' + Object.entries(colors).map(([k, v]) => `  ${k}: ${v};`).join('\n') + '\n}';
      navigator.clipboard.writeText(css).then(() => flashMsg('Colores copiados ✓')).catch(() => flashMsg('No se pudo copiar'));
    });

    panel.querySelector('#osed-reset').addEventListener('click', () => {
      if (!confirm('¿Borrar los cambios de texto guardados en esta página?')) return;
      localStorage.removeItem(STORAGE_KEY);
      location.reload();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    applyTextEdits();
    buildPanel();
  });
})();
