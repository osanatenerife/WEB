// Compartido entre panel.js ("Cerrar cita") y webhook.js (cierre automático
// de reservas pagadas al 100% online) — un único sitio donde se calcula lo
// ganado de saldo de fidelidad por un importe, para no duplicar la lógica.

const { accountingCategoryFor } = require('../config/accountingCategories');
const { earnRateFor } = require('../config/loyalty');
const { normalizePhone, normalizeEmail } = require('./clientId');
const { appendLoyaltyMovement } = require('./sheets');

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

module.exports = { earnLoyalty, round2 };
