// ============================================================
// Fase 2 · Paso 1 — Auditoría de una COPIA de la Google Sheet real.
//
// Solo LEE (permiso "spreadsheets.readonly": aunque quisiera, no puede
// escribir). Lee cada pestaña igual que sheets.js (por posición, valores
// formateados) y comprueba si cada celda cabría en las columnas con tipo
// de Supabase, usando los mismos conversores que db-supabase.js.
//
// El informe NO contiene datos de clientas: solo pestaña, columna, número
// de fila y el PATRÓN del valor (dígitos → N, letras → A; p. ej.
// "31/12/2026" → "NN/NN/NNNN"). Para las columnas sí/no también se
// muestra la palabra si es una de las típicas (sí, x, TRUE...).
//
// Dos formas de leer la copia:
//
// A) Archivo Excel descargado de la copia (Archivo → Descargar → .xlsx).
//    No hace falta Google Cloud. El archivo se queda en el Mac (fuera del
//    repositorio) y se borra al terminar.
//      node tools/audit-sheet.js --xlsx ~/Downloads/COPIA....xlsx
//    En la Sheet, lo que escribe el código es siempre TEXTO (RAW). Una celda
//    que en el Excel llega como número, fecha o sí/no la tecleó alguien a
//    mano: se cuenta aparte ("con tipo") porque necesita una regla de
//    limpieza aunque hoy pase el control.
//
// B) API de Google con una cuenta de servicio de solo lectura. Variables en
//    booking-api/.env.local:
//      AUDIT_SHEET_ID     ID de la COPIA (el código entre /d/ y /edit)
//      AUDIT_SA_KEY_FILE  ruta al JSON de la cuenta de servicio (fuera del repo)
//      node tools/audit-sheet.js
//
// En los dos casos imprime el resumen y escribe tools/.out/auditoria.md.
// ============================================================
const fs = require('fs');
const path = require('path');
const { loadEnvLocal } = require('./lib/env');

const API = path.join(__dirname, '..', 'booking-api');
const { TABLES, snake } = require(path.join(API, 'src', 'lib', 'db-schema.js'));
const { _lab } = require(path.join(API, 'src', 'lib', 'db-supabase.js'));

const TYPE_LABEL = {
  int: 'número entero', num: 'número', date: 'fecha AAAA-MM-DD', ts: 'fecha y hora ISO', boolTF: "'true'/'false'",
};
const KNOWN_FLAG_WORDS = new Set(['si', 'sí', 'no', 'x', 'ok', 'yes', 'true', 'false', 'verdadero', 'falso', '0', '1', '2',
  'sent', 'enviado', 'enviada', 'hecho', 'done', 'v', '✓', '✔', '-']);

const typeLabel = (t) => (t.startsWith('bool:') ? `'${t.slice(5)}' o vacío` : TYPE_LABEL[t] || t);

// "31/12/2026" → "NN/NN/NNNN" · "10,5 €" → "NN,N €" · nunca devuelve el valor.
function pattern(v) {
  // Primero letras → A y después dígitos → N (al revés, la N se volvería A).
  const p = String(v).replace(/\p{L}/gu, 'A').replace(/\d/g, 'N').replace(/\s+/g, ' ');
  return p.length > 30 ? `${p.slice(0, 30)}… (${p.length} car.)` : p;
}

function shown(type, v) {
  const lower = String(v).trim().toLowerCase();
  if ((type.startsWith('bool') || type === 'int') && KNOWN_FLAG_WORDS.has(lower)) return `"${String(v).trim()}"`;
  return pattern(v);
}

// ---------- Lectura de un .xlsx como si fuera la API de Sheets ----------
const pad2 = (n) => String(n).padStart(2, '0');

