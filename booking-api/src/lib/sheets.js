const { google } = require('googleapis');
const { getAuth } = require('./googleCalendar');

// Convierte un índice de columna 1-indexado a su letra de columna de
// Sheets (1→A, 26→Z, 27→AA...) — String.fromCharCode(64+n) solo vale
// hasta la Z (26), y varias de nuestras pestañas ya la superan.
function colLetter(n) {
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// ============================================================
// Registro de reservas en una Google Sheet — hace de "base de datos"
// ligera para poder buscar/cancelar/reprogramar citas desde la web
// sin montar un servidor de base de datos aparte.
//
// Columnas (en este orden, fila 1 = cabecera):
// A bookingId · B createdAt · C status · D name · E phone · F email ·
// G serviceId · H serviceName · I employeeId · J employeeName ·
// K calendarId · L eventId · M date · N time · O durationMinutes ·
// P price · Q amountPaid · R paymentType · S paymentIntentId ·
// T lang · U reminderSent · V birthdate
// ============================================================

const COLUMNS = [
  'bookingId', 'createdAt', 'status', 'name', 'phone', 'email',
  'serviceId', 'serviceName', 'employeeId', 'employeeName',
  'calendarId', 'eventId', 'date', 'time', 'durationMinutes',
  'price', 'amountPaid', 'paymentType', 'paymentIntentId',
  'lang', 'reminderSent', 'birthdate', 'bonoId', 'sessionNumber', 'notes',
  // finalAmount = importe total real cobrado en la cita. El resto (finalAmount
  // - amountPaid, lo pagado online) puede venir dividido en hasta 2 formas de
  // pago (p.ej. mitad tarjeta, mitad efectivo): remainderPaidHow/remainderAmount2
  // cubre la 2ª parte; la 1ª parte es el resto menos remainderAmount2.
  'finalAmount', 'remainderPaidHow', 'remainderAmount2', 'remainderPaidHow2',
];
const LAST_COL = colLetter(COLUMNS.length);

function getSheetsClient() {
  return google.sheets({ version: 'v4', auth: getAuth() });
}

function sheetId() {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error('Falta la variable de entorno GOOGLE_SHEET_ID');
  return id;
}

// Detectamos el nombre real de la primera pestaña (en vez de asumir
// "Sheet1", que no coincide si la hoja está en español y se llama
// "Hoja 1" o cualquier otro nombre). Se cachea en memoria del proceso.
let cachedTabName = null;
async function getTabName() {
  if (cachedTabName) return cachedTabName;
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.get({
    spreadsheetId: sheetId(),
    fields: 'sheets.properties.title',
  });
  const title = res.data.sheets && res.data.sheets[0] && res.data.sheets[0].properties.title;
  if (!title) throw new Error('No se ha podido detectar el nombre de la pestaña de la Google Sheet');
  cachedTabName = title;
  return cachedTabName;
}

async function rangeAll() {
  const tab = await getTabName();
  return `'${tab}'!A:${LAST_COL}`;
}

// Reescribe siempre la fila de cabecera con las columnas actuales del
// código (barato e idempotente) — así, si se añade una columna nueva
// (como "birthdate"), aparece sola en una hoja que ya existía en
// producción, sin tener que tocar nada a mano en Google Sheets.
async function ensureHeader() {
  const sheets = getSheetsClient();
  const tab = await getTabName();
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId(),
    range: `'${tab}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [COLUMNS] },
  });
}

function rowToObject(row) {
  const obj = {};
  COLUMNS.forEach((col, i) => { obj[col] = row[i] !== undefined ? row[i] : ''; });
  return obj;
}

function objectToRow(obj) {
  return COLUMNS.map((col) => (obj[col] !== undefined && obj[col] !== null ? String(obj[col]) : ''));
}

/**
 * Añade una nueva reserva confirmada al registro.
 */
async function appendBooking(booking) {
  await ensureHeader();
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId(),
    range: await rangeAll(),
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [objectToRow(booking)] },
  });
}

/**
 * Devuelve todas las reservas con su número de fila real en la hoja
 * (necesario para poder actualizar la fila correcta después).
 */
async function getAllBookings() {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId(), range: await rangeAll() });
  const rows = res.data.values || [];
  if (rows.length < 2) return [];
  return rows.slice(1).map((row, i) => ({ ...rowToObject(row), _sheetRow: i + 2 }));
}

async function findBookingById(bookingId) {
  const all = await getAllBookings();
  return all.find((b) => b.bookingId === bookingId) || null;
}

/**
 * Actualiza campos concretos de una reserva ya existente (por su fila real).
 */
async function updateBookingRow(sheetRow, currentBooking, updates) {
  const merged = { ...currentBooking, ...updates };
  const sheets = getSheetsClient();
  const tab = await getTabName();
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId(),
    range: `'${tab}'!A${sheetRow}:${LAST_COL}${sheetRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [objectToRow(merged)] },
  });
}

