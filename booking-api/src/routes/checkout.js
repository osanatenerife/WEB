const express = require('express');
const services = require('../config/services');
const employees = require('../config/employees');
const { getAvailableSlots } = require('../lib/availability');
const { localToISO, addMinutes } = require('../lib/timezone');
const { parseExtraIds, resolveExtras, resolveExtraServices, totalDuration, totalPrice } = require('../lib/pricing');
const hours = require('../config/hours');
const { createBookingEvent, deleteEvent } = require('../lib/googleCalendar');
const { createCheckoutSession } = require('../lib/stripeClient');
const { resolveOrigin } = require('../lib/origin');
const { getAllDiscounts } = require('../lib/sheets');
const { isDiscountLive, findDiscountByCode, computeDiscountAmount } = require('../lib/discounts');
const crypto = require('crypto');

const router = express.Router();

// Recalcula el descuento SIEMPRE en el servidor (nunca se confía en un
// importe que venga del navegador) — a partir del código y de los
// tratamientos realmente seleccionados (precios resueltos aquí mismo).
async function resolveDiscount(code, priceableItems) {
  if (!code) return null;
  const discounts = await getAllDiscounts();
  const discount = findDiscountByCode(discounts, code);
  if (!discount || !isDiscountLive(discount)) return null;
  const amount = computeDiscountAmount(discount, priceableItems);
  if (!amount) return null;
  return { code: discount.code, amount };
}

// Endpoint público para que el paso de reserva compruebe un código de
// descuento (y muestre cuánto se ahorra) antes de llegar al pago — el
// checkout vuelve a revalidarlo igualmente, este endpoint es solo para
// que la clienta vea el importe al momento.
router.post('/discount-check', async (req, res) => {
  const { code, serviceIds } = req.body || {};
  const ids = Array.isArray(serviceIds) ? serviceIds.filter(Boolean) : [];
  if (!code || !ids.length) {
    return res.status(400).json({ error: 'Indica el código y los tratamientos seleccionados.' });
  }
  try {
    const priceableItems = ids.map((id) => services.find((s) => s.id === id)).filter(Boolean);
    const discount = await resolveDiscount(code, priceableItems);
    if (!discount) {
      return res.status(404).json({ error: 'Ese código no es válido, ha caducado o no aplica a los tratamientos elegidos.' });
    }
    res.json({ valid: true, amountOff: discount.amount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudo comprobar el código.' });
  }
});

function computeAmount(service, price, paymentChoice) {
  const { paymentPolicy, depositPercent } = service;
  if (paymentPolicy === 'full_required') return { amount: price, type: 'total' };
  if (paymentPolicy === 'deposit_required') return { amount: round2((price * depositPercent) / 100), type: 'pagar reserva' };
  // deposit_or_full: el cliente elige
  if (paymentChoice === 'full') return { amount: price, type: 'total' };
  return { amount: round2((price * (depositPercent || 30)) / 100), type: 'pagar reserva' };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

router.post('/checkout', async (req, res) => {
  const { serviceId, employeeId, date, time, clientName, clientPhone, clientEmail, clientBirthdate, paymentChoice, extraIds, extraServiceIds, discountCode, lang } = req.body || {};
  const reservaPath = lang === 'en' ? '/en/reserva.html' : '/reserva.html';

  if (!serviceId || !employeeId || !date || !time || !clientName || !clientPhone || !clientEmail) {
    return res.status(400).json({ error: 'Faltan datos obligatorios de la reserva.' });
  }

  const service = services.find((s) => s.id === serviceId);
  const employee = employees.find((e) => e.id === employeeId);
  if (!service) return res.status(404).json({ error: 'Servicio no encontrado' });
  if (!employee) return res.status(404).json({ error: 'Empleada no encontrada' });

  const selectedExtras = resolveExtras(parseExtraIds(extraIds));
  const additionalServices = resolveExtraServices(parseExtraIds(extraServiceIds));
  const duration = totalDuration(service, selectedExtras, additionalServices);
  const priceBeforeDiscount = totalPrice(service, selectedExtras, additionalServices);
  const bookingId = crypto.randomUUID();

  let eventId = null;
  try {
    // El descuento se vuelve a comprobar en el servidor a partir del código,
    // nunca del importe que mande el navegador — evita que se manipule el precio.
    const discount = await resolveDiscount(discountCode, [service, ...additionalServices]);
    const price = round2(priceBeforeDiscount - (discount ? discount.amount : 0));

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
      discount ? `Código de descuento: ${discount.code} (-${discount.amount.toFixed(2)} €)` : null,
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
    const origin = resolveOrigin(req);
    const session = await createCheckoutSession({
      amountEuros: amount,
      description: lang === 'en' ? `${customerServiceName} — Osana booking/payment` : `${summaryTitle} — reserva/pago Osana`,
      successUrl: `${origin}${reservaPath}?estado=ok`,
      cancelUrl: `${origin}${reservaPath}?estado=cancelado`,
      allowKlarna: type === 'total',
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
        discountCode: discount ? discount.code : '',
        discountAmount: discount ? String(discount.amount) : '',
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
