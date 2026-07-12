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
  const {
    serviceId, wantsBonoPrimary, extraServiceIds, extraBonoServiceIds, employeeId, date, time,
    clientName, clientPhone, clientEmail, clientBirthdate, paymentChoice, lang,
  } = req.body || {};
  const reservaPath = lang === 'en' ? '/en/reserva.html' : '/reserva.html';

  if (!serviceId || !employeeId || !date || !time || !clientName || !clientPhone || !clientEmail) {
    return res.status(400).json({ error: 'Faltan datos obligatorios de la reserva.' });
  }

  const employee = employees.find((e) => e.id === employeeId);
  const primaryService = services.find((s) => s.id === serviceId);
  if (!primaryService) return res.status(404).json({ error: 'Tratamiento no encontrado.' });
  if (!employee) return res.status(404).json({ error: 'Empleada no encontrada' });

  // Cualquier combinación libre: el tratamiento principal y cada tratamiento
  // añadido puede ser sesión suelta o bono, indistintamente (p.ej. bono de
  // pierna + masaje suelto + bono de corporal, todo en la misma cita).
  const bonoServiceIds = [
    ...(wantsBonoPrimary ? [serviceId] : []),
    ...(Array.isArray(extraBonoServiceIds) ? extraBonoServiceIds : []),
  ];
  const singleServiceIds = [
    ...(wantsBonoPrimary ? [] : [serviceId]),
    ...(Array.isArray(extraServiceIds) ? extraServiceIds : []),
  ];

  const bonoItems = [];
  for (const id of bonoServiceIds) {
    const bono = bonos.find((b) => b.serviceId === id);
    const service = services.find((s) => s.id === id);
    if (!bono || !service) return res.status(404).json({ error: 'Bono no encontrado para uno de los tratamientos elegidos.' });
    bonoItems.push({ service, bono, bonoId: crypto.randomUUID() });
  }
  const singleItems = [];
  for (const id of singleServiceIds) {
    const service = services.find((s) => s.id === id);
    if (!service) return res.status(404).json({ error: 'Tratamiento no encontrado.' });
    singleItems.push({ service });
  }
  if (!bonoItems.length) return res.status(400).json({ error: 'No hay ningún bono en esta reserva.' });

  const totalDuration = [...bonoItems, ...singleItems].reduce((sum, it) => sum + it.service.durationMinutes, 0);
  const bonoTotal = round2(bonoItems.reduce((sum, it) => sum + it.bono.price, 0));
  const singleTotal = round2(singleItems.reduce((sum, it) => sum + it.service.price, 0));
  const combinedTotal = round2(bonoTotal + singleTotal);

  // "full": paga todo completo online (aquí es donde tiene sentido Klarna).
  // "deposit": paga solo la seña sobre el total combinado, resto en el centro.
  const isFull = paymentChoice === 'full';
  const amount = isFull ? combinedTotal : round2((combinedTotal * (primaryService.depositPercent || 30)) / 100);
  const paymentType = isFull ? 'total' : 'pagar reserva';

  let eventId = null;
  try {
    const freeSlots = await getAvailableSlots(date, employee.calendarId, totalDuration, employee.weekly);
    if (!freeSlots.includes(time)) {
      return res.status(409).json({ error: 'Ese hueco ya no está disponible. Elige otra hora.' });
    }

    const startISO = localToISO(date, time.length === 5 ? time : time + ':00', hours.timezone);
    const endISO = addMinutes(startISO, totalDuration);

    const bonoLines = bonoItems.map((it) => `Bono: ${it.service.name} · ${it.bono.sessions} sesiones (1/${it.bono.sessions}) — ${it.bono.price.toFixed(2)} €`);
    const singleLines = singleItems.map((it) => `Sesión suelta: ${it.service.name} — ${it.service.price.toFixed(2)} €`);
    const description = [
      `Cliente: ${clientName}`,
      `Teléfono: ${clientPhone}`,
      clientEmail ? `Email: ${clientEmail}` : null,
      ...bonoLines,
      ...singleLines,
      `Precio total: ${combinedTotal.toFixed(2)} €`,
      `Pago online: ${amount.toFixed(2)} € (${paymentType})`,
      amount < combinedTotal ? `Resto a pagar en centro: ${(combinedTotal - amount).toFixed(2)} €` : null,
      '',
      '⏳ PENDIENTE DE PAGO — se confirma automáticamente al completar el pago.',
    ].filter(Boolean).join('\n');

    const allNames = [...bonoItems, ...singleItems].map((it) => it.service.name).join(' + ');
    const customerAllNames = [...bonoItems, ...singleItems]
      .map((it) => (lang === 'en' ? (it.service.nameEn || it.service.name) : it.service.name)).join(' + ');
    const event = await createBookingEvent(employee.calendarId, {
      summary: `⏳ Pendiente de pago — ${allNames} — ${clientName}`,
      description,
      startISO,
      endISO,
      clientEmail,
      clientName,
    });
    eventId = event.id;

    const bonoItemsMeta = bonoItems.map((it) => ({
      serviceId: it.service.id, bonoId: it.bonoId, sessions: it.bono.sessions, price: it.bono.price,
    }));
    const singleItemsMeta = singleItems.map((it) => ({ serviceId: it.service.id, price: it.service.price }));

    const origin = resolveOrigin(req);
    const session = await createCheckoutSession({
      amountEuros: amount,
      description: lang === 'en'
        ? `${customerAllNames} — Osana`
        : `${allNames} — Osana`,
      successUrl: `${origin}${reservaPath}?estado=ok`,
      cancelUrl: `${origin}${reservaPath}?estado=cancelado`,
      allowKlarna: isFull,
      metadata: {
        type: 'bono_session',
        bonoItems: JSON.stringify(bonoItemsMeta),
        singleItems: JSON.stringify(singleItemsMeta),
        calendarId: employee.calendarId,
        eventId,
        employeeId,
        date,
        time,
        durationMinutes: String(totalDuration),
        clientName,
        clientPhone,
        clientEmail: clientEmail || '',
        clientBirthdate: clientBirthdate || '',
        totalPrice: String(combinedTotal),
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
