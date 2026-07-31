// ============================================================
// Validación y cálculo de códigos de descuento (ver sheets.js,
// pestaña "Descuentos"). Se usa tanto en el checkout público (validar
// un código que escribe la clienta) como en el panel (comprobar que un
// código que se va a crear no exista ya).
// ============================================================

function round2(n) {
  return Math.round(n * 100) / 100;
}

function todayLabel() {
  return new Date().toISOString().slice(0, 10);
}

function discountServiceIds(discount) {
  return String(discount.serviceIds || '').split(',').map((s) => s.trim()).filter(Boolean);
}

// ¿Este código está activo hoy (fechas + no desactivado a mano)?
function isDiscountLive(discount) {
  if (!discount) return false;
  if (String(discount.active) === 'false') return false;
  const today = todayLabel();
  if (discount.validFrom && today < discount.validFrom) return false;
  if (discount.validUntil && today > discount.validUntil) return false;
  return true;
}

function findDiscountByCode(discounts, code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) return null;
  return discounts.find((d) => String(d.code || '').trim().toUpperCase() === normalized) || null;
}

// ¿Aplica a alguno de los tratamientos seleccionados? (basta con que uno coincida)
function discountAppliesTo(discount, serviceIds) {
  const ids = discountServiceIds(discount);
  if (!ids.length) return false;
  return (serviceIds || []).some((id) => ids.includes(id));
}

// Importe a descontar del total, dado el servicio principal + tratamientos
// añadidos (con precio) — solo se descuenta la parte de los que coinciden
// con el código, nunca el total completo si hay tratamientos ajenos al código.
function computeDiscountAmount(discount, priceableItems) {
  const ids = discountServiceIds(discount);
  const matching = (priceableItems || []).filter((item) => ids.includes(item.id));
  const matchingSum = matching.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
  if (!matchingSum) return 0;
  if (discount.discountType === 'percent') {
    return round2(matchingSum * (Number(discount.discountValue) / 100));
  }
  // Importe fijo: nunca más que la suma de lo que realmente aplica
  return Math.min(round2(Number(discount.discountValue) || 0), matchingSum);
}

module.exports = {
  isDiscountLive, findDiscountByCode, discountAppliesTo, discountServiceIds, computeDiscountAmount,
};
