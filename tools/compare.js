// ============================================================
// Comprueba que Supabase (db-supabase.js) se comporta EXACTAMENTE igual
// que la Google Sheet (sheets.js) en las 33 funciones.
//
// - Lado "Sheets": el sheets.js de verdad, pero contra una hoja FALSA en
//   memoria (tools/lib/fake-sheets.js). No hace falta cuenta de Google ni
//   se toca ninguna hoja.
// - Lado "Supabase": el proyecto de PRUEBA de booking-api/.env.local. Se
//   VACÍA y se rellena con los mismos datos inventados (tools/fake-data.js).
//
// Pasos: 1) mismas columnas y mismo orden en las 11 pestañas;
//        2) mismas funciones exportadas, e interruptor DATA_BACKEND;
//        3) todas las lecturas devuelven lo mismo;
//        4) las mismas escrituras dejan los mismos datos.
// Lista cada diferencia. Sale con código 1 si hay alguna.
//
// Uso:  node tools/compare.js
//       node tools/compare.js --sin-supabase   (autoprueba: hoja falsa contra hoja falsa)
// ============================================================
const path = require('path');
const { loadEnvLocal, ENV_LOCAL } = require('./lib/env');
const { createFakeSpreadsheet, loadSheetsWithFake } = require('./lib/fake-sheets');
const { generate } = require('./fake-data');

const API_LIB = path.join(__dirname, '..', 'booking-api', 'src', 'lib');
const { TABLES } = require(path.join(API_LIB, 'db-schema.js'));

const SELF_TEST = process.argv.includes('--sin-supabase');
const FIRST_TAB = 'Hoja 1';
const tabTitle = (key) => (key === 'bookings' ? FIRST_TAB : TABLES[key].tab);

// ---------- Informe ----------
const results = [];
function record(name, diffs) {
  results.push({ name, diffs });
  console.log(`${diffs.length ? '✗' : '✓'} ${name}${diffs.length ? ` — ${diffs.length} diferencia(s)` : ''}`);
  diffs.slice(0, 8).forEach((d) => console.log(`     ${d}`));
  if (diffs.length > 8) console.log(`     ... y ${diffs.length - 8} más`);
}

// Quita _sheetRow (en Supabase es row_id, en la Sheet la posición: no tienen
// por qué coincidir) y convierte Set → lista ordenada.
function normalize(v) {
  if (v instanceof Set) return [...v].sort();
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === 'object') {
    const out = {};
    Object.keys(v).sort().forEach((k) => { if (k !== '_sheetRow') out[k] = normalize(v[k]); });
    return out;
  }
  return v;
}

function diff(a, b, at = '') {
  const out = [];
  const A = normalize(a);
  const B = normalize(b);
  (function walk(x, y, p) {
    if (out.length > 50) return;
    if (Array.isArray(x) && Array.isArray(y)) {
      if (x.length !== y.length) out.push(`${p || '(lista)'}: ${x.length} elementos en Sheets, ${y.length} en Supabase`);
      for (let i = 0; i < Math.min(x.length, y.length); i++) walk(x[i], y[i], `${p}[${i}]`);
      return;
    }
    if (x && y && typeof x === 'object' && typeof y === 'object') {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], p ? `${p}.${k}` : k);
      return;
    }
    if (x !== y) out.push(`${p || '(valor)'}: Sheets=${JSON.stringify(x)}  Supabase=${JSON.stringify(y)}`);
  })(A, B, at);
  return out;
}

// Las escrituras que usan new Date() (p.ej. appendUnsubscribe) deben ver la
// misma hora en los dos lados.
async function withFixedClock(fn) {
  const RealDate = Date;
  const FIXED = new RealDate('2026-10-29T12:34:56.789Z').getTime();
  class FixedDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [FIXED])); }
  }
  global.Date = FixedDate;
  try { return await fn(); } finally { global.Date = RealDate; }
}

const toRow = (key, obj) => TABLES[key].columns.map(([c]) => (obj[c] !== undefined && obj[c] !== null ? String(obj[c]) : ''));

