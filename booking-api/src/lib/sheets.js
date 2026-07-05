const { google } = require('googleapis');
const { getAuth } = require('./googleCalendar');

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
// T lang · U reminderSent
// ============================================================

const COLUMNS = [
  'bookingId', 'createdAt', 'status', 'name', 'phone', 'email',
  'serviceId', 'serviceName', 'employeeId', 'employeeName',
  'calendarId', 'eventId', 'date', 'time', 'durationMinutes',
  'price', 'amountPaid', 'paymentType', 'paymentIntentId',
  'lang', 'reminderSent',
];
const LAST_COL = String.fromCharCode(64 + COLUMNS.length);

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

async function ensureHeader() {
  const sheets = getSheetsClient();
  const tab = await getTabName();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId(), range: `'${tab}'!A1:A1` });
  const hasHeader = res.data.values && res.data.values.length > 0;
  if (!hasHeader) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId(),
      range: `'${tab}'!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [COLUMNS] },
    });
  }
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
const GIFT_LAST_COL = String.fromCharCode(64 + GIFT_COLUMNS.length);

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

module.exports = { appendBooking, getAllBookings, findBookingById, updateBookingRow, COLUMNS, appendGift };
