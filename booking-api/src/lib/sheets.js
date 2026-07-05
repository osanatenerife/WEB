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
const RANGE_ALL = `Sheet1!A:${String.fromCharCode(64 + COLUMNS.length)}`;

function getSheetsClient() {
  return google.sheets({ version: 'v4', auth: getAuth() });
}

function sheetId() {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error('Falta la variable de entorno GOOGLE_SHEET_ID');
  return id;
}

async function ensureHeader() {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId(), range: 'Sheet1!A1:A1' });
  const hasHeader = res.data.values && res.data.values.length > 0;
  if (!hasHeader) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId(),
      range: 'Sheet1!A1',
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
    range: RANGE_ALL,
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
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId(), range: RANGE_ALL });
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
  const lastCol = String.fromCharCode(64 + COLUMNS.length);
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId(),
    range: `Sheet1!A${sheetRow}:${lastCol}${sheetRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [objectToRow(merged)] },
  });
}

module.exports = { appendBooking, getAllBookings, findBookingById, updateBookingRow, COLUMNS };
