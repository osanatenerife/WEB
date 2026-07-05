const services = require('../config/services');
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

// "Otros tratamientos" añadidos a la misma cita (cualquier servicio del catálogo,
// no solo los extras fijos de arriba) — se suman a la duración y precio igual
// que el servicio principal, y todo forma una única cita combinada.
function resolveExtraServices(serviceIds) {
  return serviceIds.map((id) => services.find((s) => s.id === id)).filter(Boolean);
}

function totalDuration(service, resolvedExtras, extraServices = []) {
  return service.durationMinutes
    + resolvedExtras.reduce((sum, e) => sum + e.durationMinutes, 0)
    + extraServices.reduce((sum, s) => sum + s.durationMinutes, 0);
}

function totalPrice(service, resolvedExtras, extraServices = []) {
  return service.price
    + resolvedExtras.reduce((sum, e) => sum + e.price, 0)
    + extraServices.reduce((sum, s) => sum + s.price, 0);
}

module.exports = { parseExtraIds, resolveExtras, resolveExtraServices, totalDuration, totalPrice };
