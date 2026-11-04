// ============================================================
// Mismo "registro" que sheets.js, pero guardado en Supabase (Postgres) en
// vez de en la Google Sheet. Se activa con DATA_BACKEND=supabase (ver el
// final de sheets.js).
//
// Contrato: exporta EXACTAMENTE las mismas funciones que sheets.js, con
// los mismos parámetros y los mismos valores de retorno — objetos con
// todos los campos como texto ('' si está vacío) y _sheetRow, igual que
// devuelve la Sheet. Así panel.js, webhook.js y las demás rutas no notan
// el cambio. También se replica la caché de 25 s y qué funciones releen la
// fila antes de escribir y cuáles se fían de la caché.
//
// _sheetRow = row_id de la tabla (identity): sirve para lo mismo, señalar
// la fila a actualizar.
//
// Las tablas y tipos están en db-schema.js; docs/SCHEMA.sql se genera de
// ahí. Habla con la API REST de Supabase (PostgREST) con fetch, sin
// dependencias nuevas.
//
// Variables: SUPABASE_URL y SUPABASE_SECRET_KEY (la clave SECRETA del
// servidor; nunca la clave pública, ni en el navegador).
// ============================================================

const { TABLES, snake } = require('./db-schema');

const PAGE_SIZE = 1000; // máximo por petición que devuelve Supabase por defecto

// ---------- Caché (idéntica a sheets.js) ----------
const READ_CACHE_TTL_MS = 25000;
const readCache = new Map();

async function cachedRead(key, fetchFn) {
  const hit = readCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.data;
  const data = await fetchFn();
  readCache.set(key, { data, expiresAt: Date.now() + READ_CACHE_TTL_MS });
  return data;
}

function invalidateCache(key) {
  readCache.delete(key);
}

// ---------- Conexión ----------
function config() {
  const url = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = (process.env.SUPABASE_SECRET_KEY || '').trim();
  if (!url) throw new Error('Falta la variable de entorno SUPABASE_URL');
  if (!key) throw new Error('Falta la variable de entorno SUPABASE_SECRET_KEY');
  return { url, key };
}

async function rest(method, pathAndQuery, { body, prefer } = {}) {
  const { url, key } = config();
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  // Las claves antiguas (JWT, empiezan por "eyJ") van también como Bearer;
  // las nuevas (sb_secret_...) solo en "apikey".
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${url}/rest/v1/${pathAndQuery}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try { const j = JSON.parse(text); detail = [j.message, j.details, j.hint].filter(Boolean).join(' — '); } catch (_) { /* texto tal cual */ }
    throw new Error(`Supabase ${method} ${pathAndQuery.split('?')[0]}: ${res.status} ${detail}`);
  }
  return text ? JSON.parse(text) : null;
}

// ---------- Conversión de valores ----------
// Igual que objectToRow en sheets.js: undefined/null → '', todo lo demás → String().
function asSheetText(v) {
  return v !== undefined && v !== null ? String(v) : '';
}

const NUM_RE = /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$|^(NaN|-?Infinity)$/;
const INT_RE = /^\s*[-+]?\d+\s*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function incompatible(table, col, value, expected) {
  return new Error(`Valor no compatible para ${table}.${col}: ${JSON.stringify(value)} (se esperaba ${expected}). En la Google Sheet se habría guardado como texto; en Supabase la columna tiene tipo.`);
}

// Texto del código → valor para Postgres. '' → null. Si el texto no cabe en
// el tipo de la columna, se lanza un error claro en vez de guardar otra cosa.
function toDb(table, col, type, raw) {
  const v = asSheetText(raw);
  if (v === '') return null;
  if (type === 'text') return v;
  if (type === 'int') {
    if (!INT_RE.test(v)) throw incompatible(table, col, v, 'número entero');
    return v.trim();
  }
  if (type === 'num') {
    if (!NUM_RE.test(v)) throw incompatible(table, col, v, 'número, con punto decimal');
    return v.trim();
  }
  if (type === 'date') {
    if (!DATE_RE.test(v) || Number.isNaN(Date.parse(v))) throw incompatible(table, col, v, 'fecha AAAA-MM-DD');
    return v;
  }
  if (type === 'ts') {
    if (!ISO_RE.test(v) || Number.isNaN(Date.parse(v))) throw incompatible(table, col, v, 'fecha y hora ISO, como new Date().toISOString()');
    return v;
  }
  if (type === 'boolTF') {
    if (v === 'true') return true;
    if (v === 'false') return false;
    throw incompatible(table, col, v, "'true' o 'false'");
  }
  if (type.startsWith('bool:')) {
    const token = type.slice(5);
    if (v === token) return true;
    throw incompatible(table, col, v, `'${token}' o vacío`);
  }
  throw new Error(`Tipo desconocido ${type} en ${table}.${col}`);
}

