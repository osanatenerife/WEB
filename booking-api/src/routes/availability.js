const express = require('express');
const services = require('../config/services');
const employees = require('../config/employees');
const { getAvailableSlots } = require('../lib/availability');
const { parseExtraIds, resolveExtras, resolveExtraServices, totalDuration } = require('../lib/pricing');
const hours = require('../config/hours');

const router = express.Router();

router.get('/availability', async (req, res) => {
  try {
    const { serviceId, employeeId, date, extraIds, extraServiceIds, extraMinutes } = req.query;
    if (!serviceId || !employeeId || !date) {
      return res.status(400).json({ error: 'Faltan parámetros: serviceId, employeeId, date' });
    }
    const service = services.find((s) => s.id === serviceId);
    const employee = employees.find((e) => e.id === employeeId);
    if (!service) return res.status(404).json({ error: 'Servicio no encontrado' });
    if (!employee) return res.status(404).json({ error: 'Empleada no encontrada' });

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Formato de fecha inválido, usa YYYY-MM-DD' });
    }
    const daysAhead = Math.floor((new Date(`${date}T12:00:00Z`) - new Date()) / 86400000);
    if (daysAhead < 0 || daysAhead > hours.bookingWindowDays) {
      return res.json({ slots: [] });
    }

    // extraMinutes: ajuste (en minutos) sobre la duración estándar del
    // catálogo para esta sesión en concreto — puede ser positivo (se sabe
    // que va a llevar más tiempo) o negativo (el equipo sabe que en
    // realidad da tiempo de sobra y quiere liberar ese hueco para más
    // citas). Nunca se deja bajar de un mínimo absurdo (5 min).
    const duration = Math.max(5, totalDuration(service, resolveExtras(parseExtraIds(extraIds)), resolveExtraServices(parseExtraIds(extraServiceIds)))
      + Math.round(Number(extraMinutes) || 0));
    const slots = await getAvailableSlots(date, employee.calendarId, duration, employee.weekly);
    res.json({ slots });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Error calculando disponibilidad' });
  }
});

module.exports = router;
