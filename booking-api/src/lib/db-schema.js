// ============================================================
// Esquema de las tablas de Supabase — una por cada pestaña de la Google
// Sheet. Es la ÚNICA fuente de verdad: docs/SCHEMA.sql se genera a partir
// de aquí (node tools/gen-schema.js) y db-supabase.js lo usa para convertir
// valores. El ORDEN de las columnas es exactamente el de los arrays de
// sheets.js (COLUMNS, GIFT_COLUMNS...) — tools/compare.js lo comprueba.
//
// Tipos:
//   text     → texto tal cual
//   int      → número entero
//   num      → número decimal (numeric sin límite, conserva "10.50" tal cual)
//   date     → fecha AAAA-MM-DD
//   ts       → fecha y hora (se guarda timestamptz, se devuelve toISOString())
//   bool:X   → booleano; true se devuelve como el texto X que usa el código
//              ('1', 'sent'...). Vacío = null = ''.
//   boolTF   → booleano que el código escribe como 'true'/'false'.
//
// Todas las lecturas devuelven TEXTO (igual que Sheets), con '' para vacío,
// para que panel.js, webhook.js y las demás rutas no noten ningún cambio.
// ============================================================

const TABLES = {
  bookings: {
    tab: '(primera pestaña)',
    table: 'reservas',
    unique: ['bookingId'],
    indexes: ['phone', 'lower(email)', 'date', 'bonoId', 'status'],
    columns: [
      ['bookingId', 'text'], ['createdAt', 'ts'], ['status', 'text'], ['name', 'text'],
      ['phone', 'text'], ['email', 'text'], ['serviceId', 'text'], ['serviceName', 'text'],
      ['employeeId', 'text'], ['employeeName', 'text'], ['calendarId', 'text'], ['eventId', 'text'],
      ['date', 'date'], ['time', 'text'], ['durationMinutes', 'int'], ['price', 'num'],
      ['amountPaid', 'num'], ['paymentType', 'text'], ['paymentIntentId', 'text'], ['lang', 'text'],
      ['reminderSent', 'bool:sent'], ['birthdate', 'date'], ['bonoId', 'text'], ['sessionNumber', 'text'],
      ['notes', 'text'], ['finalAmount', 'num'], ['remainderPaidHow', 'text'], ['remainderAmount2', 'num'],
      ['remainderPaidHow2', 'text'], ['redeemedAmount', 'num'], ['termsAcceptedAt', 'ts'],
      ['depositPaidHow', 'text'], ['noShowForgiven', 'bool:1'], ['deletedAsMistake', 'bool:1'],
      ['depositPaidDate', 'date'], ['confirmationEmailSent', 'bool:1'], ['depositAmount2', 'num'],
      ['depositPaidHow2', 'text'],
    ],
  },
  gifts: {
    tab: 'Bonos',
    table: 'bonos_regalo',
    unique: ['bonoId'],
    indexes: ['code', 'lower(buyerEmail)', 'buyerPhone'],
    columns: [
      ['bonoId', 'text'], ['code', 'text'], ['createdAt', 'ts'], ['status', 'text'],
      ['buyerName', 'text'], ['buyerEmail', 'text'], ['buyerPhone', 'text'], ['recipientName', 'text'],
      ['giftType', 'text'], ['serviceId', 'text'], ['serviceName', 'text'], ['amount', 'num'],
      ['message', 'text'], ['expiryDate', 'date'], ['paymentIntentId', 'text'], ['lang', 'text'],
      ['redeemedAt', 'ts'],
    ],
  },
  birthdays: {
    tab: 'Cumpleanos',
    table: 'cumpleanos',
    indexes: ['emailNormalized', 'phoneNormalized'],
    columns: [
      ['emailNormalized', 'text'], ['phoneNormalized', 'text'], ['name', 'text'],
      ['birthdate', 'date'], ['lastSentYear', 'int'],
    ],
  },
  unsubscribes: {
    tab: 'Bajas',
    table: 'bajas',
    indexes: ['emailNormalized'],
    columns: [['emailNormalized', 'text'], ['unsubscribedAt', 'ts']],
  },
  sessionBonos: {
    tab: 'BonosSesiones',
    table: 'bonos_sesiones',
    unique: ['bonoId'],
    indexes: ['clientPhone', 'lower(clientEmail)', 'status'],
    columns: [
      ['bonoId', 'text'], ['createdAt', 'ts'], ['clientName', 'text'], ['clientPhone', 'text'],
      ['clientEmail', 'text'], ['serviceId', 'text'], ['serviceName', 'text'], ['employeeId', 'text'],
      ['totalSessions', 'int'], ['sessionsUsed', 'int'], ['sessionsRemaining', 'int'],
      ['totalPrice', 'num'], ['amountPaidOnline', 'num'], ['paymentType', 'text'],
      ['remainingAmount', 'num'], ['remainingPaidHow', 'text'], ['status', 'text'],
      ['expiryDate', 'date'], ['paymentIntentId', 'text'], ['lang', 'text'],
      ['paidCash', 'num'], ['paidBizum', 'num'], ['paidCard', 'num'],
    ],
  },
  strikes: {
    tab: 'Faltas',
    table: 'faltas',
    indexes: ['phoneNormalized', 'emailNormalized'],
    columns: [
      ['phoneNormalized', 'text'], ['emailNormalized', 'text'], ['name', 'text'],
      ['strikeCount', 'int'], ['lastStrikeDate', 'date'],
    ],
  },
  loyalty: {
    tab: 'Saldo',
    table: 'saldo_movimientos',
    indexes: ['phoneNormalized', 'emailNormalized', 'bookingId'],
    columns: [
      ['date', 'date'], ['phoneNormalized', 'text'], ['emailNormalized', 'text'], ['name', 'text'],
      ['type', 'text'], ['bookingId', 'text'], ['serviceName', 'text'], ['category', 'text'],
      ['baseAmount', 'num'], ['paidHow', 'text'], ['rateApplied', 'num'], ['amount', 'num'],
      ['note', 'text'],
    ],
  },
  productSales: {
    tab: 'VentasProducto',
    table: 'ventas_producto',
    unique: ['saleId'],
    indexes: ['bookingId', 'clientPhone', 'date'],
    columns: [
      ['saleId', 'text'], ['createdAt', 'ts'], ['date', 'date'], ['product', 'text'],
      ['amount', 'num'], ['paidHow', 'text'], ['notes', 'text'], ['category', 'text'],
      ['bookingId', 'text'], ['status', 'text'], ['clientPhone', 'text'], ['clientName', 'text'],
      ['clientEmail', 'text'],
    ],
  },
  quotes: {
    tab: 'Presupuestos',
    table: 'presupuestos',
    unique: ['quoteId'],
    indexes: ['clientPhone', 'lower(clientEmail)'],
    columns: [
      ['quoteId', 'text'], ['createdAt', 'ts'], ['clientName', 'text'], ['clientPhone', 'text'],
      ['clientEmail', 'text'], ['description', 'text'], ['category', 'text'], ['amount', 'num'],
      ['status', 'text'], ['paidDate', 'date'], ['paymentIntentId', 'text'], ['lang', 'text'],
    ],
  },
  discounts: {
    tab: 'Descuentos',
    table: 'descuentos',
    unique: ['discountId'],
    indexes: ['code'],
    columns: [
      ['discountId', 'text'], ['code', 'text'], ['serviceIds', 'text'], ['serviceNames', 'text'],
      ['discountType', 'text'], ['discountValue', 'num'], ['validFrom', 'date'], ['validUntil', 'date'],
      ['active', 'boolTF'], ['createdAt', 'ts'], ['note', 'text'], ['emailSentAt', 'ts'],
      ['appliesTo', 'text'],
    ],
  },
  followups: {
    tab: 'Seguimientos',
    table: 'seguimientos',
    unique: ['followupId'],
    indexes: ['clientPhone', 'dueDate', 'status'],
    columns: [
      ['followupId', 'text'], ['createdAt', 'ts'], ['clientName', 'text'], ['clientPhone', 'text'],
      ['clientEmail', 'text'], ['note', 'text'], ['dueDate', 'date'], ['status', 'text'],
    ],
  },
};

// bookingId → booking_id
function snake(name) {
  return name.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
}

module.exports = { TABLES, snake };
