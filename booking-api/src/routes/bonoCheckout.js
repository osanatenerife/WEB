const express = require('express');
const services = require('../config/services');
const employees = require('../config/employees');
const bonos = require('../config/bonos');
const { resolveBonoTier, isMultiSessionEligible, isPromo, MAX_MULTI_SESSIONS } = require('../lib/bonoTiers');
const { getAllBookings, getAllSessionBonos } = require('../lib/sheets');
const { normalizePhone } = require('../lib/clientId');
const { getAvailableSlots } = require('../lib/availability');
const { localToISO, addMinutes } = require('../lib/timezone');
const { parseExtraIds, resolveExtras, durationForItems } = require('../lib/pricing');
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

// Carrito con bonos / varias sesiones / compras "para agendar después".
//
// Formato nuevo (items): cada tratamiento del carrito es
//   { serviceId, sessions, scheduleNow }
// - sessions: nº de sesiones compradas (1..3, o el de un bono configurado).
// - scheduleNow: true → su 1ª sesión entra en la cita que se reserva ahora;
//   false → se compra entero y TODAS sus sesiones quedan pendientes en
//   "Mis reservas" (así quien compra varias cosas por la promo no tiene que
//   agendarlas todas el mismo día ni encontrar un hueco para todo junto).
// Si ningún tratamiento se agenda ahora, no hace falta profesional/fecha/
// hora: es una compra pura, sin cita.
// Se sigue aceptando el formato antiguo (serviceId + wantsBonoPrimary +
// extraServiceIds + extraBonoSelections) por si alguien tiene la página
// antigua en caché.
function normalizeCartItems(body) {
  if (Array.isArray(body.items) && body.items.length) {
    return body.items.map((it) => ({
      serviceId: it && it.serviceId,
      sessions: Number(it && it.sessions) || 1,
      scheduleNow: !(it && it.scheduleNow === false),
    }));
  }
  const { serviceId, wantsBonoPrimary, primaryBonoSessions, extraServiceIds, extraBonoSelections } = body;
  return [
    { serviceId, sessions: wantsBonoPrimary ? Number(primaryBonoSessions) || 1 : 1, scheduleNow: true },
    ...(Array.isArray(extraServiceIds) ? extraServiceIds : []).map((id) => ({ serviceId: id, sessions: 1, scheduleNow: true })),
    ...(Array.isArray(extraBonoSelections) ? extraBonoSelections : []).map((sel) => ({ serviceId: sel && sel.serviceId, sessions: Number(sel && sel.sessions) || 1, scheduleNow: true })),
  ];
}

function isActiveNow(service) {
  return !service.activeFrom || new Date(localToISO(service.activeFrom, '00:00', hours.timezone)) <= new Date();
}

