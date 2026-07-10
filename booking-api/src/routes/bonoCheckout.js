const express = require('express');
const services = require('../config/services');
const employees = require('../config/employees');
const bonos = require('../config/bonos');
const { getAvailableSlots } = require('../lib/availability');
const { localToISO, addMinutes } = require('../lib/timezone');
const hours = require('../config/hours');
const { createBookingEvent, deleteEvent } = require('../lib/googleCalendar');
const { createCheckoutSession } = require('../lib/stripeClient');
const { resolveOrigin } = require('../lib/origin');
const crypto = require('crypto');

const router = express.Router();

function round2(n) {
  return Math.round(n * 100) / 100;
}

router.post('/bono-checkout', async (req, res) => {
  const { serviceId, employeeId, date, time, clientName, clientPhone, clientEmail, clientBirthdate, paymentChoice, lang } = req.body || {};
  const reservaPath = lang === 'en' ? '/en/reserva.html' : '/reserva.html';

  if (!serviceId || !employeeId || !date || !time || !clientName || !clientPhone || !clientEmail) {
    return res.status(400).json({ error: 'Faltan datos obligatorios de la reserva.' });
  }

  const bono = bonos.find((b) => b.serviceId === serviceId);
  const service = services.find((s) => s.id === serviceId);
  const employee = employees.find((e) => e.id === employeeId);
  if (!bono || !service) return res.status(404).json({ error: 'Bono no encontrado para este tratamiento.' });
  if (!employee) return res.status(404).json({ error: 'Empleada no encontrada' });

  const bonoId = crypto.randomUUID();

  // "full": paga el bono completo online (aquí es donde tiene sentido Klarna).
  // "deposit": paga solo la seña de la 1ª sesión, resto en el centro.
  const isFull = paymentChoice === 'full';
  const amount = isFull ? bono.price : round2((bono.price * (service.depositPercent || 30)) / 100);
  const paymentType = isFull ? 'total' : 'pagar reserva';

  let eventId = null;
  try {
    const freeSlots = await getAvailableSlots(date, employee.calendarId, service.durationMinutes, employee.weekly);
    if (!freeSlots.includes(time)) {
      return res.status(409).json({ error: 'Ese hueco ya no está disponible. Elige otra hora.' });
    }

    const startISO = localToISO(date, time.length === 5 ? time : time + ':00', hours.timezone);
    const endISO = addMinutes(startISO, service.durationMinutes);

    const description = [
      `Cliente: ${clientName}`,
      `Teléfono: ${clientPhone}`,
      clientEmail ? `Email: ${clientEmail}` : null,
      `Bono: ${service.name} · ${bono.sessions} sesiones (1/${bono.sessions})`,
      `Precio total del bono: ${bono.price.toFixed(2)} €`,
      `Pago online: ${amount.toFixed(2)} € (${paymentType})`,
      amount < bono.price ? `Resto a pagar en centro: ${(bono.price - amount).toFixed(2)} €` : null,
      '',
      '⏳ PENDIENTE DE PAGO — se confirma automáticamente al completar el pago.',
    ].filter(Boolean).join('\n');

    const customerServiceName = lang === 'en' ? (service.nameEn || service.name) : service.name;
    const event = await createBookingEvent(employee.calendarId, {
      summary: `⏳ Pendiente de pago — Bono ${service.name} (1/${bono.sessions}) — ${clientName}`,
      description,
      startISO,
      endISO,
      clientEmail,
      clientName,
    });
    eventId = event.id;

    const origin = resolveOrigin(req);
    const session = await createCheckoutSession({
      amountEuros: amount,
      description: lang === 'en'
        ? `${customerServiceName} — ${bono.sessions}-session package — Osana`
        : `${service.name} — bono de ${bono.sessions} sesiones — Osana`,
      successUrl: `${origin}${reservaPath}?estado=ok`,
      cancelUrl: `${origin}${reservaPath}?estado=cancelado`,
      allowKlarna: isFull,
      metadata: {
        type: 'bono_session',
        bonoId,
        calendarId: employee.calendarId,
        eventId,
        serviceId,
        employeeId,
        sessions: String(bono.sessions),
        totalPrice: String(bono.price),
        date,
        time,
        durationMinutes: String(service.durationMinutes),
        clientName,
        clientPhone,
        clientEmail: clientEmail || '',
        clientBirthdate: clientBirthdate || '',
        amount: String(amount),
        paymentType,
        lang: lang === 'en' ? 'en' : 'es',
      },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    if (eventId) {
      try { await deleteEvent(employee.calendarId, eventId); } catch (_) {}
    }
    const detail = err.detail && err.detail.code ? ` [${err.detail.code}]` : (err.code ? ` [${err.code}]` : '');
    res.status(500).json({ error: (err.message || 'No se pudo iniciar el pago. Inténtalo de nuevo.') + detail });
  }
});

// Lista pública de bonos disponibles, con el precio "1 sesión" y el nombre
// del servicio ya resueltos, para pintar el selector en la web.
router.get('/bonos', (req, res) => {
  const lang = req.query.lang === 'en' ? 'en' : 'es';
  const list = bonos.map((b) => {
    const service = services.find((s) => s.id === b.serviceId);
    if (!service) return null;
    return {
      serviceId: b.serviceId,
      serviceName: lang === 'en' ? (service.nameEn || service.name) : service.name,
      category: lang === 'en' ? (service.categoryEn || service.category) : service.category,
      sessions: b.sessions,
      bonoPrice: b.price,
      singleSessionPrice: service.price,
    };
  }).filter(Boolean);
  res.json({ bonos: list });
});

module.exports = router;
