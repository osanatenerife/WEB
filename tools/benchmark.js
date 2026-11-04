// ============================================================
// Mide cuánto tardan las operaciones principales con el backend elegido en
// DATA_BACKEND (booking-api/.env.local o el terminal), usando las mismas
// funciones que usa la web. Cada medida empieza con la caché vacía, salvo
// la fila "(con caché)".
//
// Guarda el resultado en tools/.out/benchmark-<backend>.json y, si ya
// existe el del otro backend, imprime la comparación "antes / después".
//
// Uso:
//   DATA_BACKEND=supabase node tools/benchmark.js --cargar     (carga los datos inventados y mide)
//   DATA_BACKEND=supabase node tools/benchmark.js              (mide con lo que ya haya)
//   DATA_BACKEND=sheets   node tools/benchmark.js --hoja-de-prueba [--cargar]
//        → contra una Google Sheet de PRUEBA (GOOGLE_SHEET_ID de .env.local)
//   Opciones: --veces 10
//             --solo-lectura  no crea ni modifica nada (para medir sobre datos reales)
//
// Escribe filas de prueba (nombre "Benchmark Prueba"): úsalo solo contra
// bases de PRUEBA.
// ============================================================
const fs = require('fs');
const path = require('path');
const { loadEnvLocal } = require('./lib/env');
const { generate } = require('./fake-data');

loadEnvLocal();
const API = path.join(__dirname, '..', 'booking-api', 'src');
const BACKEND = String(process.env.DATA_BACKEND || 'sheets').trim().toLowerCase();
const arg = (name) => process.argv.includes(name);
const argValue = (name, dflt) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : dflt; };
const RUNS = Number(argValue('--veces', 10));
const OUT_DIR = path.join(__dirname, '.out');

function stats(ms) {
  const s = [...ms].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { veces: s.length, mediana: q(0.5), p95: q(0.95), min: s[0], max: s[s.length - 1] };
}

async function time(fn) {
  const t0 = process.hrtime.bigint();
  await fn();
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

// Carga los datos inventados en una Google Sheet de PRUEBA (borra su contenido).
async function loadIntoSheet(data) {
  const { google } = require(path.join(__dirname, '..', 'booking-api', 'node_modules', 'googleapis'));
  const { getAuth } = require(path.join(API, 'lib', 'googleCalendar.js'));
  const { TABLES } = require(path.join(API, 'lib', 'db-schema.js'));
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
  const titles = meta.data.sheets.map((s) => s.properties.title);
  for (const [key, rows] of Object.entries(data)) {
    const def = TABLES[key];
    const title = key === 'bookings' ? titles[0] : def.tab;
    if (!titles.includes(title)) {
      await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title } } }] } });
    }
    await sheets.spreadsheets.values.clear({ spreadsheetId, range: `'${title}'` });
    const values = [def.columns.map(([c]) => c), ...rows.map((r) => def.columns.map(([c]) => (r[c] !== undefined ? String(r[c]) : '')))];
    await sheets.spreadsheets.values.update({ spreadsheetId, range: `'${title}'!A1`, valueInputOption: 'RAW', requestBody: { values } });
  }
}

