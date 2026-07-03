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
    calendarId: 'CAMBIAR-POR-EMAIL-DE-RAQUEL@gmail.com',
    services: [], // todos
  },
  {
    id: 'empleada-2',
    name: 'Empleada 2 (cambiar nombre)',
    calendarId: 'CAMBIAR-POR-EMAIL-DE-EMPLEADA-2@gmail.com',
    services: [], // todos
  },
];
