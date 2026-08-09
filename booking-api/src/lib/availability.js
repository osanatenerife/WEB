const hours = require('../config/hours');
const { localToISO, addMinutes } = require('./timezone');
const { getBusyIntervals } = require('./googleCalendar');

const MIN_LEAD_MINUTES = 120; // no permitir reservar con menos de 2h de antelación

// Si reservar en un hueco concreto dejaría, justo después, un tramo libre
// más pequeño que esto (pero no cero) antes del siguiente compromiso, ese
// hueco se considera "muerto" — no llega para un tratamiento de duración
// normal (facial, radiofrecuencia...). Evita que un tratamiento corto
// (p.ej. cejas de 20 min) fragmente el día dejando restos inservibles.
const MIN_USABLE_GAP_MINUTES = 60;

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function isClosureDate(dateStr) {
  return (hours.closures || []).some((c) => dateStr >= c.start && dateStr <= c.end);
}

/**
 * Calcula los huecos disponibles para un día concreto.
 * @param {string} dateStr  "YYYY-MM-DD" (fecha local del centro)
 * @param {string} calendarId  calendario de Google de la empleada
 * @param {number} durationMinutes  duración del servicio
 * @param {object} [weeklySchedule]  horario semanal a usar (por defecto, el general del centro);
 *   pásale el de la empleada (employee.weekly) para respetar su horario personal.
 * @returns {Promise<string[]>} horas de inicio disponibles, formato "HH:mm"
 */
async function getAvailableSlots(dateStr, calendarId, durationMinutes, weeklySchedule) {
  if (isClosureDate(dateStr)) return [];
  const weekday = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
  const daySchedule = (weeklySchedule || hours.weekly)[weekday];
  if (!daySchedule || daySchedule.closed) return [];

  const dayStartISO = localToISO(dateStr, daySchedule.open, hours.timezone);
  const dayEndISO = localToISO(dateStr, daySchedule.close, hours.timezone);

  const busy = await getBusyIntervals(calendarId, dayStartISO, dayEndISO);
  const busyRanges = busy
    .map((b) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() }))
    .sort((a, b) => a.start - b.start);
  const busyStarts = busyRanges.map((r) => r.start);

  const now = Date.now() + MIN_LEAD_MINUTES * 60000;
  const step = hours.slotStepMinutes;
  const dayEndMs = new Date(dayEndISO).getTime();

  // Los huecos "buenos" (no dejan un tramo muerto detrás) van primero;
  // los que sí dejan un tramo muerto solo se ofrecen si no hay ninguno
  // bueno ese día — así nunca se le oculta a la clienta un hueco que
  // realmente es el único disponible.
  const goodSlots = [];
  const fallbackSlots = [];
  let cursorISO = dayStartISO;
  while (true) {
    const slotStartMs = new Date(cursorISO).getTime();
    const slotEndISO = addMinutes(cursorISO, durationMinutes);
    const slotEndMs = new Date(slotEndISO).getTime();
    if (slotEndMs > dayEndMs) break;

    const isFree = !busyRanges.some((r) => overlaps(slotStartMs, slotEndMs, r.start, r.end));
    const isFuture = slotStartMs >= now;
    if (isFree && isFuture) {
      // Extraemos "HH:mm" en la zona horaria del centro para mostrarlo
      const label = new Intl.DateTimeFormat('es-ES', {
        timeZone: hours.timezone, hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(new Date(cursorISO));

      // Solo cuenta como "hueco muerto" si deja un tramo corto antes de
      // OTRA cita real — terminar un poco antes del cierre no desperdicia
      // nada (no hay nadie después esperando ese rato).
      const upcoming = busyStarts.filter((s) => s >= slotEndMs);
      let leavesDeadGap = false;
      if (upcoming.length) {
        const nextBoundaryMs = Math.min(...upcoming);
        const gapAfterMinutes = (nextBoundaryMs - slotEndMs) / 60000;
        leavesDeadGap = gapAfterMinutes > 0.5 && gapAfterMinutes < MIN_USABLE_GAP_MINUTES;
      }

      (leavesDeadGap ? fallbackSlots : goodSlots).push(label);
    }
    cursorISO = addMinutes(cursorISO, step);
  }
  return goodSlots.length ? goodSlots : fallbackSlots;
}

/**
 * Comprueba si un rango exacto de tiempo está libre para una empleada —
 * usado para ampliar una cita ya confirmada con un tratamiento añadido
 * justo a continuación (no busca huecos, valida uno concreto).
 */
async function isRangeFree(dateStr, calendarId, startISO, endISO, weeklySchedule) {
  if (isClosureDate(dateStr)) return false;
  const weekday = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
  const daySchedule = (weeklySchedule || hours.weekly)[weekday];
  if (!daySchedule || daySchedule.closed) return false;

  const dayEndISO = localToISO(dateStr, daySchedule.close, hours.timezone);
  if (new Date(endISO).getTime() > new Date(dayEndISO).getTime()) return false; // se saldría del horario

  const busy = await getBusyIntervals(calendarId, startISO, endISO);
  const startMs = new Date(startISO).getTime();
  const endMs = new Date(endISO).getTime();
  return !busy.some((b) => overlaps(startMs, endMs, new Date(b.start).getTime(), new Date(b.end).getTime()));
}

module.exports = { getAvailableSlots, isRangeFree, MIN_LEAD_MINUTES };
