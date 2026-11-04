// ============================================================
// Fase 2 · Paso 3 — Verifica una importación. SOLO LECTURA en los dos lados.
//
// Lado "Sheet": el sheets.js de verdad leyendo el mismo Excel (cargado en
// una hoja falsa en memoria). Lado "Supabase": db-supabase.js contra el
// proyecto de SUPABASE_URL. Compara:
//   1. número de filas de cada pestaña (todas, también las ocultas);
//   2. todas las funciones de lectura (las 12 listas, mismo orden de filas);
//   3. findBookingById / findSessionBonoById para CADA id;
//   4. getLoyaltyMovementsForPhone para CADA teléfono;
//   5. el saldo de la vista saldo_por_cliente frente a computeLoyaltyBalance.
//
// Si hay diferencias, enseña dónde (función, fila, campo) y el PATRÓN del
// valor (dígitos → N, letras → A), nunca el valor: no muestra datos de clientas.
//
// Uso:  node tools/verify-import.js --xlsx ~/Downloads/archivo.xlsx
// ============================================================
const path = require('path');
const { loadEnvLocal } = require('./lib/env');
const { loadSheetFromXlsx, tabObjects } = require('./lib/sheet-source');
const { loadSheetsWithFake } = require('./lib/fake-sheets');
const { pattern } = require('./audit-sheet');

const API = path.join(__dirname, '..', 'booking-api', 'src');
const { TABLES } = require(path.join(API, 'lib', 'db-schema.js'));

const argValue = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };
const mask = (v) => (v === undefined ? '(no existe)' : v === '' ? '(vacío)' : `«${pattern(v)}»`);

const results = [];
function record(name, diffs) {
  results.push({ name, diffs });
  console.log(`${diffs.length ? '✗' : '✓'} ${name}${diffs.length ? ` — ${diffs.length} diferencia(s)` : ''}`);
  diffs.slice(0, 15).forEach((d) => console.log(`     ${d}`));
  if (diffs.length > 15) console.log(`     ... y ${diffs.length - 15} más`);
}

// Compara listas de objetos (sin _sheetRow) fila a fila y campo a campo.
function diffRows(label, a, b, single = false) {
  const out = [];
  const A = a instanceof Set ? [...a].sort() : a;
  const B = b instanceof Set ? [...b].sort() : b;
  if (!Array.isArray(A) || !Array.isArray(B)) {
    if ((A === null) !== (B === null)) out.push(`${label}: Sheet=${A === null ? 'no encontrado' : 'encontrado'} Supabase=${B === null ? 'no encontrado' : 'encontrado'}`);
    else if (A && B) return diffRows(label, [A], [B], true);
    return out;
  }
  if (A.length !== B.length) out.push(`${label}: ${A.length} filas en la Sheet, ${B.length} en Supabase`);
  for (let i = 0; i < Math.min(A.length, B.length) && out.length < 100; i++) {
    const x = A[i];
    const y = B[i];
    if (typeof x !== 'object' || typeof y !== 'object') {
      if (x !== y) out.push(`${label}[${i}]: Sheet=${mask(x)} Supabase=${mask(y)}`);
      continue;
    }
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
      if (k === '_sheetRow') continue;
      if (x[k] !== y[k]) out.push(`${label}${single ? '' : `[fila ${i + 2}]`}.${k}: Sheet=${mask(x[k])} Supabase=${mask(y[k])}`);
    }
  }
  return out;
}

