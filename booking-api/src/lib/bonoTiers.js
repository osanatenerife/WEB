// ============================================================
// Resolución de "bonos" (varias sesiones compradas a la vez).
// ------------------------------------------------------------
// - Si el tratamiento tiene un bono configurado en config/bonos.js con ese
//   nº de sesiones, se usa ese precio (con su descuento de paquete).
// - Si no, cualquier tratamiento "normal" se puede comprar igualmente en
//   varias sesiones (2..MAX_MULTI_SESSIONS, máximo 3) a precio de sesión
//   suelta × n: se registra como un bono más, así las sesiones restantes
//   aparecen solas en "Mis reservas" para que la clienta las agende.
// - Promociones: también, máximo 3 sesiones (packs de promo incluidos),
//   EXCEPTO las de presoterapia (ya traen varias sesiones dentro), y solo
//   si la promoción ya está activa (activeFrom).
// No aplica a packs normales ni a tratamientos gratuitos (valoraciones).
// ============================================================
const services = require('../config/services');
const bonos = require('../config/bonos');
const hours = require('../config/hours');
const { localToISO } = require('./timezone');

const MAX_MULTI_SESSIONS = 3;
const PROMO_CATEGORY = 'Promociones';

function isPromo(service) {
  return !!service && service.category === PROMO_CATEGORY;
}

function isActiveNow(service) {
  if (!service.activeFrom) return true;
  return new Date(localToISO(service.activeFrom, '00:00', hours.timezone)) <= new Date();
}

function isMultiSessionEligible(service) {
  if (!service || !(Number(service.price) > 0) || !isActiveNow(service)) return false;
  if (isPromo(service)) return !service.id.includes('presoterapia');
  return !service.pack;
}

function resolveBonoTier(serviceId, sessions) {
  const n = Number(sessions);
  if (!Number.isInteger(n) || n < 2) return null;
  const configured = bonos.find((b) => b.serviceId === serviceId && Number(b.sessions) === n);
  if (configured) return { ...configured, custom: false };
  const service = services.find((s) => s.id === serviceId);
  if (!isMultiSessionEligible(service) || n > MAX_MULTI_SESSIONS) return null;
  return {
    serviceId,
    sessions: n,
    price: Math.round(service.price * n * 100) / 100,
    custom: true,
  };
}

module.exports = { resolveBonoTier, isMultiSessionEligible, isPromo, MAX_MULTI_SESSIONS };
