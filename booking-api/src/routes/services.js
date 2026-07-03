const express = require('express');
const services = require('../config/services');
const employees = require('../config/employees');

const router = express.Router();

// Lista pública de servicios agrupados por categoría
router.get('/services', (req, res) => {
  res.json({ services });
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

module.exports = router;
