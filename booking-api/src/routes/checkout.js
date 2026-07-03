const express = require('express');
const services = require('../config/services');
const employees = require('../config/employees');
const { getAvailableSlots } = require('../lib/availability');
const { localToISO, addMinutes } = require('../lib/timezone');
const hours = require('../config/hours');
const { createBookingEvent, deleteEvent } = require('../lib/googleCalendar');
const { createCheckoutSession } = require('../lib/stripeClient');

const router = express.Router();

function computeAmount(service, paymentChoice) {
  const { price, paymentPolicy, depositPercent } = service;
  if (paymentPolicy === 'full_required') return { amount: price, type: 'total' };
  if (paymentPolicy === 'deposit_required') return { amount: round2((price * depositPercent) / 100), type: 'seña' };
  // deposit_or_full: el cliente elige
  if (paymentChoice === 'full') return { amount: price, type: 'total' };
  return { amount: round2((price * (depositPercent || 20)) / 100), type: 'seña' };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

router.post('/checkout', async (req, res) => {
  const { serviceId, employeeId, date, time, clientName, clientPhone, clientEmail, paymentChoice } = req.body || {};

  if (!serviceId || !employeeId || !date || !time || !clientName || !clientPhone) {
    return res.status(400).json({ error: 'Faltan datos obligatorios de la reserva.' });
  }

  const service = services.find((s) => s.id === serviceId);
  const employee = employees.find((e) => e.id === employeeId);
  if (!service) return res.status(404).json({ error: 'Servicio no encontrado' });
  if (!employee) return res.status(404).json({ error: 'Empleada no encontrada' });

  let eventId = null;
  try {
    // 1) Revalidar que el hueco sigue libre justo antes de bloquearlo
    const freeSlots = await getAvailableSlots(date, employee.calendarId, service.durationMinutes);
    if (!freeSlots.includes(time)) {
      return res.status(409).json({ error: 'Ese hueco ya no está disponible. Elige otra hora.' });
    }

    const startISO = localToISO(date, time.length === 5 ? time : time + ':00', hours.timezone);
    const endISO = addMinutes(startISO, service.durationMinutes);

    const { amount, type } = computeAmount(service, paymentChoice);

    // 2) Bloquear el hueco de inmediato con un evento "pendiente de pago"
    //    (evita que dos personas paguen por el mismo hueco a la vez)
    const description = [
      `Cliente: ${clientName}`,
      `Teléfono: ${clientPhone}`,
      clientEmail ? `Email: ${clientEmail}` : null,
      `Servicio: ${service.name} (${service.category})`,
      `Pago online: ${amount.toFixed(2)} € (${type})`,
      amount < service.price ? `Resto a pagar en centro: ${(service.price - amount).toFixed(2)} €` : null,
      '',
      '⏳ PENDIENTE DE PAGO — se confirma automáticamente al completar el pago.',
    ].filter(Boolean).join('\n');

    const event = await createBookingEvent(employee.calendarId, {
      summary: `⏳ Pendiente de pago — ${service.name} — ${clientName}`,
      description,
      startISO,
      endISO,
      clientEmail,
      clientName,
    });
    eventId = event.id;

    // 3) Crear la sesión de pago de Stripe
    const origin = req.headers.origin || process.env.FRONTEND_URL;
    const session = await createCheckoutSession({
      amountEuros: amount,
      description: `${service.name} — seña/pago Osana`,
      successUrl: `${origin}/reserva.html?estado=ok`,
      cancelUrl: `${origin}/reserva.html?estado=cancelado`,
      metadata: {
        calendarId: employee.calendarId,
        eventId,
        serviceId,
        employeeId,
        date,
        time,
        clientName,
        amount: String(amount),
        paymentType: type,
      },
    });

    // Damos solo 30 minutos para pagar; si expira, se libera el hueco (ver webhook.js)
    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    // Si algo falla después de crear el evento tentativo, lo borramos para no dejar huecos bloqueados sin motivo
    if (eventId) {
      try { await deleteEvent(employee.calendarId, eventId); } catch (_) {}
    }
    res.status(500).json({ error: err.message || 'No se pudo iniciar el pago. Inténtalo de nuevo.' });
  }
});

module.exports = router;
