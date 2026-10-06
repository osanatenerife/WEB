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

// Minutos de margen que reservamos normalmente para que la clienta llegue
// y se prepare — con 2+ tratamientos reales en la misma visita, ese margen
// solo hace falta una vez (ya está en el centro para el resto), así que se
// resta del total de la visita completa en vez de sumarse por cada uno.
const COMBO_ARRIVAL_BUFFER_MINUTES = 15;

// Nunca por debajo de la duración del tratamiento más largo de la visita,
// para no dejar menos tiempo del que ya necesita uno solo.
function applyComboBuffer(naiveTotal, itemCount, longestItemMinutes) {
  if (itemCount < 2) return naiveTotal;
  return Math.max(longestItemMinutes, naiveTotal - COMBO_ARRIVAL_BUFFER_MINUTES);
}

function totalDuration(service, resolvedExtras, extraServices = []) {
  // Los "extras" (resolvedExtras) son modificadores del tratamiento
  // principal (p.ej. un tinte) — no cuentan como tratamiento aparte a
  // efectos del margen de llegada. Los "extraServices" sí son
  // tratamientos reales añadidos a la misma visita.
  const naive = service.durationMinutes
    + resolvedExtras.reduce((sum, e) => sum + e.durationMinutes, 0)
    + extraServices.reduce((sum, s) => sum + s.durationMinutes, 0);
  const itemCount = 1 + extraServices.length;
  const longest = Math.max(service.durationMinutes, ...extraServices.map((s) => s.durationMinutes));
  return applyComboBuffer(naive, itemCount, longest);
}

function totalPrice(service, resolvedExtras, extraServices = []) {
  return service.price
    + resolvedExtras.reduce((sum, e) => sum + e.price, 0)
    + extraServices.reduce((sum, s) => sum + s.price, 0);
}

module.exports = {
  parseExtraIds, resolveExtras, resolveExtraServices, totalDuration, totalPrice,
  applyComboBuffer, COMBO_ARRIVAL_BUFFER_MINUTES,
};