// Valor de una celda de exceljs → { text, kind } donde kind es null si la
// celda era texto (lo que escribe el código) o el tipo si la tecleó alguien.
function xlsxCell(v) {
  if (v === null || v === undefined) return { text: '', kind: null };
  if (typeof v === 'string') return { text: v, kind: null };
  if (typeof v === 'number') return { text: String(v), kind: 'número' };
  if (typeof v === 'boolean') return { text: v ? 'TRUE' : 'FALSE', kind: 'sí/no' };
  if (v instanceof Date) {
    const d = `${pad2(v.getUTCDate())}/${pad2(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`;
    const hasTime = v.getUTCHours() || v.getUTCMinutes() || v.getUTCSeconds();
    return { text: hasTime ? `${d} ${pad2(v.getUTCHours())}:${pad2(v.getUTCMinutes())}:${pad2(v.getUTCSeconds())}` : d, kind: 'fecha' };
  }
  if (Array.isArray(v.richText)) return { text: v.richText.map((r) => r.text).join(''), kind: null };
  if (v.formula !== undefined || v.sharedFormula !== undefined) {
    const inner = xlsxCell(v.result);
    return { text: inner.text, kind: 'fórmula' };
  }
  if (v.text !== undefined) return { text: String(v.text), kind: null }; // enlace
  if (v.error !== undefined) return { text: String(v.error), kind: 'error' };
  return { text: String(v), kind: 'otro' };
}

async function loadXlsx(file) {
  const ExcelJS = require(path.join(API, 'node_modules', 'exceljs'));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const tabs = new Map(); // título → filas de texto
  const typed = new Map(); // título → Map(colIndex 0-based → Map(kind → {count, rows[]}))
  wb.eachSheet((ws) => {
    const rows = [];
    const t = new Map();
    for (let r = 1; r <= ws.rowCount; r++) {
      const values = ws.getRow(r).values || []; // 1-indexado
      const row = [];
      for (let c = 1; c < values.length; c++) {
        const { text, kind } = xlsxCell(values[c]);
        row[c - 1] = text;
        if (kind && r > 1) {
          if (!t.has(c - 1)) t.set(c - 1, new Map());
          const byKind = t.get(c - 1);
          if (!byKind.has(kind)) byKind.set(kind, { count: 0, rows: [] });
          const e = byKind.get(kind);
          e.count++;
          if (e.rows.length < 10) e.rows.push(r);
        }
      }
      for (let c = 0; c < row.length; c++) if (row[c] === undefined) row[c] = '';
      rows.push(row);
    }
    tabs.set(ws.name, rows);
    typed.set(ws.name, t);
  });
  // Cliente mínimo con la misma forma que la API de Sheets (solo lo que usa audit()).
  const client = {
    spreadsheets: {
      async get() { return { data: { sheets: [...tabs.keys()].map((title) => ({ properties: { title } })) } }; },
      values: {
        async get({ range }) {
          const title = String(range).match(/^'(.+)'!/)[1];
          const rows = (tabs.get(title) || []).map((r) => { const x = [...r]; while (x.length && x[x.length - 1] === '') x.pop(); return x; });
          while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
          return { data: rows.length ? { values: rows } : {} };
        },
      },
    },
  };
  return { client, typed };
}

