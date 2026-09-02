// Enlace "Añadir a Google Calendar" para los emails de confirmación y
// reprogramación — no hace falta ninguna cuenta de Google Calendar del
// centro ni ningún archivo .ics: es solo una URL con los datos de la cita
// ya rellenos, que Google Calendar abre en su propio formulario de "nuevo
// evento" (funciona igual para cualquiera con cuenta de Google).
const { localToISO, addMinutes } = require('./timezone');
const hours = require('../config/hours');

const SALON_ADDRESS = 'Calle Manuel Bello Ramos, 56, 38670 Adeje, Santa Cruz de Tenerife';

function toGCalUTC(iso) {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function googleCalendarLink({ title, dateStr, timeStr, durationMinutes, details }) {
  if (!dateStr || !timeStr) return '';
  const timeNorm = timeStr.length === 5 ? timeStr : timeStr.slice(0, 5);
  const startISO = localToISO(dateStr, timeNorm, hours.timezone);
  const endISO = addMinutes(startISO, Math.max(5, Number(durationMinutes) || 60));
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title || 'Cita Osana',
    dates: `${toGCalUTC(startISO)}/${toGCalUTC(endISO)}`,
    details: details || '',
    location: SALON_ADDRESS,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

module.exports = { googleCalendarLink };
