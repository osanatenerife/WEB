const express = require('express');
const services = require('../config/services');
const employees = require('../config/employees');
const extras = require('../config/extras');

const router = express.Router();

// Lista pública de servicios agrupados por categoría
// ?lang=en devuelve nombre y categoría en inglés (con fallback al español si faltara)
router.get('/services', (req, res) => {
  const list = req.query.lang === 'en'
    ? services.map((s) => ({ ...s, name: s.nameEn || s.name, category: s.categoryEn || s.category }))
    : services;
  res.json({ services: list });
});

// Lista de empleadas que pueden realizar un servicio dado
router.get('/employees', (req, res) => {
  const { serviceId } = req.query;
  let list = employees;
  if (serviceId) {
    list = employees.filter((e) => e.services.length === 0 || e.services.includes(serviceId));
  }
  // No exponemos el calendarId al frontend, no hace falta y es un dato interno
  res.json({ employees: list.map(({ id, name }) => ({ id, name })) });
});

// Lista de extras que se pueden añadir a un servicio dado
router.get('/extras', (req, res) => {
  const { serviceId, lang } = req.query;
  let list = extras;
  if (serviceId) {
    list = list.filter((e) => e.applicableServices.length === 0 || e.applicableServices.includes(serviceId));
  }
  if (lang === 'en') {
    list = list.map((e) => ({ ...e, name: e.nameEn || e.name }));
  }
  res.json({ extras: list });
});

module.exports = router;
