const express = require('express');
const services = require('../config/services');
const employees = require('../config/employees');
const bonos = require('../config/bonos');
const { resolveBonoTier, isPromo, MAX_MULTI_SESSIONS } = require('../lib/bonoTiers');
const { getAllBookings, getAllSessionBonos } = require('../lib/sheets');
const { normalizePhone } = require('../lib/clientId');
const { localToISO: toISO } = require('../lib/timezone');
const { getAvailableSlots } = require('../lib/availability');
const { localToISO, addMinutes } = require('../lib/timezone');
const hours = require('../config/hours');
const { createBookingEvent, deleteEvent } = require('../lib/googleCalendar');
const { createCheckoutSession } = require('../lib/stripeClient');
const { resolveOrigin } = require('../lib/origin');
const { resolveDiscount } = require('../lib/discounts');
const { withLock } = require('../lib/asyncLock');
const crypto = require('crypto');

const router = express.Router();

function round2(n) {
  return Math.round(n * 100) / 100;
}

router.post('/bono-checkout', async (req, res) => {
  const {
    serviceId, wantsBonoPrimary, primaryBonoSessions, extraServiceIds, extraBonoSelections,
    employeeId, date, time,
    clientName, clientPhone, clientEmail, clientBirthdate, paymentChoice, termsAccepted, lang,
    discountCode,
  } = req.body || {};
  const reservaPath = lang === 'en' ? '/en/reserva.html' : lang === 'it' ? '/it/reserva.html' : '/reserva.html';

  if (!serviceId || !employeeId || !date || !time || !clientName || !clientPhone || !clientEmail) {
    return res.status(400).json({ error: 'Faltan datos obligatorios de la reserva.' });
  }
  if (!termsAccepted) {
    return res.status(400).json({ error: 'Tienes que aceptar las condiciones de reserva para continuar.' });
  }

  const employee = employees.find((e) => e.id === employeeId);
  const primaryService = services.find((s) => s.id === serviceId);
  if (!primaryService) return res.status(404).json({ error: 'Tratamiento no encontrado.' });
  if (!employee) return res.status(404).json({ error: 'Empleada no encontrada' });

  // Cualquier combinación libre: el tratamiento principal y cada tratamiento
  // añadido puede ser sesión suelta o bono, indistintamente (p.ej. bono de
  // pierna + masaje suelto + bono de corporal, todo en la misma cita). Un
  // mismo tratamiento puede tener varios bonos disponibles (p.ej. 5 o 10
  // sesiones) — por eso se identifica cada uno por serviceId + nº de
  // sesiones, no solo por serviceId.
  const bonoSelections = [
    ...(wantsBonoPrimary ? [{ serviceId, sessions: primaryBonoSessions }] : []),
    ...(Array.isArray(extraBonoSelections) ? extraBonoSelections : []),
  ];
  const singleServiceIds = [
    ...(wantsBonoPrimary ? [] : [serviceId]),
    ...(Array.isArray(extraServiceIds) ? extraServiceIds : []),
  ];

  const bonoItems = [];
  for (const sel of bonoSelections) {
    const bono = sel ? resolveBonoTier(sel.serviceId, sel.sessions) : null;
    const service = services.find((s) => s.id === sel.serviceId);
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

  const allItems = [...bonoItems, ...singleItems];
  // Promociones que aún no han empezado (activeFrom) no se pueden comprar.
  if (allItems.some((it) => it.service.activeFrom && new Date(toISO(it.service.activeFrom, '00:00', hours.timezone)) > new Date())) {
    return res.status(404).json({ error: 'Esta promoción todavía no está activa.' });
  }

  // Tope de sesiones por compra: de una misma promoción (o de un mismo
  // tratamiento comprado en varias sesiones sin bono configurado) no se
  // pueden comprar más de MAX_MULTI_SESSIONS (3) de una vez, aunque se
  // intente repetir el tratamiento en el carrito.
  const sessionsByService = {};
  allItems.forEach((it) => {
    const n = it.bono ? Number(it.bono.sessions) : 1;
    sessionsByService[it.service.id] = (sessionsByService[it.service.id] || 0) + n;
  });
  const overCap = allItems.find((it) => (isPromo(it.service) || (it.bono && it.bono.custom))
    && sessionsByService[it.service.id] > MAX_MULTI_SESSIONS);
  if (overCap) {
    return res.status(400).json({ error: `Máximo ${MAX_MULTI_SESSIONS} sesiones de "${overCap.service.name}" por compra.` });
  }

  // Promociones con límite por clienta (promoLimitGroup, p.ej. máximo 3
  // sesiones de láser en Black Friday): cuenta lo que ya tiene reservado y
  // las sesiones pendientes de sus bonos de ese grupo, más lo de esta compra.
  const limitedGroups = [...new Set(allItems.map((it) => it.service.promoLimitGroup).filter(Boolean))];
  if (limitedGroups.length) {
    const phoneN = normalizePhone(clientPhone);
    const [allBookings, allBonos] = await Promise.all([getAllBookings(), getAllSessionBonos()]);
    for (const group of limitedGroups) {
      const inGroup = (id) => { const s = services.find((x) => x.id === id); return !!s && s.promoLimitGroup === group; };
      const limit = Math.max(...allItems.filter((it) => it.service.promoLimitGroup === group).map((it) => it.service.promoLimitCount || MAX_MULTI_SESSIONS));
      const booked = allBookings.filter((bk) => bk.status === 'confirmed' && normalizePhone(bk.phone) === phoneN && inGroup(bk.serviceId)).length;
      const pending = allBonos.filter((bo) => bo.status === 'active' && normalizePhone(bo.clientPhone) === phoneN && inGroup(bo.serviceId))
        .reduce((sum, bo) => sum + (Number(bo.sessionsRemaining) || 0), 0);
      const requested = allItems.filter((it) => it.service.promoLimitGroup === group)
        .reduce((sum, it) => sum + (it.bono ? Number(it.bono.sessions) : 1), 0);
      if (booked + pending + requested > limit) {
        const left = Math.max(0, limit - booked - pending);
        return res.status(409).json({ error: left > 0
          ? `En esta promoción el máximo es de ${limit} sesiones por clienta — solo puedes comprar ${left} más.`
          : `Ya has reservado el máximo de ${limit} sesiones de esta promoción.` });
      }
    }
  }

  // Stripe limita cada valor de metadata a 500 caracteres. Con muchos
  // tratamientos combinados el JSON de bonoItems/singleItems podría superar
  // ese límite — lo comprobamos aquí, antes de bloquear el hueco de
  // calendario, para dar un error claro en vez de que falle Stripe a mitad
  // de camino.
  const bonoItemsMetaCheck = JSON.stringify(bonoItems.map((it) => ({
    serviceId: it.service.id, bonoId: it.bonoId, sessions: it.bono.sessions, price: it.bono.price,
  })));
  const singleItemsMetaCheck = JSON.stringify(singleItems.map((it) => ({ serviceId: it.service.id, price: it.service.price })));
  if (bonoItemsMetaCheck.length > 480 || singleItemsMetaCheck.length > 480) {
    return res.status(400).json({ error: 'Demasiados tratamientos combinados en una sola reserva. Divide la compra en dos reservas separadas.' });
  }

  const totalDuration = [...bonoItems, ...singleItems].reduce((sum, it) => sum + it.service.durationMinutes, 0);

  // El descuento (si lo hay) solo se aplica a los BONOS de esta compra, no a
  // los tratamientos sueltos que se hayan añadido a la vez — para eso está
  // el código de descuento de sesiones sueltas normal. Se calcula sobre el
  // precio del PAQUETE (bono.price), no el de una sesión suelta.
  const priceableBonoItems = bonoItems.map((it) => ({ id: it.service.id, price: it.bono.price }));
  const discount = await resolveDiscount(discountCode, priceableBonoItems, 'bono');
  const discountAmount = discount ? discount.amount : 0;

  const bonoTotal = round2(round2(bonoItems.reduce((sum, it) => sum + it.bono.price, 0)) - discountAmount);
  const singleTotal = round2(singleItems.reduce((sum, it) => sum + it.service.price, 0));
  const combinedTotal = round2(bonoTotal + singleTotal);

  // "full": paga todo completo online (aquí es donde tiene sentido Klarna).
  // "deposit": paga solo la seña sobre el total combinado, resto en el centro.
  // El % de seña se calcula como el máximo entre todos los tratamientos del
  // carrito (no solo el principal) para que, si en el futuro se añade un
  // tratamiento con una seña mayor a la del principal, nunca se cobre de
  // menos online.
  const depositPercent = Math.max(
    primaryService.depositPercent || 30,
    ...[...bonoItems, ...singleItems].map((it) => it.service.depositPercent || 30)
  );
  const isFull = paymentChoice === 'full';
  const amount = isFull ? combinedTotal : round2((combinedTotal * depositPercent) / 100);
  const paymentType = isFull ? 'total' : 'pagar reserva';

  let eventId = null;
  try {
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
      discount ? `Código de descuento: ${discount.code} (-${discount.amount.toFixed(2)} €)` : null,
      `Precio total: ${combinedTotal.toFixed(2)} €`,
      `Pago online: ${amount.toFixed(2)} € (${paymentType})`,
      amount < combinedTotal ? `Resto a pagar en centro: ${(combinedTotal - amount).toFixed(2)} €` : null,
      '',
      '⏳ PENDIENTE DE PAGO — se confirma automáticamente al completar el pago.',
    ].filter(Boolean).join('\n');

    const allNames = [...bonoItems, ...singleItems].map((it) => it.service.name).join(' + ');
    const customerAllNames = [...bonoItems, ...singleItems]
      .map((it) => (lang === 'en' ? (it.service.nameEn || it.service.name) : lang === 'it' ? (it.service.nameIt || it.service.name) : it.service.name)).join(' + ');

    // Revalidar disponibilidad y crear el evento "pendiente de pago" dentro
    // del mismo bloqueo en memoria por profesional+día — evita que dos
    // personas pidiendo el mismo último hueco casi a la vez pasen las dos
    // la comprobación antes de que ninguna haya creado el evento todavía.
    eventId = await withLock(`slot:${employeeId}:${date}`, async () => {
      const freeSlots = await getAvailableSlots(date, employee.calendarId, totalDuration, employee.weekly);
      if (!freeSlots.includes(time)) return null;
      const event = await createBookingEvent(employee.calendarId, {
        summary: `⏳ Pendiente de pago — ${allNames} — ${clientName}`,
        description,
        startISO,
        endISO,
        clientEmail,
        clientName,
      });
      return event.id;
    });
    if (!eventId) {
      return res.status(409).json({ error: 'Ese hueco ya no está disponible. Elige otra hora.' });
    }

    const bonoItemsMeta = bonoItems.map((it) => ({
      serviceId: it.service.id, bonoId: it.bonoId, sessions: it.bono.sessions, price: it.bono.price,
    }));
    const singleItemsMeta = singleItems.map((it) => ({ serviceId: it.service.id, price: it.service.price }));

    const origin = resolveOrigin(req);
    const session = await createCheckoutSession({
      amountEuros: amount,
      description: (lang === 'en' || lang === 'it')
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
        discountCode: discount ? discount.code : '',
        discountAmount: discount ? String(discount.amount) : '',
        termsAcceptedAt: new Date().toISOString(),
        lang: lang === 'en' ? 'en' : lang === 'it' ? 'it' : 'es',
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
  const lang = req.query.lang === 'en' ? 'en' : req.query.lang === 'it' ? 'it' : 'es';
  const list = bonos.map((b) => {
    const service = services.find((s) => s.id === b.serviceId);
    if (!service) return null;
    return {
      serviceId: b.serviceId,
      serviceName: lang === 'en' ? (service.nameEn || service.name) : lang === 'it' ? (service.nameIt || service.name) : service.name,
      category: lang === 'en' ? (service.categoryEn || service.category) : lang === 'it' ? (service.categoryIt || service.category) : service.category,
      sessions: b.sessions,
      bonoPrice: b.price,
      singleSessionPrice: service.price,
    };
  }).filter(Boolean);
  res.json({ bonos: list, multiSessionMax: MAX_MULTI_SESSIONS });
});

module.exports = router;
