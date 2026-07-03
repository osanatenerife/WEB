// Ayudante mínimo de zona horaria sin dependencias externas.
// Suficiente para husos horarios "enteros" como Canarias (no tiene
// medias horas de desfase).

function getOffsetString(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
    hour: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT';
  const match = tzPart.match(/GMT([+-]\d+)?/);
  const offsetHours = match && match[1] ? parseInt(match[1], 10) : 0;
  const sign = offsetHours >= 0 ? '+' : '-';
  const abs = String(Math.abs(offsetHours)).padStart(2, '0');
  return `${sign}${abs}:00`;
}

/**
 * Combina una fecha "YYYY-MM-DD" y una hora "HH:mm" (hora local del
 * centro) en un instante RFC3339 con el offset correcto para timeZone.
 */
function localToISO(dateStr, timeStr, timeZone) {
  // Usamos mediodía UTC de ese mismo día solo para *detectar* el offset
  // (evita problemas si el cambio de horario cae justo esa noche).
  const probe = new Date(`${dateStr}T12:00:00Z`);
  const offset = getOffsetString(probe, timeZone);
  return `${dateStr}T${timeStr}:00${offset}`;
}

function addMinutes(isoString, minutes) {
  const d = new Date(isoString);
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return d.toISOString();
}

module.exports = { getOffsetString, localToISO, addMinutes };