// ============================================================
// Registro de bonos regalo, en una pestaña aparte ("Bonos") de la
// misma Google Sheet. El canje se lleva a mano: cuando alguien usa un
// bono, edita la columna "status" directamente en la hoja.
// ============================================================

const GIFT_TAB_TITLE = 'Bonos';
const GIFT_COLUMNS = [
  'bonoId', 'code', 'createdAt', 'status',
  'buyerName', 'buyerEmail', 'buyerPhone',
  'recipientName', 'giftType', 'serviceId', 'serviceName', 'amount',
  'message', 'expiryDate', 'paymentIntentId', 'lang',
];
const GIFT_LAST_COL = colLetter(GIFT_COLUMNS.length);

let giftTabReady = false;
async function ensureGiftTab() {
  if (giftTabReady) return;
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.get({ spreadsheetId: sheetId(), fields: 'sheets.properties' });
  const exists = (res.data.sheets || []).some((s) => s.properties.title === GIFT_TAB_TITLE);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId(),
      requestBody: { requests: [{ addSheet: { properties: { title: GIFT_TAB_TITLE } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId(),
      range: `'${GIFT_TAB_TITLE}'!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [GIFT_COLUMNS] },
    });
  }
  giftTabReady = true;
}

function giftObjectToRow(obj) {
  return GIFT_COLUMNS.map((col) => (obj[col] !== undefined && obj[col] !== null ? String(obj[col]) : ''));
}

/**
 * Añade un bono regalo comprado al registro (pestaña "Bonos").
 */
async function appendGift(gift) {
  await ensureGiftTab();
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId(),
    range: `'${GIFT_TAB_TITLE}'!A:${GIFT_LAST_COL}`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [giftObjectToRow(gift)] },
  });
}

// ============================================================
// Control de emails de cumpleaños, en una pestaña aparte
// ("Cumpleanos") — una fila por cliente, para no mandarle el email
// más de una vez el mismo año aunque tenga varias reservas.
// ============================================================

const BIRTHDAY_TAB_TITLE = 'Cumpleanos';
const BIRTHDAY_COLUMNS = ['emailNormalized', 'phoneNormalized', 'name', 'birthdate', 'lastSentYear'];
const BIRTHDAY_LAST_COL = colLetter(BIRTHDAY_COLUMNS.length);

let birthdayTabReady = false;
async function ensureBirthdayTab() {
  if (birthdayTabReady) return;
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.get({ spreadsheetId: sheetId(), fields: 'sheets.properties' });
  const exists = (res.data.sheets || []).some((s) => s.properties.title === BIRTHDAY_TAB_TITLE);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId(),
      requestBody: { requests: [{ addSheet: { properties: { title: BIRTHDAY_TAB_TITLE } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId(),
      range: `'${BIRTHDAY_TAB_TITLE}'!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [BIRTHDAY_COLUMNS] },
    });
  }
  birthdayTabReady = true;
}

function birthdayRowToObject(row) {
  const obj = {};
  BIRTHDAY_COLUMNS.forEach((col, i) => { obj[col] = row[i] !== undefined ? row[i] : ''; });
  return obj;
}
function birthdayObjectToRow(obj) {
  return BIRTHDAY_COLUMNS.map((col) => (obj[col] !== undefined && obj[col] !== null ? String(obj[col]) : ''));
}