async function main() {
  loadEnvLocal();
  const data = generate({ seed: 42 });

  // ---------- Los dos backends ----------
  const fakeA = createFakeSpreadsheet(FIRST_TAB);
  const S = loadSheetsWithFake(fakeA);
  let D;
  let fakeB;
  if (SELF_TEST) {
    fakeB = createFakeSpreadsheet(FIRST_TAB);
    D = loadSheetsWithFake(fakeB);
    console.log('Modo autoprueba: hoja falsa contra hoja falsa (sin Supabase).\n');
  } else {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
      console.error(`Faltan SUPABASE_URL / SUPABASE_SECRET_KEY en ${path.relative(process.cwd(), ENV_LOCAL)}.`);
      process.exit(2);
    }
    if (process.env.LAB_ALLOW_WIPE !== 'si-borrar-todo') {
      console.error('compare.js VACÍA las tablas de Supabase. Añade LAB_ALLOW_WIPE=si-borrar-todo a booking-api/.env.local, y solo en el proyecto de PRUEBA.');
      process.exit(2);
    }
    D = require(path.join(API_LIB, 'db-supabase.js'));
    console.log(`Supabase: ${new URL(process.env.SUPABASE_URL).host}\n`);
  }

  // ---------- 1. Columnas ----------
  {
    const fresh = createFakeSpreadsheet(FIRST_TAB);
    const S0 = loadSheetsWithFake(fresh);
    await Promise.all([S0.getAllGifts(), S0.getAllBirthdayRecords(), S0.getAllUnsubscribedEmails(), S0.getAllSessionBonos(),
      S0.getAllStrikeRecords(), S0.getAllLoyaltyMovements(), S0.getAllProductSales(), S0.getAllCustomQuotes(),
      S0.getAllDiscounts(), S0.getAllFollowups()]);
    const diffs = [];
    for (const [key, def] of Object.entries(TABLES)) {
      const sheetHeader = key === 'bookings' ? S0.COLUMNS : (fresh.tabs.get(def.tab) || [])[0] || [];
      const schemaCols = def.columns.map(([c]) => c);
      if (JSON.stringify(sheetHeader) !== JSON.stringify(schemaCols)) {
        diffs.push(`${def.tab}: sheets.js=[${sheetHeader.join(',')}] db-schema=[${schemaCols.join(',')}]`);
      }
    }
    record('1. Mismas columnas, en el mismo orden, en las 11 pestañas', diffs);
  }

  // ---------- 2. Funciones exportadas e interruptor ----------
  {
    const fnNames = (m) => Object.keys(m).filter((k) => !k.startsWith('_')).sort();
    const diffs = diff(fnNames(S), fnNames(D));
    const count = fnNames(S).filter((k) => typeof S[k] === 'function').length;
    if (count !== 33) diffs.push(`sheets.js exporta ${count} funciones, se esperaban 33`);
    if (!SELF_TEST) {
      const sheetsPath = path.join(API_LIB, 'sheets.js');
      const prev = process.env.DATA_BACKEND;
      process.env.DATA_BACKEND = 'supabase';
      delete require.cache[sheetsPath];
      if (require(sheetsPath) !== D) diffs.push('Con DATA_BACKEND=supabase, sheets.js NO devuelve db-supabase.js');
      process.env.DATA_BACKEND = 'algo-raro';
      delete require.cache[sheetsPath];
      try { require(sheetsPath); diffs.push('DATA_BACKEND=algo-raro debería impedir el arranque'); } catch (_) { /* correcto */ }
      if (prev === undefined) delete process.env.DATA_BACKEND; else process.env.DATA_BACKEND = prev;
      delete require.cache[sheetsPath];
    }
    record(`2. Mismas funciones exportadas (${count}) e interruptor DATA_BACKEND`, diffs);
  }

  // ---------- Carga de los mismos datos ----------
  for (const [key, rows] of Object.entries(data)) {
    fakeA.setTab(tabTitle(key), [TABLES[key].columns.map(([c]) => c), ...rows.map((r) => toRow(key, r))]);
  }
  if (SELF_TEST) {
    for (const [key, rows] of Object.entries(data)) {
      fakeB.setTab(tabTitle(key), [TABLES[key].columns.map(([c]) => c), ...rows.map((r) => toRow(key, r))]);
    }
  } else {
    process.stdout.write('Cargando datos inventados en Supabase... ');
    await D._lab.wipeAll();
    for (const [key, rows] of Object.entries(data)) await D._lab.bulkInsert(key, rows);
    console.log('hecho.');
  }
  const reset = () => { S._resetReadCache(); D._resetReadCache(); };
  reset();

  // ---------- 3. Lecturas ----------
  const someBooking = data.bookings[123];
  const someBono = data.sessionBonos[17];
  const phones = [data.loyalty[0].phoneNormalized, data.loyalty[50].phoneNormalized, '000000000'];
  const reads = [
    ['getAllBookings', (B) => B.getAllBookings()],
    ['findBookingById (existe)', (B) => B.findBookingById(someBooking.bookingId)],
    ['findBookingById (no existe)', (B) => B.findBookingById('no-existe')],
    ['getAllGifts', (B) => B.getAllGifts()],
    ['getAllBirthdayRecords', (B) => B.getAllBirthdayRecords()],
    ['getAllUnsubscribedEmails', (B) => B.getAllUnsubscribedEmails()],
    ['getAllSessionBonos', (B) => B.getAllSessionBonos()],
    ['findSessionBonoById (existe)', (B) => B.findSessionBonoById(someBono.bonoId)],
    ['findSessionBonoById (no existe)', (B) => B.findSessionBonoById('no-existe')],
    ['getAllStrikeRecords', (B) => B.getAllStrikeRecords()],
    ['getAllLoyaltyMovements', (B) => B.getAllLoyaltyMovements()],
    ['getLoyaltyMovementsForPhone', (B) => Promise.all(phones.map((p) => B.getLoyaltyMovementsForPhone(p)))],
    ['getAllProductSales (sin las borradas)', (B) => B.getAllProductSales()],
    ['getAllCustomQuotes', (B) => B.getAllCustomQuotes()],
    ['getAllDiscounts', (B) => B.getAllDiscounts()],
    ['getAllFollowups', (B) => B.getAllFollowups()],
    ['COLUMNS', (B) => B.COLUMNS],
  ];
  const readDiffs = [];
  for (const [name, fn] of reads) {
    reset();
    const [a, b] = [await fn(S), await fn(D)];
    diff(a, b).forEach((d) => readDiffs.push(`${name} → ${d}`));
  }
  // El orden de las filas también debe ser el mismo (la Sheet devuelve por posición).
  reset();
  const order = (rows) => rows.map((r) => r.bookingId).join(',');
  if (order(await S.getAllBookings()) !== order(await D.getAllBookings())) readDiffs.push('getAllBookings: las filas vuelven en distinto orden');
  record(`3. Lecturas (${reads.length} comprobaciones, ${Object.values(data).reduce((n, r) => n + r.length, 0)} filas)`, readDiffs);

  // ---------- 4. Escrituras ----------
  // Cada escenario se aplica a los dos lados; luego se compara la pestaña entera.
  const rowOf = async (B, getter, pred) => (await B[getter]()).find(pred);
  const scenarios = [
    ['appendBooking', 'getAllBookings', (B) => B.appendBooking({
      ...data.bookings[0], bookingId: 'cmp-nueva-reserva', status: 'pending', price: '10.50', amountPaid: '0', notes: 'Con "comillas", acentos ñ y coma, sí',
    })],
    ['updateBookingRow (pago)', 'getAllBookings', async (B) => {
      const b = await rowOf(B, 'getAllBookings', (x) => x.bookingId === someBooking.bookingId);
      await B.updateBookingRow(b._sheetRow, b, { amountPaid: '75', paymentIntentId: 'pi_test_compare', status: 'confirmed', reminderSent: 'sent', finalAmount: '80.50', confirmationEmailSent: '1' });
    }],
    ['updateBookingRow (vaciar campos)', 'getAllBookings', async (B) => {
      const b = await rowOf(B, 'getAllBookings', (x) => x.bookingId === someBooking.bookingId);
      await B.updateBookingRow(b._sheetRow, b, { reminderSent: '', finalAmount: '', birthdate: '', noShowForgiven: '' });
    }],
    ['appendGift', 'getAllGifts', (B) => B.appendGift({ ...data.gifts[0], bonoId: 'cmp-regalo', code: 'CMP-0001' })],
    ['updateGiftRow', 'getAllGifts', async (B) => {
      const g = await rowOf(B, 'getAllGifts', (x) => x.bonoId === 'cmp-regalo');
      await B.updateGiftRow(g._sheetRow, { status: 'redeemed', redeemedAt: '2026-10-29T10:00:00.000Z' });
    }],
    ['upsertBirthdayRecord (existente)', 'getAllBirthdayRecords', async (B) => {
      const r = (await B.getAllBirthdayRecords())[3];
      await B.upsertBirthdayRecord({ ...r, lastSentYear: '2026' }, r);
    }],
    ['upsertBirthdayRecord (nueva)', 'getAllBirthdayRecords', (B) => B.upsertBirthdayRecord({
      emailNormalized: 'nueva.prueba@example.com', phoneNormalized: '700900999', name: 'Nueva Prueba', birthdate: '1990-01-31', lastSentYear: '2026',
    }, null)],
    ['appendUnsubscribe', 'getAllUnsubscribedEmails', (B) => B.appendUnsubscribe('baja.nueva@example.com')],
    ['appendSessionBono', 'getAllSessionBonos', (B) => B.appendSessionBono({ ...data.sessionBonos[0], bonoId: 'cmp-bono' })],
    ['updateSessionBonoRow', 'getAllSessionBonos', async (B) => {
      const b = await rowOf(B, 'getAllSessionBonos', (x) => x.bonoId === 'cmp-bono');
      await B.updateSessionBonoRow(b._sheetRow, b, { sessionsUsed: '2', sessionsRemaining: '1', paidCash: '12.30' });
    }],
    ['upsertStrikeRecord (existente)', 'getAllStrikeRecords', async (B) => {
      const r = (await B.getAllStrikeRecords())[0];
      await B.upsertStrikeRecord({ ...r, strikeCount: String(Number(r.strikeCount) + 1), lastStrikeDate: '2026-10-29' }, r);
    }],
    ['upsertStrikeRecord (nueva)', 'getAllStrikeRecords', (B) => B.upsertStrikeRecord({
      phoneNormalized: '700900998', emailNormalized: 'falta.nueva@example.com', name: 'Falta Prueba', strikeCount: 1, lastStrikeDate: '2026-10-29',
    }, null)],
    ['appendLoyaltyMovement', 'getAllLoyaltyMovements', (B) => B.appendLoyaltyMovement({ ...data.loyalty[1], amount: 3.15, note: 'cmp' })],
    ['updateLoyaltyMovementRow', 'getAllLoyaltyMovements', async (B) => {
      const m = (await B.getAllLoyaltyMovements())[10];
      await B.updateLoyaltyMovementRow(m._sheetRow, m, { name: 'Nombre Corregido Prueba', phoneNormalized: '700900997' });
    }],
    ['appendProductSale (status por defecto)', 'getAllProductSales', (B) => B.appendProductSale({ saleId: 'cmp-venta', createdAt: '2026-10-29T09:00:00.000Z', date: '2026-10-29', product: 'Crema prueba', amount: '19.90', paidHow: 'efectivo' })],
    ['updateProductSaleRow (borrar)', 'getAllProductSales', async (B) => {
      const s = await rowOf(B, 'getAllProductSales', (x) => x.saleId === 'cmp-venta');
      await B.updateProductSaleRow(s._sheetRow, s, { status: 'deleted' });
    }],
    ['appendFollowup', 'getAllFollowups', (B) => B.appendFollowup({ ...data.followups[0], followupId: 'cmp-seguimiento' })],
    ['updateFollowupRow', 'getAllFollowups', async (B) => {
      const f = await rowOf(B, 'getAllFollowups', (x) => x.followupId === 'cmp-seguimiento');
      await B.updateFollowupRow(f._sheetRow, { status: 'done' });
    }],
    ['appendCustomQuote', 'getAllCustomQuotes', (B) => B.appendCustomQuote({ ...data.quotes[0], quoteId: 'cmp-presupuesto', status: 'pending', paidDate: '' })],
    ['updateQuoteRow', 'getAllCustomQuotes', async (B) => {
      const q = await rowOf(B, 'getAllCustomQuotes', (x) => x.quoteId === 'cmp-presupuesto');
      await B.updateQuoteRow(q._sheetRow, { status: 'paid', paidDate: '2026-10-29' });
    }],
    ['appendDiscount', 'getAllDiscounts', (B) => B.appendDiscount({ ...data.discounts[0], discountId: 'cmp-descuento', code: 'CMP10', active: 'true' })],
    ['updateDiscountRow', 'getAllDiscounts', async (B) => {
      const d = await rowOf(B, 'getAllDiscounts', (x) => x.discountId === 'cmp-descuento');
      await B.updateDiscountRow(d._sheetRow, { active: 'false', emailSentAt: '2026-10-29T11:00:00.000Z' });
    }],
  ];
  const writeDiffs = [];
  for (const [name, getter, fn] of scenarios) {
    reset();
    let errA = null;
    let errB = null;
    await withFixedClock(async () => {
      try { await fn(S); } catch (e) { errA = e; }
      try { await fn(D); } catch (e) { errB = e; }
    });
    if (errA || errB) {
      writeDiffs.push(`${name} → error: Sheets=${errA ? errA.message : 'ok'} | Supabase=${errB ? errB.message : 'ok'}`);
      continue;
    }
    reset();
    diff(await S[getter](), await D[getter]()).forEach((d) => writeDiffs.push(`${name} → ${d}`));
  }
  reset();
  diff(await Promise.all(phones.map((p) => S.getLoyaltyMovementsForPhone(p))), await Promise.all(phones.map((p) => D.getLoyaltyMovementsForPhone(p))))
    .forEach((d) => writeDiffs.push(`getLoyaltyMovementsForPhone después de escribir → ${d}`));
  record(`4. Escrituras (${scenarios.length} escenarios sobre las 11 pestañas)`, writeDiffs);

  const total = results.reduce((n, r) => n + r.diffs.length, 0);
  console.log(`\n${total === 0 ? 'SIN DIFERENCIAS' : `${total} DIFERENCIA(S)`} entre Sheets y ${SELF_TEST ? 'la hoja de autoprueba' : 'Supabase'}.`);
  process.exit(total === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Error:', e.message); process.exit(2); });
