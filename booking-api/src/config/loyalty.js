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

// Umbral mínimo por canje. Sin tope máximo: llegar a un saldo alto ya
// implica un gasto real considerable (con la tasa del 4-6%, acumular 50€
// exige unos 800-900€ gastados en el centro), así que no tiene sentido
// limitar además cuánto puede canjear de golpe una clienta que ya se lo
// ha "ganado" con ese gasto.
const MIN_REDEEM_AMOUNT = 10; // en euros

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

// En diciembre, todo el saldo del año está a punto de caducar de todas
// formas — así que el mínimo de MIN_REDEEM_AMOUNT no se aplica ese mes, para
// que nadie pierda 4€ o 5€ sueltos solo por no llegar al mínimo. Esto es
// una excepción SOLO interna (uso del panel): no se explica en ningún sitio
// público (web, email) a propósito — se comunica de palabra en el centro,
// para dar sensación de urgencia de "úsalo antes de que caduque".
function effectiveMinRedeem() {
  return new Date().getMonth() === 11 ? 0 : MIN_REDEEM_AMOUNT;
}

module.exports = {
  BASE_RATE, CASH_BONUS, earnRateFor, REDEEMABLE_ON, MIN_REDEEM_AMOUNT,
  computeLoyaltyBalance, currentExpiryDate, effectiveMinRedeem,
};
