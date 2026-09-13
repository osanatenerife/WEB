// Compartido entre panel.js ("Cerrar cita") y webhook.js (cierre automático
// de reservas pagadas al 100% online) — un único sitio donde se calcula lo
// ganado de saldo de fidelidad por un importe, para no duplicar la lógica.

const { accountingCategoryFor } = require('../config/accountingCategories');
const { earnRateFor } = require('../config/loyalty');
const { normalizePhone, normalizeEmail } = require('./clientId');
const { appendLoyaltyMovement, getAllLoyaltyMovements } = require('./sheets');

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Registra en el libro de saldo lo ganado por una parte del importe (la
// pagada online siempre es tarjeta; la del centro depende de paidHow).
// "category" es opcional — solo hace falta cuando no hay un serviceId real
// del que deducirla (p.ej. venta de producto suelta).
async function earnLoyalty({ booking, portionAmount, paidHow, category: categoryOverride }) {
  if (!portionAmount || portionAmount <= 0) return;
  const firstServiceId = String(booking.serviceId || '').split(',')[0].trim();
  const category = categoryOverride || accountingCategoryFor(firstServiceId);
  const rate = earnRateFor(category, paidHow);
  const amount = round2(portionAmount * rate);
  if (amount <= 0) return;
  await appendLoyaltyMovement({
    date: new Date().toISOString().slice(0, 10),
    phoneNormalized: normalizePhone(booking.phone),
    emailNormalized: normalizeEmail(booking.email),
    name: booking.name,
    type: 'earn',
    bookingId: booking.bookingId,
    serviceName: booking.serviceName,
    category,
    baseAmount: portionAmount,
    paidHow,
    rateApplied: rate,
    amount,
  });
}

// Cuando una cita que ya había generado saldo de fidelidad se elimina o se
// cancela con reembolso (p.ej. se dio de alta por error, o la clienta
// cancela y se le devuelve el dinero), ese saldo ganado deja de tener
// sentido — se revierte con un movimiento nuevo (nunca se borra el
// original, para no perder el rastro contable) por cada "earn" que tenga
// esa cita, con el mismo importe en negativo a efectos de saldo.
async function reverseLoyaltyForBooking(bookingId, note) {
  if (!bookingId) return;
  const all = await getAllLoyaltyMovements();
  const earns = all.filter((m) => m.bookingId === bookingId && m.type === 'earn');
  const alreadyReversedIds = new Set(
    all.filter((m) => m.bookingId === bookingId && m.type === 'reversal').map((m) => m._sheetRow)
  );
  for (const m of earns) {
    // Si ya se revirtió esta cita antes (p.ej. un reintento tras un fallo a
    // media eliminación), no se duplica: se compara por si ya hay AL MENOS
    // una reversión para este bookingId, no una a una.
    if (alreadyReversedIds.size > 0) continue;
    await appendLoyaltyMovement({
      date: new Date().toISOString().slice(0, 10),
      phoneNormalized: m.phoneNormalized,
      emailNormalized: m.emailNormalized,
      name: m.name,
      type: 'reversal',
      bookingId: m.bookingId,
      serviceName: m.serviceName,
      category: m.category,
      baseAmount: m.baseAmount,
      paidHow: m.paidHow,
      rateApplied: m.rateApplied,
      amount: m.amount,
      note: note || 'Cita eliminada — se revierte el saldo ganado.',
    });
  }
}

module.exports = { earnLoyalty, reverseLoyaltyForBooking, round2 };
