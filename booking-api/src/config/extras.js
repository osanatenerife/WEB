// ============================================================
// EXTRAS OPCIONALES PARA AÑADIR A UN TRATAMIENTO
// ------------------------------------------------------------
// El cliente puede marcar uno o varios extras al reservar. Se suman
// al precio y a la duración del tratamiento principal (por eso hace
// falta la duración: para reservar el hueco correcto en el calendario).
//
// applicableServices: lista de "id" de services.js a los que se les
// puede añadir este extra. Dejar vacío [] significa "cualquier tratamiento".
// ============================================================

module.exports = [
  // Tinte para lifting de pestañas (tradicional o coreano): +5 € en servicios.html
  { id: 'tinte-pestanas', name: 'Tinte', nameEn: 'Tint', nameIt: 'Tinta', durationMinutes: 10, price: 5, applicableServices: ['lifting-pestanas-tradicional', 'lifting-pestanas-coreano'] },
  // Tinte para laminado de cejas: +15 € en servicios.html
  { id: 'tinte-laminado', name: 'Tinte', nameEn: 'Tint', nameIt: 'Tinta', durationMinutes: 15, price: 15, applicableServices: ['laminado-cejas'] },
];
