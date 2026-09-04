const hours = require('../config/hours');
const { localToISO } = require('./timezone');
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
async function getAvailableSlots(dateStr, calendarId, durationMinutes, weeklySchedule, opts) {
  // El equipo, desde el panel, a veces necesita agendar una cita puntual
  // después de la hora normal de cierre (un caso especial, la última
  // clienta del día...) — las clientas, reservando online, siguen sin
  // poder pasar de la hora de cierre real.
  const ignoreClosingTime = !!(opts && opts.ignoreClosingTime);
  if (isClosureDate(dateStr)) return [];
  const weekday = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
  const daySchedule = (weeklySchedule || hours.weekly)[weekday];
  if (!daySchedule || daySchedule.closed) return [];

  const dayStartISO = localToISO(dateStr, daySchedule.open, hours.timezone);
  const dayEndISO = localToISO(dateStr, ignoreClosingTime ? '23:00' : daySchedule.close, hours.timezone);
  const dayStartMs = new Date(dayStartISO).getTime();
  const dayEndMs = new Date(dayEndISO).getTime();

  const busy = await getBusyIntervals(calendarId, dayStartISO, dayEndISO);
  const busyRanges = busy
    .map((b) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() }))
    .sort((a, b) => a.start - b.start);
  const busyStarts = busyRanges.map((r) => r.start);

  const now = Date.now() + MIN_LEAD_MINUTES * 60000;
  const stepMs = hours.slotStepMinutes * 60000;

  // Candidatos: la rejilla habitual de cada `slotStepMinutes`, MÁS el
  // instante exacto en que termina cada compromiso ya existente ese día —
  // así un tratamiento puede empezar justo cuando acaba el anterior aunque
  // ese instante no caiga en la rejilla. Sin esto, cualquier servicio cuya
  // duración no sea múltiplo del paso (hay varios de 20, 40, 55, 70, 100
  // min con una rejilla de 15) deja huecos de pocos minutos que nunca se
  // llegan a ofrecer, aunque estén libres de verdad.
  const candidateMs = new Set();
  for (let t = dayStartMs; t < dayEndMs; t += stepMs) candidateMs.add(t);
  busyRanges.forEach((r) => { if (r.end >= dayStartMs && r.end < dayEndMs) candidateMs.add(r.end); });

  // Los huecos "buenos" (no dejan un tramo muerto detrás) van primero;
  // los que sí dejan un tramo muerto solo se ofrecen si no hay ninguno
  // bueno ese día — así nunca se le oculta a la clienta un hueco que
  // realmente es el único disponible.
  const goodSlots = [];
  const fallbackSlots = [];
  for (const slotStartMs of Array.from(candidateMs).sort((a, b) => a - b)) {
    const slotEndMs = slotStartMs + durationMinutes * 60000;
    if (slotEndMs > dayEndMs) continue;

    const isFree = !busyRanges.some((r) => overlaps(slotStartMs, slotEndMs, r.start, r.end));
    const isFuture = slotStartMs >= now;
    if (isFree && isFuture) {
      // Extraemos "HH:mm" en la zona horaria del centro para mostrarlo
      const label = new Intl.DateTimeFormat('es-ES', {
        timeZone: hours.timezone, hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(new Date(slotStartMs));

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
  }
  // Antes, si ya había algún hueco "bueno" ese día, los que dejaban un
  // tramo muerto se ocultaban del todo — pero eso escondía disponibilidad
  // real (p.ej. huecos por la tarde antes de otra cita), y una clienta con
  // esa hora en mente simplemente no la veía nunca. Ahora se muestran
  // siempre TODOS los huecos libres, con los "buenos" primero.
  return [...goodSlots, ...fallbackSlots].sort();
}

/**
 * Comprueba si un rango exacto de tiempo está libre para una empleada —
 * usado para ampliar una cita ya confirmada con un tratamiento añadido
 * justo a continuación (no busca huecos, valida uno concreto).
 */
async function isRangeFree(dateStr, calendarId, startISO, endISO, weeklySchedule, opts) {
  const ignoreClosingTime = !!(opts && opts.ignoreClosingTime);
  if (isClosureDate(dateStr)) return false;
  const weekday = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
  const daySchedule = (weeklySchedule || hours.weekly)[weekday];
  if (!daySchedule || daySchedule.closed) return false;

  const dayEndISO = localToISO(dateStr, ignoreClosingTime ? '23:00' : daySchedule.close, hours.timezone);
  if (new Date(endISO).getTime() > new Date(dayEndISO).getTime()) return false; // se saldría del horario

  const busy = await getBusyIntervals(calendarId, startISO, endISO);
  const startMs = new Date(startISO).getTime();
  const endMs = new Date(endISO).getTime();
  return !busy.some((b) => overlaps(startMs, endMs, new Date(b.start).getTime(), new Date(b.end).getTime()));
}

module.exports = { getAvailableSlots, isRangeFree, MIN_LEAD_MINUTES };
