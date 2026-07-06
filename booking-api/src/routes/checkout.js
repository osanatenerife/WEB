const express = require('express');
const services = require('../config/services');
const employees = require('../config/employees');
const { getAvailableSlots } = require('../lib/availability');
const { localToISO, addMinutes } = require('../lib/timezone');
const { parseExtraIds, resolveExtras, resolveExtraServices, totalDuration, totalPrice } = require('../lib/pricing');
const hours = require('../config/hours');
const { createBookingEvent, deleteEvent } = require('../lib/googleCalendar');
const { createCheckoutSession } = require('../lib/stripeClient');
const crypto = require('crypto');

const router = express.Router();

function computeAmount(service, price, paymentChoice) {
  const { paymentPolicy, depositPercent } = service;
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
  const { serviceId, employeeId, date, time, clientName, clientPhone, clientEmail, clientBirthdate, paymentChoice, extraIds, extraServiceIds, lang } = req.body || {};
  const reservaPath = lang === 'en' ? '/en/reserva.html' : '/reserva.html';

  if (!serviceId || !employeeId || !date || !time || !clientName || !clientPhone) {
    return res.status(400).json({ error: 'Faltan datos obligatorios de la reserva.' });
  }

  const service = services.find((s) => s.id === serviceId);
  const employee = employees.find((e) => e.id === employeeId);
  if (!service) return res.status(404).json({ error: 'Servicio no encontrado' });
  if (!employee) return res.status(404).json({ error: 'Empleada no encontrada' });

  const selectedExtras = resolveExtras(parseExtraIds(extraIds));
  const additionalServices = resolveExtraServices(parseExtraIds(extraServiceIds));
  const duration = totalDuration(service, selectedExtras, additionalServices);
  const price = totalPrice(service, selectedExtras, additionalServices);
  const bookingId = crypto.randomUUID();

  let eventId = null;
  try {
    // 1) Revalidar que el hueco sigue libre justo antes de bloquearlo
    const freeSlots = await getAvailableSlots(date, employee.calendarId, duration, employee.weekly);
    if (!freeSlots.includes(time)) {
      return res.status(409).json({ error: 'Ese hueco ya no está disponible. Elige otra hora.' });
    }

    const startISO = localToISO(date, time.length === 5 ? time : time + ':00', hours.timezone);
    const endISO = addMinutes(startISO, duration);

    const { amount, type } = computeAmount(service, price, paymentChoice);

    // 2) Bloquear el hueco de inmediato con un evento "pendiente de pago"
    //    (evita que dos personas paguen por el mismo hueco a la vez)
    const description = [
      `Cliente: ${clientName}`,
      `Teléfono: ${clientPhone}`,
      clientEmail ? `Email: ${clientEmail}` : null,
      `Servicio: ${service.name} (${service.category})`,
      additionalServices.length ? `Tratamientos añadidos: ${additionalServices.map((s) => s.name).join(', ')}` : null,
      selectedExtras.length ? `Extras: ${selectedExtras.map((e) => e.name).join(', ')}` : null,
      `Pago online: ${amount.toFixed(2)} € (${type})`,
      amount < price ? `Resto a pagar en centro: ${(price - amount).toFixed(2)} €` : null,
      '',
      '⏳ PENDIENTE DE PAGO — se confirma automáticamente al completar el pago.',
    ].filter(Boolean).join('\n');

    // El evento de calendario es de uso interno del centro: siempre en español, independientemente del idioma del cliente
    const allNames = [service.name, ...additionalServices.map((s) => s.name)];
    const summaryTitle = allNames.join(' + ') + (selectedExtras.length ? ` + ${selectedExtras.length} extra(s)` : '');
    // Lo que ve el cliente en Stripe sí respeta su idioma
    const customerAllNames = [service.nameEn || service.name, ...additionalServices.map((s) => s.nameEn || s.name)];
    const customerServiceName = lang === 'en' ? customerAllNames.join(' + ') : allNames.join(' + ');
    const event = await createBookingEvent(employee.calendarId, {
      summary: `⏳ Pendiente de pago — ${summaryTitle} — ${clientName}`,
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
      description: lang === 'en' ? `${customerServiceName} — Osana deposit/payment` : `${summaryTitle} — seña/pago Osana`,
      successUrl: `${origin}${reservaPath}?estado=ok`,
      cancelUrl: `${origin}${reservaPath}?estado=cancelado`,
      metadata: {
        bookingId,
        calendarId: employee.calendarId,
        eventId,
        serviceId,
        employeeId,
        extraIds: selectedExtras.map((e) => e.id).join(','),
        extraServiceIds: additionalServices.map((s) => s.id).join(','),
        date,
        time,
        durationMinutes: String(duration),
        clientName,
        clientPhone,
        clientEmail: clientEmail || '',
        clientBirthdate: clientBirthdate || '',
        price: String(price),
        amount: String(amount),
        paymentType: type,
        lang: lang === 'en' ? 'en' : 'es',
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
    // Detalle técnico añadido temporalmente al mensaje (código de red subyacente,
    // p.ej. ETIMEDOUT/ENOTFOUND/ECONNRESET) para poder diagnosticar el fallo de
    // conexión con Stripe sin depender de mirar los logs de Render a mano.
    const detail = err.detail && err.detail.code ? ` [${err.detail.code}]` : (err.code ? ` [${err.code}]` : '');
    res.status(500).json({ error: (err.message || 'No se pudo iniciar el pago. Inténtalo de nuevo.') + detail });
  }
});

module.exports = router;
