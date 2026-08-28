const express = require('express');
const services = require('../config/services');
const employees = require('../config/employees');
const extras = require('../config/extras');
const hours = require('../config/hours');
const { parseExtraIds: parseIds } = require('../lib/pricing');

const router = express.Router();

// Lista pública de servicios agrupados por categoría
// ?lang=en / ?lang=it devuelve nombre y categoría en ese idioma (con fallback al español si faltara)
router.get('/services', (req, res) => {
  const { lang } = req.query;
  let list = services;
  if (lang === 'en') {
    list = services.map((s) => ({ ...s, name: s.nameEn || s.name, category: s.categoryEn || s.category, description: s.descriptionEn || s.description }));
  } else if (lang === 'it') {
    list = services.map((s) => ({ ...s, name: s.nameIt || s.name, category: s.categoryIt || s.category, description: s.descriptionIt || s.description }));
  }
  res.json({ services: list });
});

function canDo(employee, serviceId) {
  if (employee.excludedServices && employee.excludedServices.includes(serviceId)) return false;
  return employee.services.length === 0 || employee.services.includes(serviceId);
}

// Lista de empleadas que pueden realizar TODOS los servicios dados
// (si la cita combina varios tratamientos, la profesional tiene que poder con todos)
router.get('/employees', (req, res) => {
  const ids = parseIds(req.query.serviceIds || req.query.serviceId);
  let list = employees;
  if (ids.length) {
    list = employees.filter((e) => ids.every((id) => canDo(e, id)));
  }
  // No exponemos el calendarId al frontend, no hace falta y es un dato interno.
  // "weekly" sí se expone: el calendario de reserva lo usa para marcar sus días libres.
  // "closures" son los cierres puntuales del centro (vacaciones, reformas...), iguales
  // para todas las empleadas, para que el calendario también los tache visualmente.
  res.json({ employees: list.map(({ id, name, weekly }) => ({ id, name, weekly, closures: hours.closures || [] })) });
});

// Lista de extras que se pueden añadir a los servicios dados (unión, sin duplicados)
router.get('/extras', (req, res) => {
  const { lang } = req.query;
  const ids = parseIds(req.query.serviceIds || req.query.serviceId);
  let list = extras;
  if (ids.length) {
    list = list.filter((e) => e.applicableServices.length === 0 || ids.some((id) => e.applicableServices.includes(id)));
  }
  if (lang === 'en') {
    list = list.map((e) => ({ ...e, name: e.nameEn || e.name }));
  } else if (lang === 'it') {
    list = list.map((e) => ({ ...e, name: e.nameIt || e.name }));
  }
  res.json({ extras: list });
});

module.exports = router;
module.exports.canDo = canDo;
