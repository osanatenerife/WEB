// Normaliza teléfono/email para poder identificar a la misma clienta aunque
// escriba su teléfono con espacios, prefijo de país, mayúsculas distintas, etc.
// Compartido entre "Mis reservas" (público) y el panel interno (privado).

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.slice(-9); // compara los últimos 9 dígitos (móvil español), ignora prefijo de país
}

function normalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

module.exports = { normalizePhone, normalizeEmail };
