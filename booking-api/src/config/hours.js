// ============================================================
// HORARIO DE APERTURA DEL CENTRO
// Formato 24h. 0 = domingo ... 6 = sábado.
// Deja un día como { closed: true } si no abrís ese día.
// ============================================================

module.exports = {
  timezone: 'Atlantic/Canary',
  slotStepMinutes: 15, // cada cuánto se ofrece un hueco de inicio
  weekly: {
    0: { closed: true },                              // domingo
    1: { closed: true },                              // lunes
    2: { open: '10:00', close: '18:00' },              // martes
    3: { open: '10:00', close: '18:00' },              // miércoles
    4: { open: '10:00', close: '18:00' },              // jueves
    5: { open: '10:00', close: '18:00' },              // viernes
    6: { open: '10:00', close: '18:00' },              // sábado
  },
  // Cuántos días hacia adelante se pueden reservar desde hoy
  bookingWindowDays: 45,

  // Cierres puntuales del centro (vacaciones, reformas...) que bloquean la
  // reserva online aunque esos días caigan dentro del horario semanal normal.
  // Formato "YYYY-MM-DD" (fechas locales del centro), ambos extremos incluidos.
  closures: [
    { start: '2026-08-01', end: '2026-08-10', reason: 'Cerrado por reforma' },
  ],
};
