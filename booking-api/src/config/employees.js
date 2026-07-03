// ============================================================
// EMPLEADAS Y SUS CALENDARIOS DE GOOGLE
// ------------------------------------------------------------
// calendarId: normalmente es el email de Google de la empleada
// (el mismo con el que ha compartido su calendario con la cuenta
// de servicio — ver booking-api/SETUP.md, paso 3).
//
// services: lista de "id" de services.js que esa empleada puede
// realizar. Dejar vacío el array [] significa "todos los servicios".
// ============================================================

module.exports = [
  {
    id: 'raquel',
    name: 'Raquel',
    calendarId: 'osanatenerife@gmail.com',
    services: [], // todos
  },
  {
    id: 'vanessa',
    name: 'Vanessa',
    calendarId: 'vanessacentroosana@gmail.com',
    services: [], // todos
  },
  {
    id: 'anna',
    name: 'Anna',
    calendarId: 'annacentroosana@gmail.com',
    services: [], // todos
  },
  {
    id: 'yuli',
    name: 'Yuli',
    calendarId: 'essentiacentroosana@gmail.com',
    services: [], // todos
  },
];
