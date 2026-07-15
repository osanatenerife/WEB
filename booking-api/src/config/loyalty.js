// ============================================================
// TASAS DE ACUMULACIÓN DE SALDO DE FIDELIZACIÓN
// ------------------------------------------------------------
// Se acumula en EUROS directamente (no puntos abstractos), porque la
// tasa varía por categoría contable y por forma de pago — así el
// saldo ya es el descuento real disponible, sin conversión.
//
// Base según categoría + un plus fijo si se paga en efectivo (ahorra
// la comisión de tarjeta, así que tiene sentido devolver parte).
// ============================================================

const BASE_RATE = { cejas: 0.04, laser: 0.04, corporal: 0.04, facial: 0.04 };
const CASH_BONUS = 0.02; // +2% si esa parte se pagó en efectivo

function earnRateFor(category, paidHow) {
  const base = BASE_RATE[category] !== undefined ? BASE_RATE[category] : BASE_RATE.facial;
  return paidHow === 'efectivo' ? base + CASH_BONUS : base;
}

// Canjeable solo en tratamientos sueltos, nunca en bonos ni bono regalo.
const REDEEMABLE_ON = ['treatment'];

// Umbral mínimo y máximo por canje.
const MIN_REDEEM_AMOUNT = 10; // en euros
const MAX_REDEEM_PER_BOOKING = 50; // en euros, por cita/tratamiento

function round2(n) {
  return Math.round(n * 100) / 100;
}

// El saldo ganado ('earn') caduca cada 31 de diciembre — la cuenta empieza
// de cero cada 1 de enero. Lo canjeado ('redeem') se resta siempre, sin
// caducidad (ya salió de la cuenta cuando se usó).
function computeLoyaltyBalance(movements) {
  const cutoff = new Date(new Date().getFullYear(), 0, 1); // 1 de enero del año actual
  let balance = 0;
  (movements || []).forEach((m) => {
    const amount = Number(m.amount) || 0;
    if (m.type === 'redeem') {
      balance -= amount;
    } else if (new Date(m.date) >= cutoff) {
      balance += amount;
    }
  });
  return Math.max(0, round2(balance));
}

// Fecha en la que caduca el saldo actual (siempre el 31 de diciembre del año
// en curso, ya que solo cuenta lo ganado desde el 1 de enero — ver arriba).
function currentExpiryDate() {
  return new Date(new Date().getFullYear(), 11, 31);
}

module.exports = {
  BASE_RATE, CASH_BONUS, earnRateFor, REDEEMABLE_ON, MIN_REDEEM_AMOUNT, MAX_REDEEM_PER_BOOKING,
  computeLoyaltyBalance, currentExpiryDate,
};