router.post('/bono-checkout', async (req, res) => {
  const body = req.body || {};
  const {
    employeeId, date, time, extraIds,
    clientName, clientPhone, clientEmail, clientBirthdate, paymentChoice, termsAccepted, lang,
    discountCode,
  } = body;
  const reservaPath = lang === 'en' ? '/en/reserva.html' : lang === 'it' ? '/it/reserva.html' : '/reserva.html';

  if (!clientName || !clientPhone || !clientEmail) {
    return res.status(400).json({ error: 'Faltan datos obligatorios de la reserva.' });
  }
  if (!termsAccepted) {
    return res.status(400).json({ error: 'Tienes que aceptar las condiciones de reserva para continuar.' });
  }

  const cart = normalizeCartItems(body);
  if (!cart.length || cart.some((it) => !it.serviceId)) {
    return res.status(400).json({ error: 'No hay ningún tratamiento en la reserva.' });
  }
  if (new Set(cart.map((it) => it.serviceId)).size !== cart.length) {
    return res.status(400).json({ error: 'Hay un tratamiento repetido en el carrito — cambia el nº de sesiones en vez de añadirlo dos veces.' });
  }

  // Cada línea del carrito se convierte en:
  // - un bono (2+ sesiones, o 1 sesión comprada para agendar después), que
  //   se registra en BonosSesiones con sus sesiones pendientes, o
  // - una sesión suelta normal, si es 1 sesión y se agenda ahora.
  const bonoItems = [];
  const singleItems = [];
  for (const it of cart) {
    const service = services.find((s) => s.id === it.serviceId);
    if (!service) return res.status(404).json({ error: 'Tratamiento no encontrado.' });
    if (!isActiveNow(service)) return res.status(404).json({ error: 'Esta promoción todavía no está activa.' });
    if (it.sessions === 1 && it.scheduleNow) {
      singleItems.push({ service, scheduleNow: true });
      continue;
    }
    let bono;
    if (it.sessions === 1) {
      // 1 sesión para agendar más tarde: mismo criterio que varias sesiones.
      bono = isMultiSessionEligible(service) ? { serviceId: service.id, sessions: 1, price: service.price, custom: true } : null;
      if (!bono) return res.status(400).json({ error: `"${service.name}" hay que reservarlo con fecha y hora.` });
    } else {
      bono = resolveBonoTier(service.id, it.sessions);
      if (!bono) {
        return res.status(400).json({ error: isPromo(service) || it.sessions > MAX_MULTI_SESSIONS
          ? `Máximo ${MAX_MULTI_SESSIONS} sesiones de "${service.name}" por compra.`
          : 'Bono no encontrado para uno de los tratamientos elegidos.' });
      }
    }
    bonoItems.push({ service, bono, bonoId: crypto.randomUUID(), scheduleNow: it.scheduleNow });
  }
  const allItems = [...bonoItems, ...singleItems];
  const scheduledItems = allItems.filter((it) => it.scheduleNow);
  const hasAppointment = scheduledItems.length > 0;

  const employee = hasAppointment ? employees.find((e) => e.id === employeeId) : null;
  if (hasAppointment) {
    if (!employeeId || !date || !time) return res.status(400).json({ error: 'Elige profesional, día y hora para la cita.' });
    if (!employee) return res.status(404).json({ error: 'Empleada no encontrada' });
  }

  // Extras de zona/tiempo (p.ej. tinte): solo para el tratamiento principal
  // cuando va como sesión suelta en la cita de hoy — antes se perdían (la
  // web los sumaba al precio pero aquí no se cobraban).
  const primarySingle = singleItems.find((it) => it.service.id === cart[0].serviceId);
  const selectedExtras = primarySingle
    ? resolveExtras(parseExtraIds(extraIds)).filter((ex) => !ex.applicableServices.length || ex.applicableServices.includes(primarySingle.service.id))
    : [];
  const extrasPrice = round2(selectedExtras.reduce((sum, ex) => sum + ex.price, 0));
  const extrasMinutes = selectedExtras.reduce((sum, ex) => sum + ex.durationMinutes, 0);

  // Tope de sesiones por compra para promociones / varias sesiones sin bono.
  const overCap = allItems.find((it) => (isPromo(it.service) || (it.bono && it.bono.custom))
    && (it.bono ? Number(it.bono.sessions) : 1) > MAX_MULTI_SESSIONS);
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

  // Stripe limita cada valor de metadata a 500 caracteres.
  const bonoItemsMeta = bonoItems.map((it) => ({
    serviceId: it.service.id, bonoId: it.bonoId, sessions: it.bono.sessions, price: it.bono.price,
    ...(it.scheduleNow ? {} : { later: 1 }),
  }));
  const singleItemsMeta = singleItems.map((it) => ({
    serviceId: it.service.id, price: round2(it.service.price + (it === primarySingle ? extrasPrice : 0)),
  }));
  if (JSON.stringify(bonoItemsMeta).length > 480 || JSON.stringify(singleItemsMeta).length > 480) {
    return res.status(400).json({ error: 'Demasiados tratamientos combinados en una sola reserva. Divide la compra en dos reservas separadas.' });
  }

  // Misma duración que calcula la web (ver durationForItems en lib/pricing):
  // antes aquí se sumaba sin el margen de llegada compartido y la web
  // enseñaba huecos que luego el servidor rechazaba con "Ese hueco ya no
  // está disponible". Las zonas de láser combinadas usan su tiempo real de
  // cabina en vez de la duración completa de cada una.
  const totalDuration = hasAppointment
    ? durationForItems(scheduledItems.map((it) => it.service), extrasMinutes)
    : 0;

  // El descuento (si lo hay) solo se aplica a los BONOS de esta compra.
  const priceableBonoItems = bonoItems.map((it) => ({ id: it.service.id, price: it.bono.price }));
  const discount = await resolveDiscount(discountCode, priceableBonoItems, 'bono');
  const discountAmount = discount ? discount.amount : 0;

  const bonoTotal = round2(round2(bonoItems.reduce((sum, it) => sum + it.bono.price, 0)) - discountAmount);
  const singleTotal = round2(singleItemsMeta.reduce((sum, it) => sum + it.price, 0));
  const combinedTotal = round2(bonoTotal + singleTotal);

  // "full": paga todo online (Klarna incluido). "deposit": solo la seña sobre
  // el total, resto en el centro. Seña = la mayor de todos los tratamientos.
  const depositPercent = Math.max(...allItems.map((it) => it.service.depositPercent || 30));
  const isFull = paymentChoice === 'full';
  const amount = isFull ? combinedTotal : round2((combinedTotal * depositPercent) / 100);
  const paymentType = isFull ? 'total' : 'pagar reserva';
  if (!(amount > 0)) return res.status(400).json({ error: 'No hay nada que cobrar en esta compra.' });

  const allNames = allItems.map((it) => it.service.name).join(' + ');
  const customerAllNames = allItems
    .map((it) => (lang === 'en' ? (it.service.nameEn || it.service.name) : lang === 'it' ? (it.service.nameIt || it.service.name) : it.service.name)).join(' + ');

  let eventId = null;
  try {
    if (hasAppointment) {
      const startISO = localToISO(date, time.length === 5 ? time : time + ':00', hours.timezone);
      const endISO = addMinutes(startISO, totalDuration);
      const scheduledNames = scheduledItems.map((it) => it.service.name).join(' + ');
      const description = [
        `Cliente: ${clientName}`,
        `Teléfono: ${clientPhone}`,
        clientEmail ? `Email: ${clientEmail}` : null,
        ...bonoItems.filter((it) => it.scheduleNow).map((it) => `Bono: ${it.service.name} · ${it.bono.sessions} sesiones (1/${it.bono.sessions}) — ${it.bono.price.toFixed(2)} €`),
        ...singleItems.map((it) => `Sesión suelta: ${it.service.name} — ${it.service.price.toFixed(2)} €`),
        ...selectedExtras.map((ex) => `+ ${ex.name} — ${ex.price.toFixed(2)} €`),
        ...bonoItems.filter((it) => !it.scheduleNow).map((it) => `Comprado para agendar después: ${it.service.name} · ${it.bono.sessions} ${it.bono.sessions === 1 ? 'sesión' : 'sesiones'} — ${it.bono.price.toFixed(2)} €`),
        discount ? `Código de descuento: ${discount.code} (-${discount.amount.toFixed(2)} €)` : null,
        `Precio total: ${combinedTotal.toFixed(2)} €`,
        `Pago online: ${amount.toFixed(2)} € (${paymentType})`,
        amount < combinedTotal ? `Resto a pagar en centro: ${(combinedTotal - amount).toFixed(2)} €` : null,
        '',
        '⏳ PENDIENTE DE PAGO — se confirma automáticamente al completar el pago.',
      ].filter(Boolean).join('\n');

      // Revalidar disponibilidad y crear el evento "pendiente de pago" dentro
      // del mismo bloqueo por profesional+día.
      eventId = await withLock(`slot:${employeeId}:${date}`, async () => {
        const freeSlots = await getAvailableSlots(date, employee.calendarId, totalDuration, employee.weekly);
        if (!freeSlots.includes(time)) return null;
        const event = await createBookingEvent(employee.calendarId, {
          summary: `⏳ Pendiente de pago — ${scheduledNames} — ${clientName}`,
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
    }

    const origin = resolveOrigin(req);
    const session = await createCheckoutSession({
      amountEuros: amount,
      description: (lang === 'en' || lang === 'it')
        ? `${customerAllNames} — Osana`
        : `${allNames} — Osana`,
      successUrl: `${origin}${reservaPath}?estado=${hasAppointment ? 'ok' : 'comprado'}`,
      cancelUrl: `${origin}${reservaPath}?estado=cancelado`,
      allowKlarna: isFull,
      metadata: {
        type: 'bono_session',
        bonoItems: JSON.stringify(bonoItemsMeta),
        singleItems: JSON.stringify(singleItemsMeta),
        calendarId: hasAppointment ? employee.calendarId : '',
        eventId: eventId || '',
        employeeId: hasAppointment ? employeeId : '',
        date: hasAppointment ? date : '',
        time: hasAppointment ? time : '',
        durationMinutes: String(totalDuration),
        extras: selectedExtras.map((ex) => ex.id).join(','),
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