// Lógica de la auditoría, separada de Google para poder probarla con la
// hoja falsa (tools/lib/fake-sheets.js). "typed" solo llega en modo Excel.
async function audit(sheets, spreadsheetId, { typed } = {}) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'properties.title,sheets.properties.title' });
  const titles = (meta.data.sheets || []).map((s) => s.properties.title);
  const report = { titles, tabs: [] };

  for (const [key, def] of Object.entries(TABLES)) {
    const title = key === 'bookings' ? titles[0] : def.tab;
    const tab = { key, title, table: def.table, problems: [] };
    report.tabs.push(tab);
    if (!titles.includes(title)) { tab.missing = true; continue; }

    // Igual que sheets.js: valores formateados (lo que ve el código), pero
    // pedimos hasta la ZZ para detectar columnas de más.
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${title}'!A:ZZ` });
    const rows = res.data.values || [];
    const header = rows[0] || [];
    const cols = def.columns;
    tab.rows = Math.max(0, rows.length - 1);

    // Cabecera: el código la reescribe sola, así que una diferencia indica
    // que alguien movió o insertó columnas a mano (los datos se leen por posición).
    const expected = cols.map(([c]) => c);
    tab.headerDiffs = [];
    expected.forEach((c, i) => { if ((header[i] || '') !== c) tab.headerDiffs.push({ col: i + 1, expected: c, found: header[i] || '(vacía)' }); });
    if (header.length > expected.length) tab.extraHeader = header.slice(expected.length);

    const byColumn = new Map(); // columna → { type, count, patterns: Map(pattern → {count, rows[]}) }
    const emptyRows = [];
    let rowsWithExtraCells = 0;
    const firstExtraRows = [];
    const ids = new Map();

    rows.slice(1).forEach((row, i) => {
      const sheetRow = i + 2;
      if (row.every((v) => String(v).trim() === '')) { emptyRows.push(sheetRow); return; }
      if (row.slice(cols.length).some((v) => String(v).trim() !== '')) {
        rowsWithExtraCells++;
        if (firstExtraRows.length < 10) firstExtraRows.push(sheetRow);
      }
      cols.forEach(([name, type], c) => {
        const raw = row[c] !== undefined ? row[c] : '';
        try {
          _lab.toDb(def.table, name, type, raw);
        } catch (_) {
          if (!byColumn.has(name)) byColumn.set(name, { type, count: 0, patterns: new Map() });
          const col = byColumn.get(name);
          col.count++;
          const p = shown(type, raw);
          if (!col.patterns.has(p)) col.patterns.set(p, { count: 0, rows: [] });
          const entry = col.patterns.get(p);
          entry.count++;
          if (entry.rows.length < 10) entry.rows.push(sheetRow);
        }
      });
      for (const u of def.unique || []) {
        const idx = cols.findIndex(([c]) => c === u);
        const v = String(row[idx] || '').trim();
        if (!ids.has(u)) ids.set(u, { empty: [], seen: new Map() });
        const info = ids.get(u);
        if (!v) { info.empty.push(sheetRow); continue; }
        if (!info.seen.has(v)) info.seen.set(v, []);
        info.seen.get(v).push(sheetRow);
      }
    });

    tab.emptyRows = emptyRows;
    tab.rowsWithExtraCells = rowsWithExtraCells;
    tab.firstExtraRows = firstExtraRows;
    tab.columns = [...byColumn.entries()].map(([name, c]) => ({
      name, column: snake(name), type: c.type, count: c.count,
      patterns: [...c.patterns.entries()].sort((a, b) => b[1].count - a[1].count).map(([p, e]) => ({ pattern: p, ...e })),
    }));
    tab.ids = [...ids.entries()].map(([name, info]) => {
      const dups = [...info.seen.values()].filter((r) => r.length > 1);
      return { name, empty: info.empty, duplicates: dups.length, duplicateRows: dups.slice(0, 10) };
    });
    tab.badCells = tab.columns.reduce((n, c) => n + c.count, 0);

    // Celdas con tipo (solo Excel): número/fecha/sí/no/fórmula tecleados a mano.
    tab.typed = [];
    const t = typed && typed.get(title);
    if (t) {
      for (const [idx, byKind] of [...t.entries()].sort((a, b) => a[0] - b[0])) {
        const name = idx < cols.length ? cols[idx][0] : `(columna ${idx + 1}, fuera del código)`;
        for (const [kind, e] of byKind) tab.typed.push({ name, kind, count: e.count, rows: e.rows });
      }
    }
    tab.typedCells = tab.typed.reduce((n, x) => n + x.count, 0);
  }
  report.excel = Boolean(typed);
  return report;
}

