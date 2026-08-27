// ============================================================
// EMPLEADAS Y SUS CALENDARIOS DE GOOGLE
// ------------------------------------------------------------
// calendarId: normalmente es el email de Google de la empleada
// (el mismo con el que ha compartido su calendario con la cuenta
// de servicio — ver booking-api/SETUP.md, paso 3).
//
// services: lista de "id" de services.js que esa empleada puede
// realizar. Dejar vacío el array [] significa "todos los servicios"
// (salvo lo que se quite explícitamente en excludedServices).
//
// excludedServices: lista de "id" que esa empleada NO hace, aunque
// "services" esté vacío. Útil para el caso normal de "hace de todo
// excepto un par de especialidades concretas".
//
// weekly: horario semanal PERSONAL de esa empleada (mismo formato que
// hours.js: 0 = domingo ... 6 = sábado, { closed: true } o { open, close }).
// Sustituye al horario general del centro para calcular sus huecos libres.
// ============================================================

const services = require('./services');

// Solo Anna hace estos tratamientos (kobido/lifting facial y maderoterapia)
const especialidadesAnna = ['kobido-facial', 'lifting-facial', 'maderoterapia'];

// Ya no se trabaja con Essentia (antes lo llevaba Yuli) — todo lo que cae en
// "Masajes" en la web, más el drenaje linfático de "Corporales", pasa a ser
// especialidad exclusiva de Anna.
const masajesYCorporalesAnna = services
  .filter((s) => s.category === 'Masajes')
  .map((s) => s.id)
  .filter((id) => !especialidadesAnna.includes(id))
  .concat(['drenaje-linfatico-50', 'drenaje-linfatico-manuela-shala']);

const CLOSED = { closed: true };

module.exports = [
  {
    id: 'raquel',
    name: 'Raquel',
    calendarId: 'osanatenerife@gmail.com',
    services: [], // todos
    excludedServices: [...masajesYCorporalesAnna, ...especialidadesAnna],
    weekly: {
      0: CLOSED, // domingo
      1: CLOSED, // lunes
      2: { open: '10:00', close: '18:00' }, // martes
      3: { open: '10:00', close: '18:00' }, // miércoles
      4: { open: '10:00', close: '18:00' }, // jueves
      5: { open: '10:00', close: '18:00' }, // viernes
      6: { open: '10:00', close: '18:00' }, // sábado
    },
  },
  {
    id: 'vanessa',
    name: 'Vanessa',
    calendarId: 'vanessacentroosana@gmail.com',
    services: [], // todos
    excludedServices: [...masajesYCorporalesAnna, ...especialidadesAnna],
    weekly: {
      0: CLOSED, // domingo
      1: CLOSED, // lunes
      2: CLOSED, // martes
      3: { open: '14:00', close: '18:00' }, // miércoles
      4: { open: '11:00', close: '18:00' }, // jueves
      5: { open: '11:00', close: '18:00' }, // viernes
      6: { open: '11:00', close: '18:00' }, // sábado
    },
  },
  {
    id: 'anna',
    name: 'Anna',
    calendarId: 'annacentroosana@gmail.com',
    // Todos los masajes y corporales (antes repartidos entre Anna y Yuli,
    // ahora exclusivos de Anna) + faciales/aparatología que también hace,
    // pero que no son exclusivas suyas (Raquel/Vanessa también las hacen).
    services: [
      ...especialidadesAnna,
      ...masajesYCorporalesAnna,
      'radiofrecuencia-facial', 'radiofrecuencia-corporal', 'limpieza-profunda',
      'hollywood-peel', 'dermapen', 'exosomas-dermapen', 'limpieza-facial-premium',
      'ritual-basic-skin', 'ritual-relaxing', 'ritual-flash-lifting',
    ],
    weekly: {
      0: CLOSED, 1: CLOSED, 2: { open: '10:00', close: '18:00' }, 3: CLOSED, 4: CLOSED, 5: CLOSED, 6: { open: '10:00', close: '18:00' }, // martes y sábado
    },
  },
];