// Valor de Postgres → el mismo texto que devolvería la Sheet.
function fromDb(type, v) {
  if (v === null || v === undefined) return '';
  if (type === 'ts') return new Date(v).toISOString();
  if (type === 'boolTF') return v ? 'true' : 'false';
  if (type.startsWith('bool:')) return v ? type.slice(5) : '';
  return String(v);
}

// Los numeric se piden como texto (::text) para no perder "10.50" → 10.5.
function selectList(def) {
  return ['row_id'].concat(def.columns.map(([name, type]) => `${name}:${snake(name)}${type === 'num' ? '::text' : ''}`)).join(',');
}

function rowFromDb(def, row) {
  const obj = {};
  def.columns.forEach(([name, type]) => { obj[name] = fromDb(type, row[name]); });
  obj._sheetRow = Number(row.row_id);
  return obj;
}

// Fila entera, como objectToRow: todas las columnas, las que faltan → null.
function rowToDb(def, obj) {
  const out = {};
  def.columns.forEach(([name, type]) => { out[snake(name)] = toDb(def.table, name, type, obj[name]); });
  return out;
}

async function selectAll(def) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await rest('GET', `${def.table}?select=${selectList(def)}&order=row_id.asc&limit=${PAGE_SIZE}&offset=${offset}`);
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows.map((r) => rowFromDb(def, r));
}

async function selectRow(def, sheetRow) {
  const rows = await rest('GET', `${def.table}?select=${selectList(def)}&row_id=eq.${Number(sheetRow)}`);
  return rows.length ? rowFromDb(def, rows[0]) : null;
}

async function insertRow(def, obj) {
  await rest('POST', def.table, { body: [rowToDb(def, obj)], prefer: 'return=minimal' });
}

async function updateRow(def, sheetRow, obj) {
  await rest('PATCH', `${def.table}?row_id=eq.${Number(sheetRow)}`, { body: rowToDb(def, obj), prefer: 'return=minimal' });
}

// Sin _sheetRow, como rowToObject/sessionBonoRowToObject... al releer.
function withoutRow(obj) {
  if (!obj) return obj;
  const { _sheetRow, ...rest_ } = obj;
  return rest_;
}

const T = TABLES;
const COLUMNS = T.bookings.columns.map(([name]) => name);

// ============================================================
// Reservas (primera pestaña)
// ============================================================
async function appendBooking(booking) {
  await insertRow(T.bookings, booking);
  invalidateCache('bookings');
}

async function getAllBookings() {
  return cachedRead('bookings', () => selectAll(T.bookings));
}

async function findBookingById(bookingId) {
  const all = await getAllBookings();
  return all.find((b) => b.bookingId === bookingId) || null;
}

// Relee la fila justo antes de escribir (igual que sheets.js).
async function updateBookingRow(sheetRow, currentBooking, updates) {
  const fresh = withoutRow(await selectRow(T.bookings, sheetRow));
  const base = fresh || currentBooking;
  const merged = { ...base, ...updates };
  await updateRow(T.bookings, sheetRow, merged);
  invalidateCache('bookings');
}

// ============================================================
// Bonos regalo ("Bonos")
// ============================================================
async function appendGift(gift) {
  await insertRow(T.gifts, gift);
  invalidateCache('gifts');
}

async function getAllGifts() {
  return cachedRead('gifts', () => selectAll(T.gifts));
}

// Como en sheets.js: combina con la lectura cacheada, no relee.
async function updateGiftRow(sheetRow, updates) {
  const current = await getAllGifts();
  const existing = current.find((g) => g._sheetRow === sheetRow) || {};
  const merged = { ...existing, ...updates };
  await updateRow(T.gifts, sheetRow, merged);
  invalidateCache('gifts');
}