async function main() {
  loadEnvLocal();
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    console.error('Faltan SUPABASE_URL / SUPABASE_SECRET_KEY en booking-api/.env.local.');
    process.exit(2);
  }
  const { fake, titles } = await loadSheetFromXlsx(argValue('--xlsx'));
  const S = loadSheetsWithFake(fake);
  const D = require(path.join(API, 'lib', 'db-supabase.js'));
  const { computeLoyaltyBalance } = require(path.join(API, 'config', 'loyalty.js'));
  console.log(`Sheet: Excel (${titles.length} pestañas) · Supabase: ${new URL(process.env.SUPABASE_URL).host}\n`);

  // 1. Filas por pestaña
  {
    const diffs = [];
    for (const [key, def] of Object.entries(TABLES)) {
      const title = key === 'bookings' ? titles[0] : def.tab;
      const n = titles.includes(title) ? tabObjects(fake, title, def).length : 0;
      const m = await D._lab.count(key);
      if (n !== m) diffs.push(`${title} → ${def.table}: ${n} filas en la Sheet, ${m} en Supabase`);
    }
    record('1. Mismo número de filas en las 11 pestañas', diffs);
  }

  // 2. Funciones de lectura
  const lists = ['getAllBookings', 'getAllGifts', 'getAllBirthdayRecords', 'getAllUnsubscribedEmails', 'getAllSessionBonos',
    'getAllStrikeRecords', 'getAllLoyaltyMovements', 'getAllProductSales', 'getAllCustomQuotes', 'getAllDiscounts', 'getAllFollowups'];
  const sideS = {};
  const sideD = {};
  {
    const diffs = [];
    for (const fn of lists) {
      S._resetReadCache(); D._resetReadCache();
      sideS[fn] = await S[fn]();
      sideD[fn] = await D[fn]();
      diffs.push(...diffRows(fn, sideS[fn], sideD[fn]));
    }
    if (JSON.stringify(S.COLUMNS) !== JSON.stringify(D.COLUMNS)) diffs.push('COLUMNS distinto');
    record(`2. Las ${lists.length} lecturas completas, en el mismo orden`, diffs);
  }

  // 3. Búsquedas por id
  {
    const diffs = [];
    const bookingIds = [...new Set(sideS.getAllBookings.map((b) => b.bookingId))];
    for (const id of bookingIds) diffs.push(...diffRows(`findBookingById(#${bookingIds.indexOf(id) + 1})`, await S.findBookingById(id), await D.findBookingById(id)));
    const bonoIds = [...new Set(sideS.getAllSessionBonos.map((b) => b.bonoId))];
    for (const id of bonoIds) diffs.push(...diffRows(`findSessionBonoById(#${bonoIds.indexOf(id) + 1})`, await S.findSessionBonoById(id), await D.findSessionBonoById(id)));
    diffs.push(...diffRows('findBookingById(inexistente)', await S.findBookingById('no-existe-xyz'), await D.findBookingById('no-existe-xyz')));
    record(`3. Búsqueda por id (${bookingIds.length} reservas, ${bonoIds.length} bonos)`, diffs);
  }

  // 4. Movimientos de saldo por teléfono
  const phones = [...new Set(sideS.getAllLoyaltyMovements.map((m) => m.phoneNormalized))];
  {
    const diffs = [];
    for (const [i, p] of phones.entries()) diffs.push(...diffRows(`getLoyaltyMovementsForPhone(#${i + 1})`, await S.getLoyaltyMovementsForPhone(p), await D.getLoyaltyMovementsForPhone(p)));
    record(`4. Movimientos de saldo de cada clienta (${phones.length} teléfonos)`, diffs);
  }

  // 5. Vista saldo_por_cliente frente al cálculo de la web
  {
    const diffs = [];
    const res = await fetch(`${process.env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/saldo_por_cliente?select=phone_normalized,saldo::text`, {
      headers: { apikey: process.env.SUPABASE_SECRET_KEY },
    });
    const view = new Map((await res.json()).map((r) => [r.phone_normalized || '', Number(r.saldo)]));
    for (const [i, p] of phones.entries()) {
      const js = computeLoyaltyBalance(await S.getLoyaltyMovementsForPhone(p));
      const v = view.get(p || '');
      if (v === undefined || Math.abs(v - js) > 0.001) diffs.push(`clienta #${i + 1}: la web calcula ${pattern(String(js))}, la vista da ${v === undefined ? '(no aparece)' : pattern(String(v))}`);
    }
    record(`5. Saldo de la vista = saldo que calcula la web (${phones.length} clientas)`, diffs);
  }

  const total = results.reduce((n, r) => n + r.diffs.length, 0);
  console.log(`\n${total === 0 ? 'IMPORTACIÓN VERIFICADA: sin diferencias.' : `${total} DIFERENCIA(S): no seguir hasta revisarlas.`}`);
  process.exit(total === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Error:', e.message); process.exit(2); });
