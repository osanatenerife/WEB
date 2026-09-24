// ============================================================
// Validación y cálculo de códigos de descuento (ver sheets.js,
// pestaña "Descuentos"). Se usa tanto en el checkout público (validar
// un código que escribe la clienta) como en el panel (comprobar que un
// código que se va a crear no exista ya).
// ============================================================

const { getAllDiscounts } = require('./sheets');

function round2(n) {
  return Math.round(n * 100) / 100;
}

function todayLabel() {
  return new Date().toISOString().slice(0, 10);
}

function discountServiceIds(discount) {
  return String(discount.serviceIds || '').split(',').map((s) => s.trim()).filter(Boolean);
}

// Descuentos generales (p.ej. el 15% de cumpleaños) no se restringen a
// tratamientos concretos — en vez de obligar a marcar uno por uno cada
// tratamiento del catálogo (y tener que acordarse de añadir los nuevos),
// se guardan con serviceIds = 'ALL'.
function discountIsAllServices(discount) {
  return String(discount.serviceIds || '').trim().toUpperCase() === 'ALL';
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

// Puede haber más de un descuento con el mismo texto de código si uno viejo
// se desactivó y se reutilizó el texto (p.ej. porque ya está repartido por
// ManyChat/redes y no se puede cambiar) — se prioriza el que esté activo,
// y entre varios activos (no debería pasar) el creado más reciente.
function findDiscountByCode(discounts, code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) return null;
  const matches = discounts.filter((d) => String(d.code || '').trim().toUpperCase() === normalized);
  if (!matches.length) return null;
  const active = matches.filter((d) => d.active !== 'false');
  const pool = active.length ? active : matches;
  return pool.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
}

// ¿Este código aplica al tipo de compra actual (sesión suelta o bono)?
// Vacío = 'loose', para no cambiar el comportamiento de los códigos creados
// antes de que existiera este campo.
function discountAppliesToMode(discount, mode) {
  const scope = discount.appliesTo || 'loose';
  if (scope === 'both') return true;
  return scope === mode;
}

// ¿Aplica a alguno de los tratamientos seleccionados? (basta con que uno coincida)
function discountAppliesTo(discount, serviceIds) {
  if (discountIsAllServices(discount)) return (serviceIds || []).length > 0;
  const ids = discountServiceIds(discount);
  if (!ids.length) return false;
  return (serviceIds || []).some((id) => ids.includes(id));
}

// Importe a descontar del total, dado el servicio principal + tratamientos
// añadidos (con precio) — solo se descuenta la parte de los que coinciden
// con el código, nunca el total completo si hay tratamientos ajenos al código
// (salvo que el código sea de "todos los tratamientos", donde aplica a todos).
function computeDiscountAmount(discount, priceableItems) {
  const ids = discountServiceIds(discount);
  const matching = discountIsAllServices(discount)
    ? (priceableItems || [])
    : (priceableItems || []).filter((item) => ids.includes(item.id));
  const matchingSum = matching.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
  if (!matchingSum) return 0;
  if (discount.discountType === 'percent') {
    // Nunca más del 100%, aunque el dato guardado esté mal introducido.
    const pct = Math.min(100, Math.max(0, Number(discount.discountValue) || 0));
    return round2(matchingSum * (pct / 100));
  }
  // Importe fijo: nunca más que la suma de lo que realmente aplica
  return Math.min(round2(Number(discount.discountValue) || 0), matchingSum);
}

// Recalcula el descuento SIEMPRE en el servidor (nunca se confía en un
// importe que venga del navegador) — a partir del código, los tratamientos
// realmente seleccionados (con precios resueltos por quien llama) y el tipo
// de compra (sesión suelta o bono). Compartida entre checkout.js (sesiones
// sueltas) y bonoCheckout.js (bonos) para no duplicar esta lógica.
async function resolveDiscount(code, priceableItems, mode) {
  if (!code) return null;
  const discounts = await getAllDiscounts();
  const discount = findDiscountByCode(discounts, code);
  if (!discount || !isDiscountLive(discount)) return null;
  if (!discountAppliesToMode(discount, mode)) return null;
  const amount = computeDiscountAmount(discount, priceableItems);
  if (!amount) return null;
  return { code: discount.code, amount };
}

module.exports = {
  isDiscountLive, findDiscountByCode, discountAppliesTo, discountAppliesToMode,
  discountServiceIds, discountIsAllServices, computeDiscountAmount, resolveDiscount,
};
