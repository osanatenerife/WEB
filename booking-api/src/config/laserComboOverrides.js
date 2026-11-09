// ============================================================
// DURACIONES CONOCIDAS DE COMBOS DE LÁSER
// ------------------------------------------------------------
// La fórmula genérica (suma del tiempo real de cabina de cada zona + 10
// min de margen, ver LASER_OVERHEAD_MINUTES en lib/pricing.js) se queda
// corta cuando se combinan 2-3 zonas grandes — en la práctica hay más
// ahorro de tiempo del que calcula una suma simple (máquina ya puesta,
// menos cambios de postura...). Para esos casos confirmados con la dueña,
// se usa la duración exacta de aquí en vez de la fórmula.
//
// Cada entrada: "ids" son los ids de servicios de services.js que forman
// el combo (cualquier orden, se compara como conjunto — no hace falta que
// coincida con cómo se añaden en el carrito) y "minutes" la duración total
// real confirmada (ya incluye el margen de cambio/cobro).
//
// Si una combinación de zonas de láser no está aquí, se sigue calculando
// con la fórmula genérica — según se vayan confirmando más combinaciones
// reales, añádelas aquí.
// ============================================================

module.exports = [
  { ids: ['laser-labio', 'laser-menton'], minutes: 20 },
  { ids: ['laser-axilas', 'laser-ingles'], minutes: 35 },
  { ids: ['laser-axilas', 'laser-intimo-completo', 'laser-medios-brazos'], minutes: 60 },
  { ids: ['laser-piernas-completas', 'laser-axilas', 'laser-ingles'], minutes: 60 },
  { ids: ['laser-espalda', 'laser-pecho-abdomen'], minutes: 45 },
  { ids: ['laser-gluteos', 'laser-medias-piernas'], minutes: 45 },
  { ids: ['laser-facial', 'laser-labio', 'laser-menton', 'laser-linea-alba'], minutes: 40 },
  { ids: ['laser-brazos', 'laser-axilas', 'laser-intimo-completo'], minutes: 50 },
  { ids: ['laser-piernas-completas', 'laser-gluteos'], minutes: 50 },
];
