const express = require('express');
const services = require('../config/services');
const employees = require('../config/employees');
const hours = require('../config/hours');
const { findBookingById } = require('../lib/sheets');
const { updateEvent } = require('../lib/googleCalendar');
const { isRangeFree } = require('../lib/availability');
const { localToISO, addMinutes } = require('../lib/timezone');
const { createCheckoutSession } = require('../lib/stripeClient');
const { resolveOrigin } = require('../lib/origin');
const { normalizePhone, normalizeEmail } = require('../lib/clientId');

const router = express.Router();

function round2(n) {
  return Math.round(n * 100) / 100;
}

function isOwner(booking, phone, email) {
  return normalizePhone(booking.phone) === normalizePhone(phone)
    && normalizeEmail(booking.email) === normalizeEmail(email);
}

function canDo(employee, serviceId) {
  if (employee.excludedServices && employee.excludedServices.includes(serviceId)) return false;
  return employee.services.length === 0 || employee.services.includes(serviceId);
}

function computeAmount(service, paymentChoice) {
  const { paymentPolicy, depositPercent, price } = service;
  if (paymentPolicy === 'full_required') return { amount: price, type: 'total' };
  if (paymentPolicy === 'deposit_required') return { amount: round2((price * depositPercent) / 100), type: 'pagar reserva' };
  if (paymentChoice === 'full') return { amount: price, type: 'total' };
  return { amount: round2((price * (depositPercent || 30)) / 100), type: 'pagar reserva' };
}

// Añadir un tratamiento a una cita YA confirmada (antes de que llegue el
// día), justo a continuación del tratamiento original, con la misma
// empleada. No soporta bonos de sesiones — solo tratamientos sueltos, que
// es el caso real que se pidió ("se me antoja añadir cejas a mi limpieza
// facial"); un bono añadido a una cita existente complicaría demasiado el
// registro de sesiones para el beneficio real que aporta.
router.post('/my-bookings/add-treatment', async (req, res) => {
  const { bookingId, phone, email, serviceId, paymentChoice, lang } = req.body || {};
  if (!bookingId || !phone || !email || !serviceId) {
    return res.status(400).json({ error: 'Faltan datos para añadir el tratamiento.' });
  }
  const reservaPath = lang === 'en' ? '/en/mis-reservas.html' : '/mis-reservas.html';

  try {
    const booking = await findBookingById(bookingId);
    if (!booking || !isOwner(booking, phone, email)) {
      return res.status(404).json({ error: 'No se ha encontrado esa reserva con esos datos.' });
    }
    if (booking.status !== 'confirmed') {
      return res.status(409).json({ error: 'Esta reserva ya no está activa.' });
    }
    if (booking.bonoId) {
      return res.status(409).json({ error: 'No se puede añadir un tratamiento a una sesión de un bono. Escríbenos y lo vemos a mano.' });
    }

    const service = services.find((s) => s.id === serviceId);
    if (!service) return res.status(404).json({ error: 'Tratamiento no encontrado.' });

    const employee = employees.find((e) => e.id === booking.employeeId);
    if (!employee) return res.status(404).json({ error: 'Empleada no encontrada.' });
    if (!canDo(employee, serviceId)) {
      return res.status(409).json({ error: 'Tu profesional asignada no realiza ese tratamiento. Escríbenos y lo vemos a mano.' });
    }

    const time = booking.time.length === 5 ? booking.time : `${booking.time}:00`;
    const startISO = localToISO(booking.date, time, hours.timezone);
    const currentDuration = Number(booking.durationMinutes) || 60;
    const currentEndISO = addMinutes(startISO, currentDuration);
    const hrsUntil = (new Date(startISO).getTime() - Date.now()) / 3600000;
    if (hrsUntil < 0) {
      return res.status(409).json({ error: 'Esta cita ya ha pasado.' });
    }

    const newEndISO = addMinutes(currentEndISO, service.durationMinutes);
    const free = await isRangeFree(booking.date, booking.calendarId, currentEndISO, newEndISO, employee.weekly);
    if (!free) {
      return res.status(409).json({ error: 'No hay hueco libre justo después de tu cita para añadir este tratamiento. Escríbenos y lo vemos a mano.' });
    }

    // Bloqueamos el hueco extra de inmediato (igual que al hacer una reserva
    // nueva), para que nadie más pueda ocuparlo mientras se completa el pago.
    // Si el pago expira sin completarse, el webhook revierte el final del
    // evento a currentEndISO (ver checkout.session.expired en webhook.js).
    await updateEvent(booking.calendarId, booking.eventId, { end: { dateTime: newEndISO } });

    const { amount, type } = computeAmount(service, paymentChoice);
    const origin = resolveOrigin(req);
    const session = await createCheckoutSession({
      amountEuros: amount,
      description: lang === 'en'
        ? `${service.nameEn || service.name} — added to your Osana booking`
        : `${service.name} — añadido a tu reserva Osana`,
      successUrl: `${origin}${reservaPath}?estado=ok`,
      cancelUrl: `${origin}${reservaPath}?estado=cancelado`,
      allowKlarna: type === 'total',
      metadata: {
        type: 'addon_treatment',
        bookingId,
        calendarId: booking.calendarId,
        eventId: booking.eventId,
        serviceId,
        addedDuration: String(service.durationMinutes),
        addedPrice: String(service.price),
        originalEndISO: currentEndISO,
        amount: String(amount),
        paymentType: type,
        lang: lang === 'en' ? 'en' : 'es',
      },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudo añadir el tratamiento.' });
  }
});

module.exports = router;
