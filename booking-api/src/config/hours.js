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
};
