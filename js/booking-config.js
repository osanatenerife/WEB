// ============================================================
// Dirección del backend de reservas.
// Cuando despliegues booking-api en Render (ver booking-api/SETUP.md),
// sustituye esta URL por la que te dé Render, terminada en /api.
// Ejemplo: "https://osana-booking-api.onrender.com/api"
// ============================================================
const BOOKING_API_BASE = "https://osana-9pub.onrender.com/api";
// Idioma del flujo de reserva: 'es' por defecto, 'en/reserva.html' lo sobrescribe a 'en' antes de este script.
if (typeof window.BOOKING_LANG === 'undefined') window.BOOKING_LANG = 'es';