function toMarkdown(report, when) {
  const L = [];
  L.push('# Auditoría de la copia de la Google Sheet');
  L.push('');
  L.push(`Generado por \`tools/audit-sheet.js\` el ${when}. Solo lectura. **No contiene datos de clientas**: solo pestaña, columna, número de fila y el patrón del valor (dígitos → \`N\`, letras → \`A\`).`);
  L.push('');
  L.push(`Pestañas en la copia, por orden: ${report.titles.map((t) => `\`${t}\``).join(', ')}. La primera (\`${report.titles[0]}\`) es la que el código usa como reservas.`);
  L.push('');
  L.push('## Resumen');
  L.push('');
  const ex = report.excel;
  L.push(`| Pestaña | Filas | Celdas que Supabase rechazaría |${ex ? ' Celdas con tipo (a mano) |' : ''} Cabecera distinta | Filas vacías en medio | Filas con celdas fuera de columnas | IDs repetidos | IDs vacíos |`);
  L.push(`|---|---|---|${ex ? '---|' : ''}---|---|---|---|---|`);
  for (const t of report.tabs) {
    if (t.missing) { L.push(`| ${t.title} | — no existe en la copia — | |${ex ? ' |' : ''} | | | | |`); continue; }
    const dup = t.ids.reduce((n, i) => n + i.duplicates, 0);
    const emptyIds = t.ids.reduce((n, i) => n + i.empty.length, 0);
    L.push(`| ${t.title} | ${t.rows} | ${t.badCells} |${ex ? ` ${t.typedCells} |` : ''} ${t.headerDiffs.length ? `sí (${t.headerDiffs.length})` : 'no'} | ${t.emptyRows.length} | ${t.rowsWithExtraCells} | ${t.ids.length ? dup : '—'} | ${t.ids.length ? emptyIds : '—'} |`);
  }
  L.push('');
  if (ex) {
    L.push('_Celdas con tipo_: en el Excel llegan como número, fecha, sí/no o fórmula. El código siempre escribe texto, así que esas las tecleó alguien a mano. En la Sheet se ven con el formato regional (p. ej. `10,5` o `31/12/2026`) y es lo que lee hoy el código: necesitan una regla de limpieza aunque algunas pasen el control.');
    L.push('');
  }
  for (const t of report.tabs) {
    if (t.missing) continue;
    const hasDetail = t.badCells || t.headerDiffs.length || t.emptyRows.length || t.rowsWithExtraCells || t.extraHeader
      || t.ids.some((i) => i.duplicates || i.empty.length) || (t.typed && t.typed.length);
    if (!hasDetail) continue;
    L.push(`## ${t.title} → \`${t.table}\``);
    L.push('');
    if (t.headerDiffs.length) {
      L.push('**Cabecera distinta a la del código** (columnas movidas o insertadas a mano: los datos se leen por posición):');
      t.headerDiffs.slice(0, 15).forEach((d) => L.push(`- columna ${d.col}: se esperaba \`${d.expected}\`, hay \`${d.found}\``));
      L.push('');
    }
    if (t.extraHeader) L.push(`Columnas de más a la derecha (el código las ignora): ${t.extraHeader.map((h) => `\`${h || '(sin nombre)'}\``).join(', ')}.\n`);
    if (t.rowsWithExtraCells) L.push(`${t.rowsWithExtraCells} filas tienen datos fuera de las columnas del código (se perderían al importar). Primeras filas: ${t.firstExtraRows.join(', ')}.\n`);
    if (t.emptyRows.length) L.push(`Filas vacías en medio: ${t.emptyRows.slice(0, 20).join(', ')}${t.emptyRows.length > 20 ? '…' : ''} (hoy el código las lee como registros vacíos).\n`);
    for (const i of t.ids) {
      if (i.duplicates) L.push(`\`${i.name}\` repetido en ${i.duplicates} casos. Filas: ${i.duplicateRows.map((r) => r.join('/')).join(' · ')}.\n`);
      if (i.empty.length) L.push(`\`${i.name}\` vacío en ${i.empty.length} filas (primeras: ${i.empty.slice(0, 10).join(', ')}).\n`);
    }
    if (t.columns.length) {
      L.push('| Columna | Tipo en Supabase | Celdas | Patrón | Veces | Primeras filas |');
      L.push('|---|---|---|---|---|---|');
      for (const c of t.columns) {
        c.patterns.slice(0, 6).forEach((p, k) => {
          L.push(`| ${k === 0 ? `\`${c.name}\`` : ''} | ${k === 0 ? typeLabel(c.type) : ''} | ${k === 0 ? c.count : ''} | \`${p.pattern.replace(/\|/g, '\\|')}\` | ${p.count} | ${p.rows.join(', ')} |`);
        });
        if (c.patterns.length > 6) L.push(`| | | | … ${c.patterns.length - 6} patrones más | | |`);
      }
      L.push('');
    }
    if (t.typed && t.typed.length) {
      L.push('Celdas con tipo (tecleadas a mano):');
      L.push('');
      L.push('| Columna | Tipo en el Excel | Celdas | Primeras filas |');
      L.push('|---|---|---|---|');
      t.typed.forEach((x) => L.push(`| \`${x.name}\` | ${x.kind} | ${x.count} | ${x.rows.join(', ')} |`));
      L.push('');
    }
  }
  return L.join('\n');
}

