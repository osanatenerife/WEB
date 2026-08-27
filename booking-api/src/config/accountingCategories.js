// ============================================================
// CATEGORÍAS CONTABLES (para el informe trimestral y el sistema de
// saldo de fidelización) — distintas de las categorías que se ven en
// la web. Cada serviceId de services.js cae en una de estas 4:
// 'laser' · 'corporal' · 'facial' · 'cejas'
// ============================================================

const CEJAS = ['hilo-labio', 'hilo-menton', 'hilo-cejas', 'hilo-facial'];

const LASER = [
  'laser-labio', 'laser-menton', 'laser-linea-alba', 'laser-ingles', 'laser-axilas',
  'laser-facial', 'laser-intimo-completo', 'laser-medios-brazos', 'laser-gluteos',
  'laser-medias-piernas', 'laser-brazos', 'laser-pecho-abdomen', 'laser-espalda',
  'laser-piernas-completas', 'laser-cuerpo-completo',
  'radiofrecuencia-facial', 'hollywood-peel', 'fotorejuvenecimiento-ipl',
  'tatuaje-talla-s', 'tatuaje-talla-m', 'tatuaje-talla-l', 'tatuaje-talla-xl',
  'eliminacion-micropigmentacion',
];

const CORPORAL = [
  'presoterapia', 'radiofrecuencia-corporal', 'maderoterapia',
  'drenaje-linfatico-50', 'drenaje-linfatico-manuela-shala',
  'kobido-facial', 'lifting-facial',
  'masaje-relajante-60', 'masaje-aromaterapia-60', 'masaje-personalizado-60',
  'reflexologia-podal-60', 'reflexologia-podal-50',
];

const FACIAL = [
  'lifting-pestanas-tradicional', 'laminado-cejas', 'lifting-pestanas-coreano',
  'brows-basic', 'brows-glam', 'brows-signature',
  'diagnostico-facial-ia', 'limpieza-profunda', 'peeling-quimico', 'dermapen',
  'mesoterapia-virtual', 'exosomas-dermapen',
  'ritual-basic-skin', 'ritual-relaxing', 'ritual-flash-lifting',
  'programa-periocular', 'programa-glow-skin', 'programa-anti-aging', 'programa-control-acne',
  'valoracion-micropigmentacion', 'retoque-micropigmentacion', 'micropigmentacion-cejas-retoque',
];

const CATEGORY_BY_SERVICE = {};
CEJAS.forEach((id) => { CATEGORY_BY_SERVICE[id] = 'cejas'; });
LASER.forEach((id) => { CATEGORY_BY_SERVICE[id] = 'laser'; });
CORPORAL.forEach((id) => { CATEGORY_BY_SERVICE[id] = 'corporal'; });
FACIAL.forEach((id) => { CATEGORY_BY_SERVICE[id] = 'facial'; });

function accountingCategoryFor(serviceId) {
  return CATEGORY_BY_SERVICE[serviceId] || 'facial'; // por defecto, si se añade un servicio nuevo sin clasificar
}

module.exports = { accountingCategoryFor, CATEGORY_BY_SERVICE };