async function main() {
  if (BACKEND === 'sheets' && !arg('--hoja-de-prueba')) {
    console.error('Con DATA_BACKEND=sheets el benchmark escribe en la Google Sheet de GOOGLE_SHEET_ID.\nAñade --hoja-de-prueba para confirmar que es una hoja de PRUEBA (nunca la real).');
    process.exit(2);
  }
  const db = require(path.join(API, 'lib', 'sheets.js')); // respeta el interruptor DATA_BACKEND
  const { normalizePhone } = require(path.join(API, 'lib', 'clientId.js'));
  const { computeLoyaltyBalance } = require(path.join(API, 'config', 'loyalty.js'));
  const data = generate({ seed: 42 });

  if (arg('--cargar')) {
    process.stdout.write(`Cargando datos inventados en ${BACKEND}... `);
    if (BACKEND === 'supabase') {
      await db._lab.wipeAll();
      for (const [key, rows] of Object.entries(data)) await db._lab.bulkInsert(key, rows);
    } else {
      await loadIntoSheet(data);
    }
    console.log('hecho.');
  }

  const counts = (await db.getAllBookings()).length;
  console.log(`Backend: ${BACKEND} · ${counts} reservas · ${RUNS} medidas por operación\n`);

  const readOnly = arg('--solo-lectura');
  // Teléfonos que buscar: de los datos que hay en la base (reales o inventados).
  // Solo se usan aquí dentro; no se imprimen.
  const existing = await db.getAllBookings();
  const movements = await db.getAllLoyaltyMovements();
  const pickEvery = (arr, n) => Array.from({ length: n }, (_, i) => arr[Math.floor((i * arr.length) / n)]).filter(Boolean);
  const phones = pickEvery([...new Set(movements.map((m) => m.phoneNormalized))], RUNS);
  const searchPhones = pickEvery(existing.map((b) => b.phone).filter(Boolean), RUNS);
  const created = [];
  const results = {};

  const search = async (q) => {
    const [allBookings] = await Promise.all([
      db.getAllBookings(), db.getAllSessionBonos(), db.getAllStrikeRecords(), db.getAllLoyaltyMovements(), db.getAllProductSales(),
    ]);
    return allBookings.filter((b) => normalizePhone(b.phone) === normalizePhone(q));
  };

  const ops = [
    ['Buscar clienta (5 tablas, como /panel/search)', async (i) => { db._resetReadCache(); await search(searchPhones[i]); }],
    ['Buscar clienta (con caché)', async (i) => { await search(searchPhones[i]); }],
    ['Crear reserva (appendBooking)', async (i) => {
      const bookingId = `bench-${Date.now()}-${i}`;
      created.push(bookingId);
      await db.appendBooking({ ...data.bookings[i], bookingId, name: 'Benchmark Prueba', status: 'pending', createdAt: new Date().toISOString() });
    }],
    ['Actualizar pago (buscar + updateBookingRow)', async (i) => {
      db._resetReadCache();
      const b = await db.findBookingById(created[i]);
      await db.updateBookingRow(b._sheetRow, b, { status: 'confirmed', amountPaid: b.price, paymentIntentId: `pi_test_bench_${i}` });
    }],
    ['Calcular saldo (movimientos + cálculo)', async (i) => {
      db._resetReadCache();
      computeLoyaltyBalance(await db.getLoyaltyMovementsForPhone(phones[i]));
    }],
  ];

  await search(searchPhones[0]); // calienta conexión (DNS/TLS) para no medirla
  const WRITES = ['Crear reserva (appendBooking)', 'Actualizar pago (buscar + updateBookingRow)'];
  for (const [name, fn] of ops.filter(([n]) => !(readOnly && WRITES.includes(n)))) {
    const ms = [];
    for (let i = 0; i < RUNS; i++) ms.push(await time(() => fn(i)));
    results[name] = stats(ms);
  }

  const fmt = (n) => (n >= 100 ? n.toFixed(0) : n.toFixed(1)).padStart(8);
  console.log(`${'Operación'.padEnd(46)}${'veces'.padStart(6)}${'mediana'.padStart(9)}${'p95'.padStart(8)}${'mín'.padStart(8)}${'máx'.padStart(8)}  (ms)`);
  for (const [name, s] of Object.entries(results)) {
    console.log(`${name.padEnd(46)}${String(s.veces).padStart(6)}${fmt(s.mediana)}${fmt(s.p95)}${fmt(s.min)}${fmt(s.max)}`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `benchmark-${BACKEND}.json`);
  fs.writeFileSync(file, JSON.stringify({ backend: BACKEND, fecha: new Date().toISOString(), reservas: counts, results }, null, 1));
  console.log(`\nGuardado en ${path.relative(process.cwd(), file)}`);

  const other = path.join(OUT_DIR, `benchmark-${BACKEND === 'sheets' ? 'supabase' : 'sheets'}.json`);
  if (fs.existsSync(other)) {
    const before = BACKEND === 'sheets' ? results : JSON.parse(fs.readFileSync(other, 'utf8')).results;
    const after = BACKEND === 'sheets' ? JSON.parse(fs.readFileSync(other, 'utf8')).results : results;
    console.log(`\n${'Antes (Sheets) / después (Supabase), mediana'.padEnd(46)}${'Sheets'.padStart(9)}${'Supabase'.padStart(10)}${'×'.padStart(7)}`);
    for (const name of Object.keys(after)) {
      if (!before[name]) continue;
      const x = before[name].mediana / after[name].mediana;
      console.log(`${name.padEnd(46)}${fmt(before[name].mediana).padStart(9)}${fmt(after[name].mediana).padStart(10)}${x.toFixed(1).padStart(7)}`);
    }
  }
}

main().catch((e) => { console.error('Error:', e.message); process.exit(2); });