async function getAllBirthdayRecords() {
  await ensureBirthdayTab();
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: `'${BIRTHDAY_TAB_TITLE}'!A:${BIRTHDAY_LAST_COL}`,
  });
  const rows = res.data.values || [];
  if (rows.length < 2) return [];
  return rows.slice(1).map((row, i) => ({ ...birthdayRowToObject(row), _sheetRow: i + 2 }));
}

/**
 * Marca a un cliente como "ya felicitado este año" — actualiza su fila
 * si ya existía, o crea una nueva si es la primera vez.
 */
async function upsertBirthdayRecord(record, existingRow) {
  await ensureBirthdayTab();
  const sheets = getSheetsClient();
  if (existingRow) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId(),
      range: `'${BIRTHDAY_TAB_TITLE}'!A${existingRow._sheetRow}:${BIRTHDAY_LAST_COL}${existingRow._sheetRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: [birthdayObjectToRow({ ...existingRow, ...record })] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId(),
      range: `'${BIRTHDAY_TAB_TITLE}'!A:${BIRTHDAY_LAST_COL}`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [birthdayObjectToRow(record)] },
    });
  }
}

// ============================================================
// Bonos de sesiones (paquetes de 3 sesiones), en una pestaña aparte
// ("BonosSesiones"). La 1ª sesión se agenda al comprar el bono; el
// resto se agendan desde el panel interno, que descuenta de
// "sessionsRemaining" cada vez que se usa una.
// ============================================================

const SESSION_BONO_TAB_TITLE = 'BonosSesiones';
const SESSION_BONO_COLUMNS = [
  'bonoId', 'createdAt', 'clientName', 'clientPhone', 'clientEmail',
  'serviceId', 'serviceName', 'employeeId', 'totalSessions', 'sessionsUsed',
  'sessionsRemaining', 'totalPrice', 'amountPaidOnline', 'paymentType',
  'remainingAmount', 'remainingPaidHow', 'status', 'expiryDate',
  'paymentIntentId', 'lang',
];
const SESSION_BONO_LAST_COL = colLetter(SESSION_BONO_COLUMNS.length);

let sessionBonoTabReady = false;
async function ensureSessionBonoTab() {
  if (sessionBonoTabReady) return;
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.get({ spreadsheetId: sheetId(), fields: 'sheets.properties' });
  const exists = (res.data.sheets || []).some((s) => s.properties.title === SESSION_BONO_TAB_TITLE);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId(),
      requestBody: { requests: [{ addSheet: { properties: { title: SESSION_BONO_TAB_TITLE } } }] },
    });
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId(),
    range: `'${SESSION_BONO_TAB_TITLE}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [SESSION_BONO_COLUMNS] },
  });
  sessionBonoTabReady = true;
}

function sessionBonoRowToObject(row) {
  const obj = {};
  SESSION_BONO_COLUMNS.forEach((col, i) => { obj[col] = row[i] !== undefined ? row[i] : ''; });
  return obj;
}
function sessionBonoObjectToRow(obj) {
  return SESSION_BONO_COLUMNS.map((col) => (obj[col] !== undefined && obj[col] !== null ? String(obj[col]) : ''));
}

async function appendSessionBono(bono) {
  await ensureSessionBonoTab();
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId(),
    range: `'${SESSION_BONO_TAB_TITLE}'!A:${SESSION_BONO_LAST_COL}`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [sessionBonoObjectToRow(bono)] },
  });
}

async function getAllSessionBonos() {
  await ensureSessionBonoTab();
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: `'${SESSION_BONO_TAB_TITLE}'!A:${SESSION_BONO_LAST_COL}`,
  });
  const rows = res.data.values || [];
  if (rows.length < 2) return [];
  return rows.slice(1).map((row, i) => ({ ...sessionBonoRowToObject(row), _sheetRow: i + 2 }));
}

async function findSessionBonoById(bonoId) {
  const all = await getAllSessionBonos();
  return all.find((b) => b.bonoId === bonoId) || null;
}

