const hours = require('../config/hours');
const { localToISO, addMinutes } = require('./timezone');
const { getBusyIntervals } = require('./googleCalendar');

const MIN_LEAD_MINUTES = 120; // no permitir reservar con menos de 2h de antelación

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Calcula los huecos disponibles para un día concreto.
 * @param {string} dateStr  "YYYY-MM-DD" (fecha local del centro)
 * @param {string} calendarId  calendario de Google de la empleada
 * @param {number} durationMinutes  duración del servicio
 * @returns {Promise<string[]>} horas de inicio disponibles, formato "HH:mm"
 */
async function getAvailableSlots(dateStr, calendarId, durationMinutes) {
  const weekday = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
  const daySchedule = hours.weekly[weekday];
  if (!daySchedule || daySchedule.closed) return [];

  const dayStartISO = localToISO(dateStr, daySchedule.open, hours.timezone);
  const dayEndISO = localToISO(dateStr, daySchedule.close, hours.timezone);

  const busy = await getBusyIntervals(calendarId, dayStartISO, dayEndISO);
  const busyRanges = busy.map((b) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() }));

  const now = Date.now() + MIN_LEAD_MINUTES * 60000;
  const step = hours.slotStepMinutes;
  const dayEndMs = new Date(dayEndISO).getTime();

  const slots = [];
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
      slots.push(label);
    }
    cursorISO = addMinutes(cursorISO, step);
  }
  return slots;
}

module.exports = { getAvailableSlots, MIN_LEAD_MINUTES };
