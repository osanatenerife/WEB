// ============================================================
// BONOS DE SESIONES (paquetes de 3 sesiones con precio reducido)
// ------------------------------------------------------------
// Cada entrada referencia un "serviceId" ya existente en services.js
// y añade el nº de sesiones del paquete y el precio total del bono
// (sacado de la columna "3 Sesiones" de servicios.html).
//
// La 1ª sesión se agenda y se paga como parte de la compra del bono.
// La 2ª, 3ª... se agendan desde el panel interno, descontando del
// contador de sesiones restantes del bono (no vuelven a cobrarse).
// ============================================================

module.exports = [
  // ── Depilación Láser SHR ──
  { serviceId: 'laser-labio', sessions: 3, price: 45 },
  { serviceId: 'laser-menton', sessions: 3, price: 45 },
  { serviceId: 'laser-linea-alba', sessions: 3, price: 45 },
  { serviceId: 'laser-ingles', sessions: 3, price: 90 },
  { serviceId: 'laser-axilas', sessions: 3, price: 90 },
  { serviceId: 'laser-facial', sessions: 3, price: 120 },
  { serviceId: 'laser-intimo-completo', sessions: 3, price: 120 },
  { serviceId: 'laser-medios-brazos', sessions: 3, price: 155 },
  { serviceId: 'laser-gluteos', sessions: 3, price: 155 },
  { serviceId: 'laser-medias-piernas', sessions: 3, price: 155 },
  { serviceId: 'laser-brazos', sessions: 3, price: 185 },
  { serviceId: 'laser-pecho-abdomen', sessions: 3, price: 185 },
  { serviceId: 'laser-espalda', sessions: 3, price: 185 },
  { serviceId: 'laser-piernas-completas', sessions: 3, price: 185 },
  { serviceId: 'laser-cuerpo-completo', sessions: 3, price: 460 },

  // ── Corporales ──
  { serviceId: 'presoterapia', sessions: 3, price: 75 },
  { serviceId: 'radiofrecuencia-corporal', sessions: 3, price: 185 },
  { serviceId: 'maderoterapia', sessions: 5, price: 360 },
  { serviceId: 'maderoterapia', sessions: 8, price: 499 },
  { serviceId: 'fotorejuvenecimiento-corporal', sessions: 3, price: 320 },

  // ── Masajes & Rituales Essentia ──
  { serviceId: 'drenaje-linfatico-50', sessions: 5, price: 450 },
  { serviceId: 'drenaje-linfatico-50', sessions: 10, price: 800 },

  // ── Eliminación de tatuajes ──
  { serviceId: 'tatuaje-talla-s', sessions: 3, price: 120 },
  { serviceId: 'eliminacion-micropigmentacion', sessions: 3, price: 180 },
  { serviceId: 'tatuaje-talla-m', sessions: 3, price: 200 },
  { serviceId: 'tatuaje-talla-l', sessions: 3, price: 310 },
  { serviceId: 'tatuaje-talla-xl', sessions: 3, price: 400 },
];