async function updateSessionBonoRow(sheetRow, currentBono, updates) {
  await ensureSessionBonoTab();
  const merged = { ...currentBono, ...updates };
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId(),
    range: `'${SESSION_BONO_TAB_TITLE}'!A${sheetRow}:${SESSION_BONO_LAST_COL}${sheetRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [sessionBonoObjectToRow(merged)] },
  });
}

// ============================================================
// Faltas (ausencias sin preaviso / cancelaciones tardías), en una
// pestaña aparte ("Faltas") — una fila por clienta, cuenta GLOBAL
// (no por bono): la 1ª falta se perdona, a partir de la 2ª se
// descuenta sesión del bono correspondiente.
// ============================================================

const STRIKES_TAB_TITLE = 'Faltas';
const STRIKES_COLUMNS = ['phoneNormalized', 'emailNormalized', 'name', 'strikeCount', 'lastStrikeDate'];
const STRIKES_LAST_COL = colLetter(STRIKES_COLUMNS.length);

let strikesTabReady = false;
async function ensureStrikesTab() {
  if (strikesTabReady) return;
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.get({ spreadsheetId: sheetId(), fields: 'sheets.properties' });
  const exists = (res.data.sheets || []).some((s) => s.properties.title === STRIKES_TAB_TITLE);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId(),
      requestBody: { requests: [{ addSheet: { properties: { title: STRIKES_TAB_TITLE } } }] },
    });
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId(),
    range: `'${STRIKES_TAB_TITLE}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [STRIKES_COLUMNS] },
  });
  strikesTabReady = true;
}

function strikesRowToObject(row) {
  const obj = {};
  STRIKES_COLUMNS.forEach((col, i) => { obj[col] = row[i] !== undefined ? row[i] : ''; });
  return obj;
}
function strikesObjectToRow(obj) {
  return STRIKES_COLUMNS.map((col) => (obj[col] !== undefined && obj[col] !== null ? String(obj[col]) : ''));
}

async function getAllStrikeRecords() {
  await ensureStrikesTab();
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: `'${STRIKES_TAB_TITLE}'!A:${STRIKES_LAST_COL}`,
  });
  const rows = res.data.values || [];
  if (rows.length < 2) return [];
  return rows.slice(1).map((row, i) => ({ ...strikesRowToObject(row), _sheetRow: i + 2 }));
}

async function upsertStrikeRecord(record, existingRow) {
  await ensureStrikesTab();
  const sheets = getSheetsClient();
  if (existingRow) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId(),
      range: `'${STRIKES_TAB_TITLE}'!A${existingRow._sheetRow}:${STRIKES_LAST_COL}${existingRow._sheetRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: [strikesObjectToRow({ ...existingRow, ...record })] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId(),
      range: `'${STRIKES_TAB_TITLE}'!A:${STRIKES_LAST_COL}`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [strikesObjectToRow(record)] },
    });
  }
}

// ============================================================
// Saldo de fidelización, en una pestaña aparte ("Saldo") — es un
// libro mayor (ledger): cada fila es un movimiento (earn/redeem), y
// el saldo de una clienta es la suma de sus filas. Así queda
// trazable de dónde sale cada euro acumulado (fecha, tratamiento,
// categoría contable, forma de pago, tasa aplicada).
// ============================================================

const LOYALTY_TAB_TITLE = 'Saldo';
const LOYALTY_COLUMNS = [
  'date', 'phoneNormalized', 'emailNormalized', 'name', 'type',
  'bookingId', 'serviceName', 'category', 'baseAmount', 'paidHow',
  'rateApplied', 'amount',
];
const LOYALTY_LAST_COL = colLetter(LOYALTY_COLUMNS.length);

let loyaltyTabReady = false;
async function ensureLoyaltyTab() {
  if (loyaltyTabReady) return;
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.get({ spreadsheetId: sheetId(), fields: 'sheets.properties' });
  const exists = (res.data.sheets || []).some((s) => s.properties.title === LOYALTY_TAB_TITLE);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId(),
      requestBody: { requests: [{ addSheet: { properties: { title: LOYALTY_TAB_TITLE } } }] },
    });
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId(),
    range: `'${LOYALTY_TAB_TITLE}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [LOYALTY_COLUMNS] },
  });
  loyaltyTabReady = true;
}