// ============================================================
// Cumpleaños ("Cumpleanos")
// ============================================================
async function getAllBirthdayRecords() {
  return cachedRead('birthdayRecords', () => selectAll(T.birthdays));
}

async function upsertBirthdayRecord(record, existingRow) {
  if (existingRow) {
    await updateRow(T.birthdays, existingRow._sheetRow, { ...existingRow, ...record });
  } else {
    await insertRow(T.birthdays, record);
  }
  invalidateCache('birthdayRecords');
}

// ============================================================
// Bajas de email comercial ("Bajas")
// ============================================================
async function getAllUnsubscribedEmails() {
  return cachedRead('unsubscribedEmails', async () => {
    const rows = await selectAll(T.unsubscribes);
    return new Set(rows.map((r) => r.emailNormalized).filter(Boolean));
  });
}

async function appendUnsubscribe(emailNormalized) {
  await insertRow(T.unsubscribes, { emailNormalized, unsubscribedAt: new Date().toISOString() });
  invalidateCache('unsubscribedEmails');
}

// ============================================================
// Bonos de sesiones ("BonosSesiones")
// ============================================================
async function appendSessionBono(bono) {
  await insertRow(T.sessionBonos, bono);
  invalidateCache('sessionBonos');
}

async function getAllSessionBonos() {
  return cachedRead('sessionBonos', () => selectAll(T.sessionBonos));
}

async function findSessionBonoById(bonoId) {
  const all = await getAllSessionBonos();
  return all.find((b) => b.bonoId === bonoId) || null;
}

async function updateSessionBonoRow(sheetRow, currentBono, updates) {
  const fresh = withoutRow(await selectRow(T.sessionBonos, sheetRow));
  const base = fresh || currentBono;
  const merged = { ...base, ...updates };
  await updateRow(T.sessionBonos, sheetRow, merged);
  invalidateCache('sessionBonos');
}

// ============================================================
// Faltas ("Faltas")
// ============================================================
async function getAllStrikeRecords() {
  return cachedRead('strikes', () => selectAll(T.strikes));
}

async function upsertStrikeRecord(record, existingRow) {
  if (existingRow) {
    await updateRow(T.strikes, existingRow._sheetRow, { ...existingRow, ...record });
  } else {
    await insertRow(T.strikes, record);
  }
  invalidateCache('strikes');
}

// ============================================================
// Saldo de fidelización ("Saldo")
// ============================================================
async function appendLoyaltyMovement(movement) {
  await insertRow(T.loyalty, movement);
  invalidateCache('loyaltyMovements');
}

async function getLoyaltyMovementsForPhone(phoneNormalized) {
  const all = await getAllLoyaltyMovements();
  return all.filter((m) => m.phoneNormalized === phoneNormalized);
}

async function getAllLoyaltyMovements() {
  return cachedRead('loyaltyMovements', () => selectAll(T.loyalty));
}

async function updateLoyaltyMovementRow(sheetRow, currentMovement, updates) {
  const merged = { ...currentMovement, ...updates };
  await updateRow(T.loyalty, sheetRow, merged);
  invalidateCache('loyaltyMovements');
}

// ============================================================
// Ventas de producto ("VentasProducto")
// ============================================================
async function appendProductSale(sale) {
  await insertRow(T.productSales, { status: 'active', ...sale });
  invalidateCache('productSales');
}

async function getAllProductSales() {
  return cachedRead('productSales', async () => {
    const rows = await selectAll(T.productSales);
    return rows.filter((s) => s.status !== 'deleted');
  });
}

async function updateProductSaleRow(sheetRow, currentSale, updates) {
  const fresh = await selectRow(T.productSales, sheetRow); // sheets.js también le pone _sheetRow aquí
  const base = fresh || currentSale;
  const merged = { ...base, ...updates };
  await updateRow(T.productSales, sheetRow, merged);
  invalidateCache('productSales');
}

// ============================================================
// Presupuestos ("Presupuestos")
// ============================================================
async function appendCustomQuote(quote) {
  await insertRow(T.quotes, quote);
  invalidateCache('customQuotes');
}

async function getAllCustomQuotes() {
  return cachedRead('customQuotes', () => selectAll(T.quotes));
}

