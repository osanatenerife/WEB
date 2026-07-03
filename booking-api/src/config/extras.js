// ============================================================
// EXTRAS OPCIONALES PARA AÑADIR A UN TRATAMIENTO
// ------------------------------------------------------------
// El cliente puede marcar uno o varios extras al reservar. Se suman
// al precio y a la duración del tratamiento principal (por eso hace
// falta la duración: para reservar el hueco correcto en el calendario).
//
// applicableServices: lista de "id" de services.js a los que se les
// puede añadir este extra. Dejar vacío [] significa "cualquier tratamiento".
//
// Esto es un PUNTO DE PARTIDA de ejemplo — sustituye por los extras
// reales, sus precios y sus duraciones.
// ============================================================

module.exports = [
  { id: 'extra-ejemplo-15', name: 'Extra (ejemplo)', durationMinutes: 15, price: 10, applicableServices: [] },
];
