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
    1: { open: '10:00', close: '20:00' },              // lunes
    2: { open: '10:00', close: '20:00' },              // martes
    3: { open: '10:00', close: '20:00' },              // miércoles
    4: { open: '10:00', close: '20:00' },              // jueves
    5: { open: '10:00', close: '20:00' },              // viernes
    6: { open: '10:00', close: '14:00' },              // sábado
  },
  // Cuántos días hacia adelante se pueden reservar desde hoy
  bookingWindowDays: 45,
};
