// ============================================================
// Resolución de "bonos" (varias sesiones compradas a la vez).
// ------------------------------------------------------------
// - Si el tratamiento tiene un bono configurado en config/bonos.js con ese
//   nº de sesiones, se usa ese precio (con su descuento de paquete).
// - Si no, cualquier tratamiento "normal" se puede comprar igualmente en
//   varias sesiones (2..MAX_MULTI_SESSIONS) a precio de sesión suelta × n:
//   se registra como un bono más, así las sesiones restantes aparecen solas
//   en "Mis reservas" para que la clienta las agende cuando quiera.
// No aplica a promociones, packs, tratamientos gratuitos (valoraciones)
// ni a tratamientos inactivos.
// ============================================================
const services = require('../config/services');
const bonos = require('../config/bonos');

const MAX_MULTI_SESSIONS = 10;
const PROMO_CATEGORY = 'Promociones';

function isMultiSessionEligible(service) {
  return !!service
    && Number(service.price) > 0
    && service.category !== PROMO_CATEGORY
    && !service.pack;
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

module.exports = { resolveBonoTier, isMultiSessionEligible, MAX_MULTI_SESSIONS };
