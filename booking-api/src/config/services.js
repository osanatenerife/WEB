// ============================================================
// CATÁLOGO DE SERVICIOS RESERVABLES
// ------------------------------------------------------------
// Esto es un PUNTO DE PARTIDA con una selección representativa
// de tratamientos de servicios.html. Edita libremente: añade,
// quita o cambia precio/duración — no hace falta tocar más código.
//
// paymentPolicy:
//   "deposit_required"  -> hay que pagar el % de seña sí o sí para reservar
//   "full_required"     -> hay que pagar el 100% online para reservar
//   "deposit_or_full"    -> el cliente elige: paga solo la seña o el total
//
// depositPercent: porcentaje de seña (solo se usa si aplica según paymentPolicy)
// ============================================================

module.exports = [
  // ── DEPILACIÓN LÁSER SHR ──
  { id: 'laser-ingles-axilas', category: 'Depilación Láser SHR', name: 'Ingles o axilas', durationMinutes: 20, price: 35, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'laser-piernas-completas', category: 'Depilación Láser SHR', name: 'Piernas completas', durationMinutes: 45, price: 75, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'laser-cuerpo-completo', category: 'Depilación Láser SHR', name: 'Cuerpo completo', durationMinutes: 90, price: 210, paymentPolicy: 'deposit_required', depositPercent: 20 },

  // ── HILO & LIFTING ──
  { id: 'hilo-cejas', category: 'Hilo & Lifting', name: 'Depilación de cejas con hilo', durationMinutes: 15, price: 10, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'lifting-pestanas-coreano', category: 'Hilo & Lifting', name: 'Lifting de pestañas coreano', durationMinutes: 45, price: 40, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'laminado-cejas', category: 'Hilo & Lifting', name: 'Laminado de cejas', durationMinutes: 30, price: 35, paymentPolicy: 'deposit_or_full', depositPercent: 20 },

  // ── FACIALES & APARATOLOGÍA ──
  { id: 'limpieza-profunda', category: 'Faciales & Aparatología', name: 'Limpieza facial profunda', durationMinutes: 60, price: 65, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'hollywood-peel', category: 'Faciales & Aparatología', name: 'Hollywood Peel', durationMinutes: 45, price: 70, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'dermapen', category: 'Faciales & Aparatología', name: 'Dermapen', durationMinutes: 60, price: 75, paymentPolicy: 'deposit_required', depositPercent: 20 },

  // ── CORPORALES ──
  { id: 'presoterapia', category: 'Corporales', name: 'Presoterapia', durationMinutes: 30, price: 25, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'maderoterapia', category: 'Corporales', name: 'Maderoterapia · 55 min', durationMinutes: 55, price: 90, paymentPolicy: 'deposit_or_full', depositPercent: 20 },

  // ── MASAJES & RITUALES ESSENTIA ──
  { id: 'masaje-relajante-30', category: 'Masajes & Rituales Essentia', name: 'Masaje relajante Essentia · 30 min', durationMinutes: 30, price: 70, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'masaje-antiestres-50', category: 'Masajes & Rituales Essentia', name: 'Masaje antiestrés Essentia · 50 min', durationMinutes: 50, price: 80, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'ritual-essentia-80', category: 'Masajes & Rituales Essentia', name: 'Ritual Essentia · 80 min', durationMinutes: 80, price: 160, paymentPolicy: 'deposit_required', depositPercent: 20 },

  // ── MICROPIGMENTACIÓN ──
  { id: 'valoracion-micropigmentacion', category: 'Micropigmentación', name: 'Valoración de micropigmentación', durationMinutes: 30, price: 0, paymentPolicy: 'deposit_or_full', depositPercent: 0 },

  // ── ELIMINACIÓN DE TATUAJES ──
  { id: 'tatuaje-talla-s', category: 'Eliminación de tatuajes', name: 'Sesión talla S (hasta 4×4 cm)', durationMinutes: 20, price: 45, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
];
