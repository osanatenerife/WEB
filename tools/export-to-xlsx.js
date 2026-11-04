// ============================================================
// Fase 2 · Paso 7 — Vuelta atrás: Supabase → Excel con la MISMA forma que
// la Google Sheet (mismas pestañas, columnas en el mismo orden, todo como
// texto, filas en el mismo orden).
//
// Para volver a la Sheet después del cambio:
//   1. node tools/export-to-xlsx.js            → ~/Downloads/osana-export-AAAA-MM-DD-HHMM.xlsx
//   2. node tools/verify-import.js --xlsx <ese archivo>   → debe dar "sin diferencias"
//   3. La titular abre la Google Sheet ORIGINAL → Archivo → Importar →
//      Subir el Excel → "Reemplazar hoja de cálculo". El ID de la Sheet no
//      cambia, así que la web la vuelve a usar sin tocar nada más.
//   4. En Render: DATA_BACKEND=sheets → redesplegar.
//
// No imprime datos: solo conteos. El Excel contiene datos reales: se
// guarda FUERA del repositorio y se borra al terminar.
//
// Opciones: --salida <ruta.xlsx>  --primera-pestana "Hoja 1"
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadEnvLocal } = require('./lib/env');

const API = path.join(__dirname, '..', 'booking-api');
const { TABLES } = require(path.join(API, 'src', 'lib', 'db-schema.js'));
const argValue = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };

async function main() {
  loadEnvLocal();
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    console.error('Faltan SUPABASE_URL / SUPABASE_SECRET_KEY en booking-api/.env.local.');
    process.exit(2);
  }
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  const out = path.resolve(argValue('--salida') || path.join(os.homedir(), 'Downloads', `osana-export-${stamp}.xlsx`));
  if (out.startsWith(path.resolve(__dirname, '..'))) {
    console.error('El Excel tendrá datos reales: guárdalo FUERA del repositorio (p. ej. en Descargas).');
    process.exit(2);
  }
  const firstTab = argValue('--primera-pestana') || 'Hoja 1';

  const db = require(path.join(API, 'src', 'lib', 'db-supabase.js'));
  const ExcelJS = require(path.join(API, 'node_modules', 'exceljs'));
  const wb = new ExcelJS.Workbook();
  console.log(`Origen: ${new URL(process.env.SUPABASE_URL).host}\n`);

  // La pestaña de reservas tiene que ser la PRIMERA (sheets.js la busca por posición).
  for (const [key, def] of Object.entries(TABLES)) {
    const title = key === 'bookings' ? firstTab : def.tab;
    const ws = wb.addWorksheet(title);
    const cols = def.columns.map(([c]) => c);
    // Formato "texto" (@) en todas las columnas: así Google Sheets no
    // convierte "10.50" en número ni "2026-10-30" en fecha al importar.
    ws.columns = cols.map((c) => ({ key: c, style: { numFmt: '@' } }));
    ws.addRow(cols);
    const rows = await db._lab.rows(key);
    for (const r of rows) ws.addRow(cols.map((c) => r[c]));
    console.log(`  ${def.table.padEnd(18)} → ${String(title).padEnd(16)} ${String(rows.length).padStart(5)} filas`);
  }
  await wb.xlsx.writeFile(out);
  console.log(`\nExcel escrito (contiene datos: bórralo al terminar): ${out.replace(os.homedir(), '~')}`);
  console.log('Siguiente: node tools/verify-import.js --xlsx "<ese archivo>"');
}

main().catch((e) => { console.error('Error:', e.message); process.exit(2); });