async function updateQuoteRow(sheetRow, updates) {
  const current = await getAllCustomQuotes();
  const existing = current.find((q) => q._sheetRow === sheetRow) || {};
  const merged = { ...existing, ...updates };
  await updateRow(T.quotes, sheetRow, merged);
  invalidateCache('customQuotes');
}

// ============================================================
// Códigos de descuento ("Descuentos")
// ============================================================
async function appendDiscount(discount) {
  await insertRow(T.discounts, discount);
  invalidateCache('discounts');
}

async function getAllDiscounts() {
  return cachedRead('discounts', () => selectAll(T.discounts));
}

async function updateDiscountRow(sheetRow, updates) {
  const current = await getAllDiscounts();
  const existing = current.find((d) => d._sheetRow === sheetRow) || {};
  const merged = { ...existing, ...updates };
  await updateRow(T.discounts, sheetRow, merged);
  invalidateCache('discounts');
}

// ============================================================
// Seguimientos ("Seguimientos")
// ============================================================
async function appendFollowup(followup) {
  await insertRow(T.followups, followup);
  invalidateCache('followups');
}

async function getAllFollowups() {
  return cachedRead('followups', () => selectAll(T.followups));
}

async function updateFollowupRow(sheetRow, updates) {
  const current = await getAllFollowups();
  const existing = current.find((f) => f._sheetRow === sheetRow) || {};
  const merged = { ...existing, ...updates };
  await updateRow(T.followups, sheetRow, merged);
  invalidateCache('followups');
}

// ============================================================
// Solo para tools/ (compare, benchmark): carga masiva y vaciado de tablas.
// El vaciado exige LAB_ALLOW_WIPE=si-borrar-todo para que nunca pueda
// pasar por accidente contra una base con datos de verdad.
// ============================================================
const _lab = {
  async bulkInsert(key, objects) {
    const def = T[key];
    for (let i = 0; i < objects.length; i += 500) {
      await rest('POST', def.table, { body: objects.slice(i, i + 500).map((o) => rowToDb(def, o)), prefer: 'return=minimal' });
    }
    readCache.clear();
  },
  async wipeAll() {
    if (process.env.LAB_ALLOW_WIPE !== 'si-borrar-todo') {
      throw new Error('Vaciado bloqueado: pon LAB_ALLOW_WIPE=si-borrar-todo SOLO en el proyecto Supabase de prueba.');
    }
    for (const def of Object.values(T)) await rest('DELETE', `${def.table}?row_id=gt.0`, { prefer: 'return=minimal' });
    readCache.clear();
  },
  // Conteo exacto (cabecera Content-Range), sin el límite de 1000 filas por petición.
  async count(key) {
    const { url, key: apiKey } = config();
    const headers = { apikey: apiKey, Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' };
    if (apiKey.startsWith('eyJ')) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetch(`${url}/rest/v1/${T[key].table}?select=row_id`, { headers });
    if (!res.ok && res.status !== 416) throw new Error(`Supabase count ${T[key].table}: ${res.status} ${await res.text()}`);
    const total = (res.headers.get('content-range') || '').split('/')[1];
    return Number(total || 0);
  },
  // Todas las filas de una tabla, como texto y en orden (también las que
  // getAll* oculta, p. ej. ventas "deleted"). Para tools/export-to-xlsx.js.
  async rows(key) {
    return selectAll(T[key]);
  },
  toDb,
  fromDb,
};

module.exports = {
  appendBooking, getAllBookings, findBookingById, updateBookingRow, COLUMNS, appendGift,
  getAllGifts, updateGiftRow,
  getAllBirthdayRecords, upsertBirthdayRecord,
  appendSessionBono, getAllSessionBonos, findSessionBonoById, updateSessionBonoRow,
  getAllStrikeRecords, upsertStrikeRecord,
  appendLoyaltyMovement, getLoyaltyMovementsForPhone, getAllLoyaltyMovements, updateLoyaltyMovementRow,
  appendProductSale, getAllProductSales, updateProductSaleRow,
  appendFollowup, getAllFollowups, updateFollowupRow,
  appendCustomQuote, getAllCustomQuotes, updateQuoteRow,
  appendDiscount, getAllDiscounts, updateDiscountRow,
  getAllUnsubscribedEmails, appendUnsubscribe,
  _resetReadCache: () => readCache.clear(),
  _lab,
};
