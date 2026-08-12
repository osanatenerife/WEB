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
  { id: 'laser-labio', category: 'Depilación Láser SHR', categoryEn: 'SHR Laser Hair Removal', name: 'Labio', nameEn: 'Lip', durationMinutes: 20, price: 20, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'laser-menton', category: 'Depilación Láser SHR', categoryEn: 'SHR Laser Hair Removal', name: 'Mentón', nameEn: 'Chin', durationMinutes: 20, price: 20, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'laser-linea-alba', category: 'Depilación Láser SHR', categoryEn: 'SHR Laser Hair Removal', name: 'Línea alba', nameEn: 'Linea alba', durationMinutes: 20, price: 20, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'laser-ingles', category: 'Depilación Láser SHR', categoryEn: 'SHR Laser Hair Removal', name: 'Ingles', nameEn: 'Groin', durationMinutes: 20, price: 35, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'laser-axilas', category: 'Depilación Láser SHR', categoryEn: 'SHR Laser Hair Removal', name: 'Axilas', nameEn: 'Underarms', durationMinutes: 20, price: 35, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'laser-facial', category: 'Depilación Láser SHR', categoryEn: 'SHR Laser Hair Removal', name: 'Facial', nameEn: 'Face', durationMinutes: 30, price: 50, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'laser-intimo-completo', category: 'Depilación Láser SHR', categoryEn: 'SHR Laser Hair Removal', name: 'Íntimo completo', nameEn: 'Full intimate', durationMinutes: 30, price: 50, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'laser-medios-brazos', category: 'Depilación Láser SHR', categoryEn: 'SHR Laser Hair Removal', name: 'Medios brazos', nameEn: 'Half arms', durationMinutes: 30, price: 60, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'laser-gluteos', category: 'Depilación Láser SHR', categoryEn: 'SHR Laser Hair Removal', name: 'Glúteos', nameEn: 'Glutes', durationMinutes: 30, price: 60, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'laser-medias-piernas', category: 'Depilación Láser SHR', categoryEn: 'SHR Laser Hair Removal', name: 'Medias piernas', nameEn: 'Half legs', durationMinutes: 30, price: 60, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'laser-brazos', category: 'Depilación Láser SHR', categoryEn: 'SHR Laser Hair Removal', name: 'Brazos', nameEn: 'Arms', durationMinutes: 40, price: 75, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'laser-pecho-abdomen', category: 'Depilación Láser SHR', categoryEn: 'SHR Laser Hair Removal', name: 'Pecho y abdomen', nameEn: 'Chest and abdomen', durationMinutes: 40, price: 75, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'laser-espalda', category: 'Depilación Láser SHR', categoryEn: 'SHR Laser Hair Removal', name: 'Espalda', nameEn: 'Back', durationMinutes: 40, price: 75, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'laser-piernas-completas', category: 'Depilación Láser SHR', categoryEn: 'SHR Laser Hair Removal', name: 'Piernas completas', nameEn: 'Full legs', durationMinutes: 40, price: 75, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'laser-cuerpo-completo', category: 'Depilación Láser SHR', categoryEn: 'SHR Laser Hair Removal', name: 'Cuerpo completo', nameEn: 'Full body', durationMinutes: 80, price: 210, paymentPolicy: 'deposit_or_full', depositPercent: 30 },

  // ── 02 · HILO & LIFTING ──
  { id: 'hilo-labio', category: 'Hilo & Lifting', categoryEn: 'Threading & Lifting', name: 'Labio (hilo)', nameEn: 'Lip (thread)', durationMinutes: 10, price: 5, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'hilo-menton', category: 'Hilo & Lifting', categoryEn: 'Threading & Lifting', name: 'Mentón (hilo)', nameEn: 'Chin (thread)', durationMinutes: 10, price: 5, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'hilo-cejas', category: 'Hilo & Lifting', categoryEn: 'Threading & Lifting', name: 'Cejas (hilo)', nameEn: 'Eyebrows (thread)', durationMinutes: 30, price: 15, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'henna-cejas', category: 'Hilo & Lifting', categoryEn: 'Threading & Lifting', name: 'Henna', nameEn: 'Henna', durationMinutes: 15, price: 25, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'hilo-facial', category: 'Hilo & Lifting', categoryEn: 'Threading & Lifting', name: 'Facial (hilo)', nameEn: 'Face (thread)', durationMinutes: 30, price: 30, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'lifting-pestanas-tradicional', category: 'Hilo & Lifting', categoryEn: 'Threading & Lifting', name: 'Lifting de pestañas tradicional', nameEn: 'Traditional eyelash lifting', durationMinutes: 45, price: 35, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'laminado-cejas', category: 'Hilo & Lifting', categoryEn: 'Threading & Lifting', name: 'Laminado de cejas', nameEn: 'Brow lamination', durationMinutes: 45, price: 35, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'lifting-pestanas-coreano', category: 'Hilo & Lifting', categoryEn: 'Threading & Lifting', name: 'Lifting de pestañas coreano', nameEn: 'Korean eyelash lifting', durationMinutes: 45, price: 40, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'brows-basic', category: 'Hilo & Lifting', categoryEn: 'Threading & Lifting', name: 'Cejas Básicas (hilo + lifting coreano)', nameEn: 'Brows Basic (thread eyebrows + Korean lifting)', durationMinutes: 60, price: 45, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'brows-glam', category: 'Hilo & Lifting', categoryEn: 'Threading & Lifting', name: 'Cejas Definidas (hilo + henna + lifting coreano)', nameEn: 'Brows Glam (thread eyebrows + henna + Korean lifting)', durationMinutes: 60, price: 60, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'brows-signature', category: 'Hilo & Lifting', categoryEn: 'Threading & Lifting', name: 'Cejas Impactantes (hilo + lifting trad. + laminado + tinte)', nameEn: 'Brows Signature (thread + traditional lifting + lamination + tint)', durationMinutes: 60, price: 75, paymentPolicy: 'deposit_or_full', depositPercent: 30 },

  // ── 03 · FACIALES & APARATOLOGÍA ── (todos 60 min, según indicaste)
  { id: 'diagnostico-facial-ia', category: 'Faciales & Aparatología', categoryEn: 'Facials & Devices', name: 'Diagnóstico facial con IA', nameEn: 'AI facial diagnosis', durationMinutes: 60, price: 25, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'radiofrecuencia-facial', category: 'Faciales & Aparatología', categoryEn: 'Facials & Devices', name: 'Radiofrecuencia facial', nameEn: 'Facial radiofrequency', durationMinutes: 60, price: 60, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'limpieza-profunda', category: 'Faciales & Aparatología', categoryEn: 'Facials & Devices', name: 'Limpieza facial profunda', nameEn: 'Deep facial cleansing', durationMinutes: 60, price: 65, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'peeling-quimico', category: 'Faciales & Aparatología', categoryEn: 'Facials & Devices', name: 'Peeling químico personalizado', nameEn: 'Custom chemical peel', durationMinutes: 60, price: 65, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'hollywood-peel', category: 'Faciales & Aparatología', categoryEn: 'Facials & Devices', name: 'Hollywood Peel', nameEn: 'Hollywood Peel', durationMinutes: 60, price: 70, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'dermapen', category: 'Faciales & Aparatología', categoryEn: 'Facials & Devices', name: 'Dermapen', nameEn: 'Dermapen', durationMinutes: 60, price: 75, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'mesoterapia-virtual', category: 'Faciales & Aparatología', categoryEn: 'Facials & Devices', name: 'Mesoterapia virtual', nameEn: 'Virtual mesotherapy', durationMinutes: 60, price: 85, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'fotorejuvenecimiento-ipl', category: 'Faciales & Aparatología', categoryEn: 'Facials & Devices', name: 'Fotorejuvenecimiento (IPL)', nameEn: 'Photorejuvenation (IPL)', durationMinutes: 60, price: 100, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'exosomas-dermapen', category: 'Faciales & Aparatología', categoryEn: 'Facials & Devices', name: 'Exosomas + PDRN con Dermapen PRO', nameEn: 'Exosomes + PDRN with Dermapen PRO', durationMinutes: 60, price: 140, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'ritual-basic-skin', category: 'Faciales & Aparatología', categoryEn: 'Facials & Devices', name: 'Ritual Esencial (limpieza + dermaplaning)', nameEn: 'Ritual Basic Skin (cleansing + dermaplaning)', durationMinutes: 90, price: 75, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'ritual-relaxing', category: 'Faciales & Aparatología', categoryEn: 'Facials & Devices', name: 'Ritual Hidratante Intensivo (dermaplaning + hidratación + masaje)', nameEn: 'Ritual Hidra-Relax (dermaplaning + hydration + massage)', durationMinutes: 90, price: 80, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'ritual-flash-lifting', category: 'Faciales & Aparatología', categoryEn: 'Facials & Devices', name: 'Ritual Lifting Exprés (limpieza + radiofrecuencia + maderoterapia)', nameEn: 'Ritual Flash Lifting (cleansing + radiofrequency + wood therapy)', durationMinutes: 100, price: 110, paymentPolicy: 'deposit_or_full', depositPercent: 30 },

  // ── 04 · PROGRAMAS FACIALES ── (todos 1h40 min, según indicaste)
  { id: 'programa-periocular', category: 'Programas Faciales', categoryEn: 'Facial Programs', name: 'Programa Periocular', nameEn: 'Periocular Program', durationMinutes: 100, price: 250, paymentPolicy: 'deposit_or_full', depositPercent: 30, description: 'Incluye diagnóstico facial con IA + 3 sesiones de peeling químico y exosomas para el contorno de ojos.', descriptionEn: 'Includes AI facial diagnosis + 3 chemical peel and exosome sessions for the eye contour.' },
  { id: 'programa-glow-skin', category: 'Programas Faciales', categoryEn: 'Facial Programs', name: 'Programa Piel Radiante', nameEn: 'Glow Skin Program', durationMinutes: 100, price: 310, paymentPolicy: 'deposit_or_full', depositPercent: 30, description: 'Incluye diagnóstico facial con IA + 2 Hollywood Peel + 1 IPL o peeling + 2 Dermapen con vitamina C.', descriptionEn: 'Includes AI facial diagnosis + 2 Hollywood Peel + 1 IPL or peel + 2 vitamin C Dermapen sessions.' },
  { id: 'programa-anti-aging', category: 'Programas Faciales', categoryEn: 'Facial Programs', name: 'Programa Antiedad', nameEn: 'Anti-Aging Program', durationMinutes: 100, price: 430, paymentPolicy: 'deposit_or_full', depositPercent: 30, description: 'Incluye diagnóstico facial con IA + 3 sesiones de peeling químico y exosomas con PDRN + 3 sesiones de radiofrecuencia.', descriptionEn: 'Includes AI facial diagnosis + 3 chemical peel and PDRN exosome sessions + 3 radiofrequency sessions.' },
  { id: 'programa-control-acne', category: 'Programas Faciales', categoryEn: 'Facial Programs', name: 'Programa Control Acné', nameEn: 'Acne Control Program', durationMinutes: 100, price: 460, paymentPolicy: 'deposit_or_full', depositPercent: 30, description: 'Incluye diagnóstico facial con IA + limpieza profunda + 3 Hollywood Peel + 3 peeling químico salicílico + 3 Dermapen con ácido salicílico.', descriptionEn: 'Includes AI facial diagnosis + deep cleansing + 3 Hollywood Peel + 3 salicylic chemical peel + 3 salicylic acid Dermapen sessions.' },
  // "Programa Melasma Slow" y "Programa Melasma Intensive" son precio "a consultar" en la
  // web — no están aquí porque el sistema necesita un precio fijo para cobrar online.
  // Si me das un precio (aunque sea orientativo) los añado igual que los demás.

  // ── 05 · CORPORALES ──
  { id: 'presoterapia', category: 'Corporales', categoryEn: 'Body Treatments', name: 'Presoterapia', nameEn: 'Pressotherapy', durationMinutes: 30, price: 30, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'radiofrecuencia-corporal', category: 'Corporales', categoryEn: 'Body Treatments', name: 'Radiofrecuencia corporal', nameEn: 'Body radiofrequency', durationMinutes: 60, price: 70, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'maderoterapia', category: 'Corporales', categoryEn: 'Body Treatments', name: 'Maderoterapia · 55 min', nameEn: 'Wood therapy · 55 min', durationMinutes: 55, price: 85, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'drenaje-linfatico-50', category: 'Corporales', categoryEn: 'Body Treatments', name: 'Drenaje linfático avanzado Essentia · 50 min', nameEn: 'Essentia advanced lymphatic drainage · 50 min', durationMinutes: 50, price: 100, paymentPolicy: 'deposit_or_full', depositPercent: 30 },

  // ── 06 · MASAJES & RITUALES ESSENTIA ── (duración incluida en el propio nombre)
  { id: 'masaje-antiestres-50', category: 'Masajes & Rituales Essentia', categoryEn: 'Massages & Essentia Rituals', name: 'Masaje antiestrés Essentia · 50 min', nameEn: 'Essentia anti-stress massage · 50 min', durationMinutes: 50, price: 80, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  // Tratamiento de 45 min, pero se bloquean 55 min en la agenda para dar tiempo a preparar la cabina
  { id: 'kobido-facial', category: 'Masajes & Rituales Essentia', categoryEn: 'Massages & Essentia Rituals', name: 'Kobido facial · 45 min', nameEn: 'Kobido facial massage · 45 min', durationMinutes: 55, price: 80, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'lifting-facial', category: 'Masajes & Rituales Essentia', categoryEn: 'Massages & Essentia Rituals', name: 'Lifting facial · 45 min', nameEn: 'Facial lifting massage · 45 min', durationMinutes: 55, price: 80, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'masaje-terapeutico-45', category: 'Masajes & Rituales Essentia', categoryEn: 'Massages & Essentia Rituals', name: 'Masaje terapéutico Essentia · 45 min', nameEn: 'Essentia therapeutic massage · 45 min', durationMinutes: 45, price: 85, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'masaje-deportivo-45', category: 'Masajes & Rituales Essentia', categoryEn: 'Massages & Essentia Rituals', name: 'Masaje deportivo Essentia · 45 min', nameEn: 'Essentia sports massage · 45 min', durationMinutes: 45, price: 90, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'masaje-prenatal-50', category: 'Masajes & Rituales Essentia', categoryEn: 'Massages & Essentia Rituals', name: 'Masaje prenatal Essentia · 50 min', nameEn: 'Essentia prenatal massage · 50 min', durationMinutes: 50, price: 110, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'ritual-reparador-solar-70', category: 'Masajes & Rituales Essentia', categoryEn: 'Massages & Essentia Rituals', name: 'Ritual reparador solar · 70 min', nameEn: 'Solar recovery ritual · 70 min', durationMinutes: 70, price: 120, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'ritual-essentia-80', category: 'Masajes & Rituales Essentia', categoryEn: 'Massages & Essentia Rituals', name: 'Ritual Essentia · 80 min', nameEn: 'Essentia ritual · 80 min', durationMinutes: 80, price: 160, paymentPolicy: 'deposit_or_full', depositPercent: 30 },

  // ── 07 · ELIMINACIÓN DE TATUAJES ──
  // Mapeé tus tamaños (xs/s/m/grande) a los de la tabla real (S/M/L/XL) de menor a mayor.
  { id: 'tatuaje-talla-s', category: 'Eliminación de tatuajes', categoryEn: 'Tattoo Removal', name: 'Talla S · hasta 4×4 cm', nameEn: 'Size S · up to 4×4 cm', durationMinutes: 10, price: 45, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'eliminacion-micropigmentacion', category: 'Eliminación de tatuajes', categoryEn: 'Tattoo Removal', name: 'Eliminación micropigmentación', nameEn: 'Microblading removal', durationMinutes: 20, price: 70, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'tatuaje-talla-m', category: 'Eliminación de tatuajes', categoryEn: 'Tattoo Removal', name: 'Talla M · hasta 8×8 cm', nameEn: 'Size M · up to 8×8 cm', durationMinutes: 20, price: 80, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'tatuaje-talla-l', category: 'Eliminación de tatuajes', categoryEn: 'Tattoo Removal', name: 'Talla L · hasta 15×15 cm', nameEn: 'Size L · up to 15×15 cm', durationMinutes: 30, price: 120, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'tatuaje-talla-xl', category: 'Eliminación de tatuajes', categoryEn: 'Tattoo Removal', name: 'Talla XL · más de 15×15 cm', nameEn: 'Size XL · over 15×15 cm', durationMinutes: 60, price: 170, paymentPolicy: 'deposit_or_full', depositPercent: 30 },

  // ── 08 · MICROPIGMENTACIÓN ──
  { id: 'valoracion-micropigmentacion', category: 'Micropigmentación', categoryEn: 'Microblading', name: 'Valoración de micropigmentación', nameEn: 'Microblading assessment', durationMinutes: 30, price: 0, paymentPolicy: 'deposit_or_full', depositPercent: 0 },
  { id: 'retoque-micropigmentacion', category: 'Micropigmentación', categoryEn: 'Microblading', name: 'Retoque micropigmentación anual', nameEn: 'Annual microblading touch-up', durationMinutes: 120, price: 150, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
  { id: 'micropigmentacion-cejas-retoque', category: 'Micropigmentación', categoryEn: 'Microblading', name: 'Micropigmentación cejas + retoque', nameEn: 'Eyebrow microblading + touch-up', durationMinutes: 210, price: 300, paymentPolicy: 'deposit_or_full', depositPercent: 30 },
];
