// Las faltas (no-shows / cambios de cita con menos de 48h) se resetean
// solas si pasan 6 meses sin ninguna nueva — así una mala racha puntual no
// persigue a la clienta para siempre, pero una repetida sigue penalizando.
const STRIKE_RESET_MONTHS = 6;

function isStrikeExpired(record) {
  if (!record || !record.lastStrikeDate) return true;
  const last = new Date(`${record.lastStrikeDate}T12:00:00`);
  if (Number.isNaN(last.getTime())) return true;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - STRIKE_RESET_MONTHS);
  return last < cutoff;
}

// Nº de faltas que cuentan ahora mismo — 0 si el registro caducó (más de
// STRIKE_RESET_MONTHS meses desde la última), aunque la fila siga en la Sheet.
function effectiveStrikeCount(record) {
  if (!record || isStrikeExpired(record)) return 0;
  return Number(record.strikeCount) || 0;
}

module.exports = { STRIKE_RESET_MONTHS, isStrikeExpired, effectiveStrikeCount };
