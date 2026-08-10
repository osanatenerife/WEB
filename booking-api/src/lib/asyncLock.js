// Google Sheets no ofrece transacciones ni bloqueos — dos peticiones casi
// simultáneas sobre el MISMO recurso (doble clic en "Cerrar cita", dos
// pestañas del panel, una clienta cancelando justo cuando el equipo edita
// esa misma cita) pueden leer el mismo estado "antes" y que una escritura
// se pise con la otra. Como esta app corre en una sola instancia, un mutex
// en memoria por clave (bookingId, bonoId, teléfono...) es suficiente para
// serializar esas peticiones y evitar la condición de carrera, sin la
// complejidad de un bloqueo distribuido que aquí no hace falta.
const locks = new Map();

async function withLock(key, fn) {
  const previous = locks.get(key) || Promise.resolve();
  let release;
  const next = new Promise((resolve) => { release = resolve; });
  locks.set(key, previous.then(() => next));
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

module.exports = { withLock };
