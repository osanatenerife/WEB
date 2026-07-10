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

const BASE_RATE = { cejas: 0.05, laser: 0.08, corporal: 0.08, facial: 0.08 };
const CASH_BONUS = 0.02; // +2% si esa parte se pagó en efectivo

function earnRateFor(category, paidHow) {
  const base = BASE_RATE[category] !== undefined ? BASE_RATE[category] : BASE_RATE.facial;
  return paidHow === 'efectivo' ? base + CASH_BONUS : base;
}

// Canjeable solo en tratamientos sueltos, nunca en bonos ni bono regalo.
const REDEEMABLE_ON = ['treatment'];

// Umbral mínimo para poder canjear, y caducidad del saldo acumulado.
const MIN_REDEEM_AMOUNT = 10; // en euros
const BALANCE_VALIDITY_MONTHS = 12;

module.exports = { BASE_RATE, CASH_BONUS, earnRateFor, REDEEMABLE_ON, MIN_REDEEM_AMOUNT, BALANCE_VALIDITY_MONTHS };
