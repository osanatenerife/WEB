// ============================================================
// Google Sheet FALSA en memoria: imita las llamadas de la API de Sheets que
// usa booking-api/src/lib/sheets.js (spreadsheets.get / batchUpdate y
// values.get / update / append con valueInputOption RAW). Permite ejecutar
// el sheets.js de verdad sin cuenta de Google y sin tocar ninguna hoja.
//
// Igual que la API real: se guarda texto tal cual (RAW), al leer se quitan
// las celdas vacías del final de cada fila y las filas vacías del final.
// ============================================================
const Module = require('module');
const path = require('path');

function colIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n; // 1-indexado
}

function parseRange(range) {
  const m = String(range).match(/^'(.+)'!([A-Z]+)(\d+)?(?::([A-Z]+)(\d+)?)?$/);
  if (!m) throw new Error(`Rango no soportado por la hoja falsa: ${range}`);
  return {
    tab: m[1],
    c1: colIndex(m[2]), r1: m[3] ? Number(m[3]) : 1,
    c2: m[4] ? colIndex(m[4]) : null, r2: m[5] ? Number(m[5]) : (m[3] && !m[4] ? Number(m[3]) : null),
  };
}

const trimRow = (row) => {
  const r = row.map((v) => (v === undefined || v === null ? '' : String(v)));
  while (r.length && r[r.length - 1] === '') r.pop();
  return r;
};

function createFakeSpreadsheet(firstTabTitle = 'Hoja 1') {
  const tabs = new Map([[firstTabTitle, []]]); // título → filas (arrays de texto)
  const stats = { calls: 0 };

  const tabRows = (tab) => {
    if (!tabs.has(tab)) throw new Error(`Unable to parse range: pestaña "${tab}" no existe`);
    return tabs.get(tab);
  };

  const writeAt = (rows, r1, c1, values) => {
    values.forEach((vals, i) => {
      const rowIdx = r1 - 1 + i;
      while (rows.length <= rowIdx) rows.push([]);
      const row = rows[rowIdx];
      vals.forEach((v, j) => { row[c1 - 1 + j] = v === undefined || v === null ? '' : String(v); });
    });
  };

  const client = {
    spreadsheets: {
      async get() {
        stats.calls++;
        return { data: { sheets: [...tabs.keys()].map((title) => ({ properties: { title } })) } };
      },
      async batchUpdate({ requestBody }) {
        stats.calls++;
        for (const req of requestBody.requests) {
          if (req.addSheet) tabs.set(req.addSheet.properties.title, []);
        }
        return { data: {} };
      },
      values: {
        async get({ range }) {
          stats.calls++;
          const { tab, c1, r1, c2, r2 } = parseRange(range);
          const rows = tabRows(tab);
          const last = r2 === null ? rows.length : Math.min(r2, rows.length);
          const out = [];
          for (let r = r1 - 1; r < last; r++) {
            const row = rows[r] || [];
            out.push(trimRow(row.slice(c1 - 1, c2 === null ? undefined : c2)));
          }
          while (out.length && out[out.length - 1].length === 0) out.pop();
          return { data: out.length ? { values: out } : {} };
        },
        async update({ range, requestBody }) {
          stats.calls++;
          const { tab, c1, r1 } = parseRange(range);
          writeAt(tabRows(tab), r1, c1, requestBody.values);
          return { data: {} };
        },
        async append({ range, requestBody }) {
          stats.calls++;
          const { tab, c1 } = parseRange(range);
          const rows = tabRows(tab);
          let lastFilled = rows.length;
          while (lastFilled > 0 && trimRow(rows[lastFilled - 1] || []).length === 0) lastFilled--;
          writeAt(rows, lastFilled + 1, c1, requestBody.values);
          return { data: {} };
        },
      },
    },
  };

  return {
    client,
    stats,
    tabs,
    setTab(title, rows) { tabs.set(title, rows.map((r) => r.map((v) => String(v)))); },
  };
}

// Carga booking-api/src/lib/sheets.js con la hoja falsa en lugar de Google.
// Devuelve el módulo sheets.js (backend "sheets") y la hoja falsa.
function loadSheetsWithFake(fake) {
  const sheetsPath = path.join(__dirname, '..', '..', 'booking-api', 'src', 'lib', 'sheets.js');
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    const fromSheets = parent && parent.filename === sheetsPath;
    if (fromSheets && request === 'googleapis') return { google: { sheets: () => fake.client } };
    if (fromSheets && request === './googleCalendar') return { getAuth: () => null };
    return originalLoad.apply(this, arguments);
  };
  const prevBackend = process.env.DATA_BACKEND;
  // sheets.js lee GOOGLE_SHEET_ID en cada llamada: hace falta un valor. Con la
  // hoja falsa da igual cuál, porque nunca se habla con Google.
  if (!process.env.GOOGLE_SHEET_ID) process.env.GOOGLE_SHEET_ID = 'hoja-falsa-en-memoria';
  try {
    process.env.DATA_BACKEND = 'sheets';
    delete require.cache[sheetsPath];
    return require(sheetsPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[sheetsPath]; // que el siguiente require() lea el backend real configurado
    if (prevBackend === undefined) delete process.env.DATA_BACKEND; else process.env.DATA_BACKEND = prevBackend;
  }
}

module.exports = { createFakeSpreadsheet, loadSheetsWithFake };