function loyaltyObjectToRow(obj) {
  return LOYALTY_COLUMNS.map((col) => (obj[col] !== undefined && obj[col] !== null ? String(obj[col]) : ''));
}
function loyaltyRowToObject(row) {
  const obj = {};
  LOYALTY_COLUMNS.forEach((col, i) => { obj[col] = row[i] !== undefined ? row[i] : ''; });
  return obj;
}

async function appendLoyaltyMovement(movement) {
  await ensureLoyaltyTab();
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId(),
    range: `'${LOYALTY_TAB_TITLE}'!A:${LOYALTY_LAST_COL}`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [loyaltyObjectToRow(movement)] },
  });
}

async function getLoyaltyMovementsForPhone(phoneNormalized) {
  await ensureLoyaltyTab();
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: `'${LOYALTY_TAB_TITLE}'!A:${LOYALTY_LAST_COL}`,
  });
  const rows = res.data.values || [];
  if (rows.length < 2) return [];
  return rows.slice(1).map(loyaltyRowToObject).filter((m) => m.phoneNormalized === phoneNormalized);
}

async function getAllLoyaltyMovements() {
  await ensureLoyaltyTab();
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: `'${LOYALTY_TAB_TITLE}'!A:${LOYALTY_LAST_COL}`,
  });
  const rows = res.data.values || [];
  if (rows.length < 2) return [];
  return rows.slice(1).map(loyaltyRowToObject);
}

// ============================================================
// Ventas de producto sueltas (no ligadas a ninguna cita) — para que
// el informe trimestral también recoja la columna "Venta" del Excel.
// ============================================================

const PRODUCT_SALE_TAB_TITLE = 'VentasProducto';
const PRODUCT_SALE_COLUMNS = ['saleId', 'createdAt', 'date', 'product', 'amount', 'paidHow', 'notes'];
const PRODUCT_SALE_LAST_COL = colLetter(PRODUCT_SALE_COLUMNS.length);

let productSaleTabReady = false;
async function ensureProductSaleTab() {
  if (productSaleTabReady) return;
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.get({ spreadsheetId: sheetId(), fields: 'sheets.properties' });
  const exists = (res.data.sheets || []).some((s) => s.properties.title === PRODUCT_SALE_TAB_TITLE);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId(),
      requestBody: { requests: [{ addSheet: { properties: { title: PRODUCT_SALE_TAB_TITLE } } }] },
    });
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId(),
    range: `'${PRODUCT_SALE_TAB_TITLE}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [PRODUCT_SALE_COLUMNS] },
  });
  productSaleTabReady = true;
}

function productSaleObjectToRow(obj) {
  return PRODUCT_SALE_COLUMNS.map((col) => (obj[col] !== undefined && obj[col] !== null ? String(obj[col]) : ''));
}
function productSaleRowToObject(row) {
  const obj = {};
  PRODUCT_SALE_COLUMNS.forEach((col, i) => { obj[col] = row[i] !== undefined ? row[i] : ''; });
  return obj;
}

async function appendProductSale(sale) {
  await ensureProductSaleTab();
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId(),
    range: `'${PRODUCT_SALE_TAB_TITLE}'!A:${PRODUCT_SALE_LAST_COL}`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [productSaleObjectToRow(sale)] },
  });
}

async function getAllProductSales() {
  await ensureProductSaleTab();
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: `'${PRODUCT_SALE_TAB_TITLE}'!A:${PRODUCT_SALE_LAST_COL}`,
  });
  const rows = res.data.values || [];
  if (rows.length < 2) return [];
  return rows.slice(1).map(productSaleRowToObject);
}

module.exports = {
  appendBooking, getAllBookings, findBookingById, updateBookingRow, COLUMNS, appendGift,
  getAllBirthdayRecords, upsertBirthdayRecord,
  appendSessionBono, getAllSessionBonos, findSessionBonoById, updateSessionBonoRow,
  getAllStrikeRecords, upsertStrikeRecord,
  appendLoyaltyMovement, getLoyaltyMovementsForPhone, getAllLoyaltyMovements,
  appendProductSale, getAllProductSales,
};
