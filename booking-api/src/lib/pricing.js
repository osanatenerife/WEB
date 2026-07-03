const extras = require('../config/extras');

// Acepta "id1,id2" (query string) o un array (body JSON)
function parseExtraIds(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
}

function resolveExtras(extraIds) {
  return extraIds.map((id) => extras.find((e) => e.id === id)).filter(Boolean);
}

function totalDuration(service, resolvedExtras) {
  return service.durationMinutes + resolvedExtras.reduce((sum, e) => sum + e.durationMinutes, 0);
}

function totalPrice(service, resolvedExtras) {
  return service.price + resolvedExtras.reduce((sum, e) => sum + e.price, 0);
}

module.exports = { parseExtraIds, resolveExtras, totalDuration, totalPrice };
