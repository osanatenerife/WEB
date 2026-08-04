// Normaliza teléfono/email para poder identificar a la misma clienta aunque
// escriba su teléfono con espacios, prefijo de país, mayúsculas distintas, etc.
// Compartido entre "Mis reservas" (público) y el panel interno (privado).

const { parsePhoneNumberFromString } = require('libphonenumber-js');

function normalizePhone(raw) {
  const original = String(raw || '');
  let candidate = original.trim();
  if (candidate && !candidate.startsWith('+')) {
    // Alguna gente escribe el prefijo internacional como "00" en vez de
    // "+" (p.ej. "0034623123456" o "00380501234567") — lo pasamos a "+"
    // para que se reconozca igual.
    const digitsOnly = candidate.replace(/\D/g, '');
    if (digitsOnly.startsWith('00')) candidate = `+${digitsOnly.slice(2)}`;
  }
  try {
    const parsed = parsePhoneNumberFromString(candidate, 'ES');
    if (parsed && parsed.isValid() && parsed.country && parsed.country !== 'ES') {
      // Número de fuera de España: nos quedamos con el número internacional
      // completo (con el prefijo de su país, +380, +44...) — así dos
      // clientas de países distintos que por casualidad compartan el mismo
      // número local no se confunden entre sí, y da igual si la próxima
      // vez lo escriben con espacios, guiones o sin el "+" delante,
      // siempre que el prefijo de país esté presente.
      return parsed.number; // p.ej. "+380501234567"
    }
  } catch (_) { /* número raro o incompleto: seguimos con el comportamiento de siempre */ }
  // España (o cualquier caso que no se reconozca claramente como
  // extranjero): mismo comportamiento de siempre — los últimos 9 dígitos,
  // ignorando el +34 si lo lleva. Se mantiene tal cual para no romper el
  // historial de puntos/avisos ya guardado con este formato.
  return original.replace(/\D/g, '').slice(-9);
}

function normalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

module.exports = { normalizePhone, normalizeEmail };