function writeAndPrint(report) {
  const when = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const out = path.join(__dirname, '.out', 'auditoria.md');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, toMarkdown(report, when));
  console.log(`Pestañas: ${report.titles.join(' · ')}\n`);
  for (const t of report.tabs) {
    if (t.missing) { console.log(`  ${t.title.padEnd(16)} NO EXISTE`); continue; }
    const dup = t.ids.reduce((n, i) => n + i.duplicates, 0);
    const typedTxt = report.excel ? ` · con tipo ${t.typedCells}` : '';
    console.log(`  ${t.title.padEnd(16)} ${String(t.rows).padStart(6)} filas · ${String(t.badCells).padStart(5)} celdas a revisar${typedTxt} · cabecera ${t.headerDiffs.length ? 'DISTINTA' : 'ok'} · vacías ${t.emptyRows.length} · IDs repetidos ${dup}`);
  }
  console.log(`\nInforme (sin datos de clientas): ${path.relative(process.cwd(), out)}`);
}

async function main() {
  loadEnvLocal();
  const xi = process.argv.indexOf('--xlsx');
  if (xi > -1) {
    const file = process.argv[xi + 1];
    if (!file || !fs.existsSync(file)) { console.error('No encuentro el archivo .xlsx indicado.'); process.exit(2); }
    if (path.resolve(file).startsWith(path.resolve(__dirname, '..'))) {
      console.error('El Excel con datos reales está dentro del repositorio: muévelo fuera (p. ej. a Descargas).');
      process.exit(2);
    }
    const { client, typed } = await loadXlsx(file);
    writeAndPrint(await audit(client, 'xlsx', { typed }));
    return;
  }
  const sheetId = (process.env.AUDIT_SHEET_ID || '').trim();
  const keyFile = (process.env.AUDIT_SA_KEY_FILE || '').trim();
  if (!sheetId || !keyFile) {
    console.error('Faltan AUDIT_SHEET_ID y/o AUDIT_SA_KEY_FILE en booking-api/.env.local.');
    process.exit(2);
  }
  if (path.resolve(keyFile).startsWith(path.resolve(__dirname, '..'))) {
    console.error('El JSON de la cuenta de servicio está dentro del repositorio: muévelo fuera (p. ej. a Descargas).');
    process.exit(2);
  }
  if (process.env.GOOGLE_SHEET_ID && process.env.GOOGLE_SHEET_ID.trim() === sheetId) {
    console.error('AUDIT_SHEET_ID es igual que GOOGLE_SHEET_ID: usa la COPIA, no la hoja que usa la web.');
    process.exit(2);
  }
  const { google } = require(path.join(API, 'node_modules', 'googleapis'));
  const creds = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  writeAndPrint(await audit(sheets, sheetId));
}

module.exports = { audit, toMarkdown, pattern, loadXlsx };

if (require.main === module) main().catch((e) => { console.error('Error:', e.message); process.exit(2); });
