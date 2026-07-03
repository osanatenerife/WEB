// ============================================================
// CATÁLOGO DE SERVICIOS RESERVABLES
// ------------------------------------------------------------
// Nombres, categorías y precios sacados de servicios.html.
// Duraciones: la mayoría vienen directas de lo que indicaste; las
// marcadas [ESTIMADO] son una suposición razonable mía porque no se
// dio un dato exacto — confírmalas o cámbialas cuando puedas, no
// hace falta tocar nada más.
//
// Nota: por ahora cada tratamiento es una sesión suelta (el precio
// "1 sesión" de la tabla). Los precios de bono/3 sesiones de
// servicios.html no están aquí — si quieres vender bonos desde la
// reserva online, dímelo y lo añadimos como algo aparte.
//
// paymentPolicy:
//   "deposit_required"  -> hay que pagar el % de seña sí o sí para reservar
//   "full_required"     -> hay que pagar el 100% online para reservar
//   "deposit_or_full"    -> el cliente elige: paga solo la seña o el total
//
// depositPercent: porcentaje de seña (solo se usa si aplica según paymentPolicy)
// ============================================================

module.exports = [
  // ── 01 · DEPILACIÓN LÁSER SHR ──
  // Duración por tamaño de zona: pequeña 20 min / media 30 min / cuerpo completo 60 min.
  // He repartido cada zona de la tabla real por tamaño aproximado — revisa el reparto.
  { id: 'laser-labio', category: 'Depilación Láser SHR', name: 'Labio', durationMinutes: 20, price: 20, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'laser-menton', category: 'Depilación Láser SHR', name: 'Mentón', durationMinutes: 20, price: 20, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'laser-linea-alba', category: 'Depilación Láser SHR', name: 'Línea alba', durationMinutes: 20, price: 20, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'laser-ingles', category: 'Depilación Láser SHR', name: 'Ingles', durationMinutes: 20, price: 35, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'laser-axilas', category: 'Depilación Láser SHR', name: 'Axilas', durationMinutes: 20, price: 35, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'laser-facial', category: 'Depilación Láser SHR', name: 'Facial', durationMinutes: 30, price: 50, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'laser-intimo-completo', category: 'Depilación Láser SHR', name: 'Íntimo completo', durationMinutes: 30, price: 50, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'laser-medios-brazos', category: 'Depilación Láser SHR', name: 'Medios brazos', durationMinutes: 30, price: 60, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'laser-gluteos', category: 'Depilación Láser SHR', name: 'Glúteos', durationMinutes: 30, price: 60, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'laser-medias-piernas', category: 'Depilación Láser SHR', name: 'Medias piernas', durationMinutes: 30, price: 60, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'laser-brazos', category: 'Depilación Láser SHR', name: 'Brazos', durationMinutes: 30, price: 75, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'laser-pecho-abdomen', category: 'Depilación Láser SHR', name: 'Pecho y abdomen', durationMinutes: 30, price: 75, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'laser-espalda', category: 'Depilación Láser SHR', name: 'Espalda', durationMinutes: 30, price: 75, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'laser-piernas-completas', category: 'Depilación Láser SHR', name: 'Piernas completas', durationMinutes: 30, price: 75, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'laser-cuerpo-completo', category: 'Depilación Láser SHR', name: 'Cuerpo completo', durationMinutes: 60, price: 210, paymentPolicy: 'deposit_required', depositPercent: 20 },

  // ── 02 · HILO & LIFTING ──
  { id: 'hilo-labio', category: 'Hilo & Lifting', name: 'Labio (hilo)', durationMinutes: 10, price: 4, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'hilo-menton', category: 'Hilo & Lifting', name: 'Mentón (hilo)', durationMinutes: 10, price: 4, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'hilo-cejas', category: 'Hilo & Lifting', name: 'Cejas (hilo)', durationMinutes: 20, price: 10, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'hilo-facial', category: 'Hilo & Lifting', name: 'Facial (hilo)', durationMinutes: 30, price: 25, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'lifting-pestanas-tradicional', category: 'Hilo & Lifting', name: 'Lifting de pestañas tradicional', durationMinutes: 45, price: 35, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'laminado-cejas', category: 'Hilo & Lifting', name: 'Laminado de cejas', durationMinutes: 45, price: 35, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'lifting-pestanas-coreano', category: 'Hilo & Lifting', name: 'Lifting de pestañas coreano', durationMinutes: 45, price: 40, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'brows-basic', category: 'Hilo & Lifting', name: 'Brows Basic (hilo cejas + lifting coreano)', durationMinutes: 60, price: 45, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'brows-glam', category: 'Hilo & Lifting', name: 'Brows Glam (hilo cejas + henna + lifting coreano)', durationMinutes: 60, price: 60, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'brows-signature', category: 'Hilo & Lifting', name: 'Brows Signature (hilo + lifting trad. + laminado + tinte)', durationMinutes: 60, price: 75, paymentPolicy: 'deposit_required', depositPercent: 20 },

  // ── 03 · FACIALES & APARATOLOGÍA ── (todos 60 min, según indicaste)
  { id: 'diagnostico-facial-ia', category: 'Faciales & Aparatología', name: 'Diagnóstico facial con IA', durationMinutes: 60, price: 25, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'radiofrecuencia-facial', category: 'Faciales & Aparatología', name: 'Radiofrecuencia facial', durationMinutes: 60, price: 60, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'limpieza-profunda', category: 'Faciales & Aparatología', name: 'Limpieza facial profunda', durationMinutes: 60, price: 65, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'peeling-quimico', category: 'Faciales & Aparatología', name: 'Peeling químico personalizado', durationMinutes: 60, price: 65, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'hollywood-peel', category: 'Faciales & Aparatología', name: 'Hollywood Peel', durationMinutes: 60, price: 70, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'dermapen', category: 'Faciales & Aparatología', name: 'Dermapen', durationMinutes: 60, price: 75, paymentPolicy: 'deposit_required', depositPercent: 20 },
  { id: 'mesoterapia-virtual', category: 'Faciales & Aparatología', name: 'Mesoterapia virtual', durationMinutes: 60, price: 85, paymentPolicy: 'deposit_required', depositPercent: 20 },
  { id: 'fotorejuvenecimiento-ipl', category: 'Faciales & Aparatología', name: 'Fotorejuvenecimiento (IPL)', durationMinutes: 60, price: 100, paymentPolicy: 'deposit_required', depositPercent: 20 },
  { id: 'exosomas-dermapen', category: 'Faciales & Aparatología', name: 'Exosomas con dermapen avanzado', durationMinutes: 60, price: 120, paymentPolicy: 'deposit_required', depositPercent: 20 },
  { id: 'ritual-basic-skin', category: 'Faciales & Aparatología', name: 'Ritual Basic Skin (limpieza + dermaplaning)', durationMinutes: 90, price: 75, paymentPolicy: 'deposit_required', depositPercent: 20 },
  { id: 'ritual-relaxing', category: 'Faciales & Aparatología', name: 'Ritual Relaxing (dermaplaning + hidratación + masaje)', durationMinutes: 90, price: 80, paymentPolicy: 'deposit_required', depositPercent: 20 },
  { id: 'ritual-flash-lifting', category: 'Faciales & Aparatología', name: 'Ritual Flash Lifting (limpieza + radiofrecuencia + maderoterapia)', durationMinutes: 100, price: 110, paymentPolicy: 'deposit_required', depositPercent: 20 },

  // ── 04 · PROGRAMAS FACIALES ── (todos 1h40 min, según indicaste)
  { id: 'programa-periocular', category: 'Programas Faciales', name: 'Programa Periocular', durationMinutes: 100, price: 210, paymentPolicy: 'deposit_required', depositPercent: 20 },
  { id: 'programa-glow-skin', category: 'Programas Faciales', name: 'Programa Glow Skin', durationMinutes: 100, price: 285, paymentPolicy: 'deposit_required', depositPercent: 20 },
  { id: 'programa-anti-aging', category: 'Programas Faciales', name: 'Programa Anti-Aging', durationMinutes: 100, price: 360, paymentPolicy: 'deposit_required', depositPercent: 20 },
  { id: 'programa-control-acne', category: 'Programas Faciales', name: 'Programa Control Acné', durationMinutes: 100, price: 380, paymentPolicy: 'deposit_required', depositPercent: 20 },
  // "Programa Melasma Slow" y "Programa Melasma Intensive" son precio "a consultar" en la
  // web — no están aquí porque el sistema necesita un precio fijo para cobrar online.
  // Si me das un precio (aunque sea orientativo) los añado igual que los demás.

  // ── 05 · CORPORALES ──
  { id: 'presoterapia', category: 'Corporales', name: 'Presoterapia', durationMinutes: 30, price: 25, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'radiofrecuencia-corporal', category: 'Corporales', name: 'Radiofrecuencia corporal', durationMinutes: 45, price: 60, paymentPolicy: 'deposit_or_full', depositPercent: 20 }, // [ESTIMADO] duración
  { id: 'maderoterapia', category: 'Corporales', name: 'Maderoterapia · 55 min', durationMinutes: 55, price: 90, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'fotorejuvenecimiento-corporal', category: 'Corporales', name: 'Fotorejuvenecimiento corporal', durationMinutes: 45, price: 150, paymentPolicy: 'deposit_required', depositPercent: 20 }, // [ESTIMADO] duración

  // ── 06 · MASAJES & RITUALES ESSENTIA ── (duración incluida en el propio nombre)
  { id: 'masaje-relajante-30', category: 'Masajes & Rituales Essentia', name: 'Masaje relajante Essentia · 30 min', durationMinutes: 30, price: 70, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'masaje-antiestres-50', category: 'Masajes & Rituales Essentia', name: 'Masaje antiestrés Essentia · 50 min', durationMinutes: 50, price: 80, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'masaje-terapeutico-45', category: 'Masajes & Rituales Essentia', name: 'Masaje terapéutico Essentia · 45 min', durationMinutes: 45, price: 85, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'recuperador-piernas-45', category: 'Masajes & Rituales Essentia', name: 'Recuperador de piernas Essentia · 45 min', durationMinutes: 45, price: 90, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'drenaje-linfatico-50', category: 'Masajes & Rituales Essentia', name: 'Drenaje linfático avanzado Essentia · 50 min', durationMinutes: 50, price: 100, paymentPolicy: 'deposit_required', depositPercent: 20 },
  { id: 'masaje-prenatal-50', category: 'Masajes & Rituales Essentia', name: 'Masaje prenatal Essentia · 50 min', durationMinutes: 50, price: 110, paymentPolicy: 'deposit_required', depositPercent: 20 },
  { id: 'ritual-reparador-solar-70', category: 'Masajes & Rituales Essentia', name: 'Ritual reparador solar · 70 min', durationMinutes: 70, price: 120, paymentPolicy: 'deposit_required', depositPercent: 20 },
  { id: 'masaje-tejido-profundo-60', category: 'Masajes & Rituales Essentia', name: 'Masaje tejido profundo Essentia · 60 min', durationMinutes: 60, price: 130, paymentPolicy: 'deposit_required', depositPercent: 20 },
  { id: 'ritual-essentia-80', category: 'Masajes & Rituales Essentia', name: 'Ritual Essentia · 80 min', durationMinutes: 80, price: 160, paymentPolicy: 'deposit_required', depositPercent: 20 },

  // ── 07 · ELIMINACIÓN DE TATUAJES ──
  // Mapeé tus tamaños (xs/s/m/grande) a los de la tabla real (S/M/L/XL) de menor a mayor.
  { id: 'tatuaje-talla-s', category: 'Eliminación de tatuajes', name: 'Talla S · hasta 4×4 cm', durationMinutes: 10, price: 45, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'eliminacion-micropigmentacion', category: 'Eliminación de tatuajes', name: 'Eliminación micropigmentación', durationMinutes: 20, price: 70, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'tatuaje-talla-m', category: 'Eliminación de tatuajes', name: 'Talla M · hasta 8×8 cm', durationMinutes: 20, price: 80, paymentPolicy: 'deposit_or_full', depositPercent: 20 },
  { id: 'tatuaje-talla-l', category: 'Eliminación de tatuajes', name: 'Talla L · hasta 15×15 cm', durationMinutes: 30, price: 120, paymentPolicy: 'deposit_required', depositPercent: 20 },
  { id: 'tatuaje-talla-xl', category: 'Eliminación de tatuajes', name: 'Talla XL · más de 15×15 cm', durationMinutes: 60, price: 170, paymentPolicy: 'deposit_required', depositPercent: 20 },

  // ── 08 · MICROPIGMENTACIÓN ──
  { id: 'valoracion-micropigmentacion', category: 'Micropigmentación', name: 'Valoración de micropigmentación', durationMinutes: 30, price: 0, paymentPolicy: 'deposit_or_full', depositPercent: 0 },
  { id: 'retoque-micropigmentacion', category: 'Micropigmentación', name: 'Retoque micropigmentación anual', durationMinutes: 120, price: 100, paymentPolicy: 'deposit_required', depositPercent: 20 },
  { id: 'micropigmentacion-cejas-retoque', category: 'Micropigmentación', name: 'Micropigmentación cejas + retoque', durationMinutes: 210, price: 260, paymentPolicy: 'deposit_required', depositPercent: 20 },
];
