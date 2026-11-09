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

// Depilación láser: cada zona tiene un "cabinMinutes" (tiempo real tratando,
// sin margen — ver config/services.js) en vez de usar directamente
// durationMinutes para calcular combos. Cuando se juntan varias zonas de
// láser en la misma visita, el margen de cambio/cobro solo se cuenta UNA
// vez para todo el grupo (no el COMBO_ARRIVAL_BUFFER_MINUTES genérico, que
// da una cifra menos precisa) — confirmado con la dueña con tiempos reales
// de cabina para cada zona.
const LASER_OVERHEAD_MINUTES = 10;

// Duración de una visita a partir de sus tratamientos "reales" (el grupo de
// zonas de láser, si hay alguna, cuenta como UNA sola pieza con su propio
// margen preciso — ver arriba) + minutos sueltos de modificadores (p.ej. un
// tinte) que se suman aparte, sin contar como pieza propia. Compartida por
// el checkout normal y el de bonos, para que ambos calculen igual.
function durationForItems(mainItems, extrasMinutes = 0) {
  const laserItems = mainItems.filter((s) => s.cabinMinutes != null);
  const otherItems = mainItems.filter((s) => s.cabinMinutes == null);

  const pieces = otherItems.map((s) => s.durationMinutes);
  if (laserItems.length) {
    pieces.push(laserItems.reduce((sum, s) => sum + s.cabinMinutes, 0) + LASER_OVERHEAD_MINUTES);
  }

  const naive = pieces.reduce((sum, m) => sum + m, 0) + extrasMinutes;
  const longest = pieces.length ? Math.max(...pieces) : 0;
  return applyComboBuffer(naive, pieces.length, longest);
}

function totalDuration(service, resolvedExtras, extraServices = []) {
  // Los "extras" (resolvedExtras) son modificadores del tratamiento
  // principal (p.ej. un tinte) — no cuentan como tratamiento aparte a
  // efectos del margen de llegada. Los "extraServices" sí son
  // tratamientos reales añadidos a la misma visita.
  const extrasMinutes = resolvedExtras.reduce((sum, e) => sum + e.durationMinutes, 0);
  return durationForItems([service, ...extraServices], extrasMinutes);
}

function totalPrice(service, resolvedExtras, extraServices = []) {
  return service.price
    + resolvedExtras.reduce((sum, e) => sum + e.price, 0)
    + extraServices.reduce((sum, s) => sum + s.price, 0);
}

module.exports = {
  parseExtraIds, resolveExtras, resolveExtraServices, totalDuration, totalPrice,
  applyComboBuffer, COMBO_ARRIVAL_BUFFER_MINUTES, durationForItems,
};
