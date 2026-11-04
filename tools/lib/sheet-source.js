// ============================================================
// Origen de datos de la importación: el Excel descargado de la Google
// Sheet (Archivo → Descargar → .xlsx), leído en el Mac.
//
// Se carga en una hoja FALSA en memoria (tools/lib/fake-sheets.js), así
// el sheets.js de verdad puede leerla exactamente igual que lee la Google
// Sheet, sin tocar Google.
// ============================================================
const fs = require('fs');
const path = require('path');
const { loadXlsx } = require('../audit-sheet');
const { createFakeSpreadsheet } = require('./fake-sheets');

const REPO = path.resolve(__dirname, '..', '..');

function checkXlsxPath(file) {
  if (!file || !fs.existsSync(file)) throw new Error('No encuentro el archivo .xlsx indicado.');
  if (path.resolve(file).startsWith(REPO)) {
    throw new Error('El Excel con datos reales está dentro del repositorio: muévelo fuera (p. ej. a Descargas).');
  }
}

// Devuelve { fake, titles, typedCells } con la hoja falsa ya rellena.
async function loadSheetFromXlsx(file) {
  checkXlsxPath(file);
  const { client, typed } = await loadXlsx(file);
  const meta = await client.spreadsheets.get();
  const titles = meta.data.sheets.map((s) => s.properties.title);
  const fake = createFakeSpreadsheet(titles[0]);
  for (const title of titles) {
    const res = await client.spreadsheets.values.get({ range: `'${title}'!A:ZZ` });
    fake.setTab(title, res.data.values || []);
  }
  const typedCells = [...typed.values()].reduce((n, byCol) => n + [...byCol.values()].reduce((m, byKind) => m + [...byKind.values()].reduce((k, e) => k + e.count, 0), 0), 0);
  return { fake, titles, typedCells };
}

// Filas de una pestaña → objetos por posición (igual que rowToObject de
// sheets.js), TODAS, también las que el código oculta al leer.
function tabObjects(fake, title, def) {
  const rows = fake.tabs.get(title) || [];
  const data = rows.slice(1);
  // La API de Sheets no devuelve las filas vacías del final: tampoco se cuentan.
  while (data.length && data[data.length - 1].every((v) => String(v) === '')) data.pop();
  return data.map((row) => {
    const obj = {};
    def.columns.forEach(([c], i) => { obj[c] = row[i] !== undefined ? String(row[i]) : ''; });
    return obj;
  });
}

module.exports = { loadSheetFromXlsx, checkXlsxPath, tabObjects };
