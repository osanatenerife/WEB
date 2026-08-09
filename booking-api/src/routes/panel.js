const express = require('express');
const {
  getAllBookings, findBookingById, updateBookingRow, appendBooking,
  getAllSessionBonos, findSessionBonoById, updateSessionBonoRow, appendSessionBono,
  getAllStrikeRecords, upsertStrikeRecord,
  appendLoyaltyMovement, appendProductSale, getAllProductSales,
  getAllLoyaltyMovements, getLoyaltyMovementsForPhone, updateLoyaltyMovementRow,
  appendCustomQuote, getAllCustomQuotes,
  appendFollowup, getAllFollowups, updateFollowupRow,
  getAllGifts, updateGiftRow,
  appendDiscount, getAllDiscounts, updateDiscountRow,
} = require('../lib/sheets');
const { isDiscountLive } = require('../lib/discounts');
const { createBookingEvent, updateEvent, getEvent, listEvents, deleteEvent } = require('../lib/googleCalendar');
const { getAvailableSlots, isRangeFree } = require('../lib/availability');
const { localToISO, addMinutes } = require('../lib/timezone');
const { sendEmail } = require('../lib/email');
const { normalizePhone, normalizeEmail } = require('../lib/clientId');
const { accountingCategoryFor } = require('../config/accountingCategories');
const { earnRateFor, computeLoyaltyBalance, MIN_REDEEM_AMOUNT } = require('../config/loyalty');
const { buildQuarterlyReportWorkbook } = require('../lib/quarterlyReport');
const { createCheckoutSession } = require('../lib/stripeClient');
const { resolveOrigin } = require('../lib/origin');
const hours = require('../config/hours');
const services = require('../config/services');
const employees = require('../config/employees');
const crypto = require('crypto');

const QUOTE_CATEGORIES = ['laser', 'corporal', 'facial', 'cejas'];

const router = express.Router();

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Registra en el libro de saldo lo ganado por una parte del importe (la
// pagada online siempre es tarjeta; la del centro depende de paidHow).
async function earnLoyalty({ booking, portionAmount, paidHow }) {
  if (!portionAmount || portionAmount <= 0) return;
  const firstServiceId = String(booking.serviceId || '').split(',')[0].trim();
  const category = accountingCategoryFor(firstServiceId);
  const rate = earnRateFor(category, paidHow);
  const amount = round2(portionAmount * rate);
  if (amount <= 0) return;
  await appendLoyaltyMovement({
    date: new Date().toISOString().slice(0, 10),
    phoneNormalized: normalizePhone(booking.phone),
    emailNormalized: normalizeEmail(booking.email),
    name: booking.name,
    type: 'earn',
    bookingId: booking.bookingId,
    serviceName: booking.serviceName,
    category,
    baseAmount: portionAmount,
    paidHow,
    rateApplied: rate,
    amount,
  });
}

// ── Todas las rutas del panel exigen la clave interna ──
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  // Buffers de distinta longitud harían fallar timingSafeEqual — comparamos
  // igualmente con la clave esperada para no filtrar la longitud tampoco.
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
router.use('/panel', (req, res, next) => {
  const expected = process.env.PANEL_SECRET;
  if (!expected) return res.status(500).json({ error: 'Falta configurar PANEL_SECRET en el servidor.' });
  const provided = req.header('x-panel-key') || '';
  if (!safeEqual(provided, expected)) {
    return res.status(401).json({ error: 'Clave incorrecta.' });
  }
  next();
});

function weeklyScheduleFor(employeeId) {
  const employee = employees.find((e) => e.id === employeeId);
  return employee && employee.weekly;
}

function appointmentDateTime(b) {
  const time = b.time.length === 5 ? b.time : `${b.time}:00`;
  return new Date(localToISO(b.date, time, hours.timezone));
}

// ── Buscar clienta por teléfono, email o nombre ──
router.get('/panel/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Escribe un teléfono, email o nombre para buscar.' });

  try {
    const [allBookings, allBonos, allStrikes, allLoyalty] = await Promise.all([
      getAllBookings(), getAllSessionBonos(), getAllStrikeRecords(), getAllLoyaltyMovements(),
    ]);

    const digits = q.replace(/\D/g, '');
    const isPhoneLike = digits.length >= 6;
    const isEmailLike = q.includes('@');

    let matches;
    if (isPhoneLike) {
      const qNorm = normalizePhone(q);
      matches = allBookings.filter((b) => normalizePhone(b.phone) === qNorm);
    } else if (isEmailLike) {
      const qNorm = normalizeEmail(q);
      matches = allBookings.filter((b) => normalizeEmail(b.email) === qNorm);
    } else {
      const qLower = q.toLowerCase();
      matches = allBookings.filter((b) => (b.name || '').toLowerCase().includes(qLower));
    }

    // Agrupamos solo por teléfono (siempre obligatorio en la reserva) — el email
    // es opcional, así que agrupar también por email fragmentaría el historial
    // de una misma clienta si una vez lo puso y otra vez no.
    const clientsMap = new Map();
    matches.forEach((b) => {
      const key = normalizePhone(b.phone);
      if (!clientsMap.has(key)) clientsMap.set(key, []);
      clientsMap.get(key).push(b);
    });

    const clients = Array.from(clientsMap.entries()).map(([phoneN, bookings]) => {
      const latest = bookings.slice().sort((a, b) => appointmentDateTime(b) - appointmentDateTime(a))[0];
      const emailN = normalizeEmail(latest.email);
      const bonos = allBonos.filter((bo) => normalizePhone(bo.clientPhone) === phoneN);
      const strike = allStrikes.find((s) => s.phoneNormalized === phoneN);
      const loyaltyMovements = allLoyalty.filter((m) => m.phoneNormalized === phoneN);
      return {
        name: latest.name,
        phone: latest.phone,
        email: latest.email,
        strikeCount: strike ? Number(strike.strikeCount) || 0 : 0,
        loyaltyBalance: computeLoyaltyBalance(loyaltyMovements),
        bonos: bonos.map((bo) => ({
          bonoId: bo.bonoId,
          serviceName: bo.serviceName,
          totalSessions: Number(bo.totalSessions) || 0,
          sessionsUsed: Number(bo.sessionsUsed) || 0,
          sessionsRemaining: Number(bo.sessionsRemaining) || 0,
          status: bo.status,
          expiryDate: bo.expiryDate,
          remainingAmount: Number(bo.remainingAmount) || 0,
          remainingPaidHow: bo.remainingPaidHow || '',
        })),
        bookings: bookings
          .sort((a, b) => appointmentDateTime(b) - appointmentDateTime(a))
          .map((b) => ({
            bookingId: b.bookingId,
            serviceName: b.serviceName,
            employeeName: b.employeeName,
            date: b.date,
            time: b.time,
            durationMinutes: Number(b.durationMinutes) || 0,
            price: Number(b.price) || 0,
            amountPaid: Number(b.amountPaid) || 0,
            finalAmount: b.finalAmount !== undefined && b.finalAmount !== '' ? Number(b.finalAmount) : null,
            remainderPaidHow: b.remainderPaidHow || '',
            remainderAmount2: b.remainderAmount2 !== undefined && b.remainderAmount2 !== '' ? Number(b.remainderAmount2) : 0,
            remainderPaidHow2: b.remainderPaidHow2 || '',
            redeemedAmount: b.redeemedAmount !== undefined && b.redeemedAmount !== '' ? Number(b.redeemedAmount) : 0,
            paymentType: b.paymentType,
            status: b.status,
            bonoId: b.bonoId || '',
            sessionNumber: b.sessionNumber || '',
            notes: b.notes || '',
            isPast: appointmentDateTime(b).getTime() <= Date.now(),
          })),
      };
    });

    res.json({ clients });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudo buscar.' });
  }
});

// ── Añadir/editar nota de una sesión ──
// Las notas también se escriben en la descripción del evento de Google
// Calendar, así se ven de un vistazo sin entrar al panel — solo las ve
// quien tenga ese calendario compartido (nunca la clienta).
const NOTE_MARKER = '\n\n📝 Notas internas (solo equipo):\n';

router.post('/panel/note', async (req, res) => {
  const { bookingId, note } = req.body || {};
  if (!bookingId) return res.status(400).json({ error: 'Falta el identificador de la cita.' });
  try {
    const booking = await findBookingById(bookingId);
    if (!booking) return res.status(404).json({ error: 'No se ha encontrado esa cita.' });
    await updateBookingRow(booking._sheetRow, booking, { notes: note || '' });

    if (booking.calendarId && booking.eventId) {
      try {
        const event = await getEvent(booking.calendarId, booking.eventId);
        const baseDescription = (event.description || '').split(NOTE_MARKER)[0];
        const newDescription = note ? `${baseDescription}${NOTE_MARKER}${note}` : baseDescription;
        await updateEvent(booking.calendarId, booking.eventId, { description: newDescription });
      } catch (calErr) {
        console.error('No se pudo actualizar la nota en Google Calendar:', calErr);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudo guardar la nota.' });
  }
});

// ── Agendar la siguiente sesión de un bono (sin cobrar, ya está pagada) ──
router.post('/panel/book-session', async (req, res) => {
  const { bonoId, employeeId, date, time } = req.body || {};
  if (!bonoId || !employeeId || !date || !time) {
    return res.status(400).json({ error: 'Faltan datos para agendar la sesión.' });
  }
  try {
    const bono = await findSessionBonoById(bonoId);
    if (!bono) return res.status(404).json({ error: 'Bono no encontrado.' });
    const remaining = Number(bono.sessionsRemaining) || 0;
    if (remaining <= 0) return res.status(409).json({ error: 'Este bono no tiene sesiones restantes.' });

    const service = services.find((s) => s.id === bono.serviceId);
    const employee = employees.find((e) => e.id === employeeId);
    if (!service) return res.status(404).json({ error: 'Tratamiento del bono no encontrado.' });
    if (!employee) return res.status(404).json({ error: 'Empleada no encontrada.' });

    const freeSlots = await getAvailableSlots(date, employee.calendarId, service.durationMinutes, employee.weekly);
    if (!freeSlots.includes(time)) {
      return res.status(409).json({ error: 'Ese hueco ya no está disponible. Elige otra hora.' });
    }

    const startISO = localToISO(date, time.length === 5 ? time : `${time}:00`, hours.timezone);
    const endISO = addMinutes(startISO, service.durationMinutes);
    const sessionNumber = (Number(bono.sessionsUsed) || 0) + 1;

    const event = await createBookingEvent(employee.calendarId, {
      summary: `✅ Bono (${sessionNumber}/${bono.totalSessions}) — ${bono.clientName}`,
      description: [
        `Cliente: ${bono.clientName}`,
        `Teléfono: ${bono.clientPhone}`,
        `Bono: ${bono.serviceName} — sesión ${sessionNumber} de ${bono.totalSessions}`,
        'Ya pagada como parte del bono.',
      ].join('\n'),
      startISO,
      endISO,
      clientEmail: bono.clientEmail,
      clientName: bono.clientName,
    });

    const bookingId = crypto.randomUUID();
    await appendBooking({
      bookingId,
      createdAt: new Date().toISOString(),
      status: 'confirmed',
      name: bono.clientName,
      phone: bono.clientPhone,
      email: bono.clientEmail,
      serviceId: bono.serviceId,
      serviceName: `${bono.serviceName} (${sessionNumber}/${bono.totalSessions})`,
      employeeId,
      employeeName: employee.name,
      calendarId: employee.calendarId,
      eventId: event.id,
      date, time,
      durationMinutes: service.durationMinutes,
      price: '',
      amountPaid: 0,
      paymentType: 'bono',
      paymentIntentId: '',
      lang: bono.lang || 'es',
      reminderSent: '',
      birthdate: '',
      bonoId,
      sessionNumber,
    });

    const sessionsRemaining = remaining - 1;
    await updateSessionBonoRow(bono._sheetRow, bono, {
      sessionsUsed: sessionNumber,
      sessionsRemaining,
      status: sessionsRemaining <= 0 ? 'completed' : 'active',
    });

    res.json({ ok: true, bookingId, sessionsRemaining });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudo agendar la sesión.' });
  }
});

// ── Dar de alta a mano una cita ya existente (reservada por teléfono/en
// persona antes de o al margen de la web) para que la clienta pueda
// gestionarla desde "Mis Reservas". El evento de calendario debe existir
// YA en el calendario de la profesional — aquí solo lo buscamos y lo
// enlazamos con una fila nueva en la Sheet, nunca creamos un evento nuevo
// (evita duplicar la cita en el calendario).
const IMPORT_MATCH_TOLERANCE_MIN = 20;

function addMonthsISO(months, fromDate) {
  const d = fromDate ? new Date(`${fromDate}T12:00:00`) : new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}
const LEGACY_BONO_VALIDITY_MONTHS = 12;

router.post('/panel/import-legacy-booking', async (req, res) => {
  const {
    name, phone, email, birthdate, serviceId, employeeId, date, time,
    price, amountPaid, notes, extraServiceIds,
    // Campos solo para sesiones de un bono ya vendido (isBono=true):
    isBono, totalSessions, sessionNumber, bonoTotalPrice, bonoAmountPaid, bonoPurchaseDate,
  } = req.body || {};
  if (!name || !phone || !email || !serviceId || !employeeId || !date || !time) {
    return res.status(400).json({ error: 'Faltan datos obligatorios (nombre, teléfono, email, tratamiento, profesional, fecha y hora).' });
  }
  if (isBono && (!totalSessions || !sessionNumber)) {
    return res.status(400).json({ error: 'Indica el número de sesión de esta cita y el total de sesiones del bono.' });
  }
  try {
    const service = services.find((s) => s.id === serviceId);
    const employee = employees.find((e) => e.id === employeeId);
    if (!service) return res.status(404).json({ error: 'Tratamiento no encontrado.' });
    if (!employee) return res.status(404).json({ error: 'Empleada no encontrada.' });

    // Otros tratamientos añadidos a la misma cita (p.ej. uno ya pagado y otro
    // pendiente) — también puede haberlos junto a una sesión de bono (el
    // bono en sí tiene su propio precio aparte, ver más abajo).
    const additionalServices = Array.isArray(extraServiceIds)
      ? extraServiceIds.map((id) => services.find((s) => s.id === id)).filter(Boolean)
      : [];
    const combinedServiceId = [serviceId, ...additionalServices.map((s) => s.id)].join(',');
    const combinedServiceName = [service.name, ...additionalServices.map((s) => s.name)].join(' + ');

    const timeNorm = time.length === 5 ? time : `${time}:00`;
    const startISO = localToISO(date, timeNorm, hours.timezone);
    const durationMinutes = service.durationMinutes + additionalServices.reduce((sum, s) => sum + s.durationMinutes, 0);

    const dayStartISO = localToISO(date, '00:00', hours.timezone);
    const dayEndISO = localToISO(date, '23:59', hours.timezone);
    const dayEvents = await listEvents(employee.calendarId, dayStartISO, dayEndISO);

    const targetMs = new Date(startISO).getTime();
    let best = null;
    let bestDiff = Infinity;
    dayEvents.forEach((ev) => {
      if (!ev.start || !ev.start.dateTime) return; // ignora eventos de día completo
      const diff = Math.abs(new Date(ev.start.dateTime).getTime() - targetMs);
      if (diff < bestDiff) { bestDiff = diff; best = ev; }
    });
    if (!best || bestDiff > IMPORT_MATCH_TOLERANCE_MIN * 60 * 1000) {
      return res.status(404).json({
        error: `No se ha encontrado ningún evento en el calendario de ${employee.name} el ${date} cerca de las ${timeNorm}. Comprueba la fecha/hora o créalo primero en el calendario de Google.`,
      });
    }

    let bonoId = '';
    let sessionNumberOut = '';
    let serviceIdOut = combinedServiceId;
    let serviceName = combinedServiceName;
    const defaultPrice = service.price + additionalServices.reduce((sum, s) => sum + s.price, 0);
    let bookingPrice = price !== undefined && price !== '' ? Number(price) : defaultPrice;
    let bookingAmountPaid = amountPaid !== undefined && amountPaid !== '' ? Number(amountPaid) : 0;
    let paymentType = '';

    if (isBono) {
      const total = Number(totalSessions);
      const current = Number(sessionNumber);
      const sessionsUsed = Math.max(0, current - 1);
      const sessionsRemaining = Math.max(0, total - sessionsUsed);
      const bonoPrice = bonoTotalPrice !== undefined && bonoTotalPrice !== '' ? Number(bonoTotalPrice) : round2(service.price * total);
      const paidOnline = bonoAmountPaid !== undefined && bonoAmountPaid !== '' ? Number(bonoAmountPaid) : bonoPrice;
      const remainingAmount = Math.max(0, round2(bonoPrice - paidOnline));

      bonoId = crypto.randomUUID();
      await appendSessionBono({
        bonoId,
        createdAt: new Date().toISOString(),
        clientName: name, clientPhone: phone, clientEmail: email,
        serviceId, serviceName: service.name,
        employeeId,
        totalSessions: total,
        sessionsUsed,
        sessionsRemaining,
        totalPrice: bonoPrice,
        amountPaidOnline: paidOnline,
        paymentType: '',
        remainingAmount,
        remainingPaidHow: '',
        status: sessionsRemaining <= 0 ? 'completed' : 'active',
        expiryDate: addMonthsISO(LEGACY_BONO_VALIDITY_MONTHS, bonoPurchaseDate || undefined),
        paymentIntentId: '',
        lang: 'es',
      });

      sessionNumberOut = current;
      // El precio del bono en sí ya queda registrado arriba (en su propia
      // fila de SessionBono) — lo que se guarda aquí, en la reserva, es
      // solo el precio de los tratamientos EXTRA añadidos a esta sesión
      // (si los hay), para no duplicar el importe del bono.
      const bonoLabel = `${service.name} (${current}/${total})`;
      serviceName = [bonoLabel, ...additionalServices.map((s) => s.name)].join(' + ');
      const extrasDefaultPrice = additionalServices.reduce((sum, s) => sum + s.price, 0);
      bookingPrice = price !== undefined && price !== '' ? Number(price) : (extrasDefaultPrice || '');
      bookingAmountPaid = amountPaid !== undefined && amountPaid !== '' ? Number(amountPaid) : 0;
      paymentType = 'bono';
    }

    const bookingId = crypto.randomUUID();
    await appendBooking({
      bookingId,
      createdAt: new Date().toISOString(),
      status: 'confirmed',
      name, phone, email,
      serviceId: serviceIdOut, serviceName,
      employeeId, employeeName: employee.name,
      calendarId: employee.calendarId,
      eventId: best.id,
      date, time: timeNorm,
      durationMinutes,
      price: bookingPrice,
      amountPaid: bookingAmountPaid,
      paymentType,
      paymentIntentId: '',
      lang: 'es',
      reminderSent: '',
      birthdate: birthdate || '',
      bonoId,
      sessionNumber: sessionNumberOut,
      notes: notes || 'Alta manual de cita ya existente.',
    });

    res.json({ ok: true, bookingId, bonoId: bonoId || undefined });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudo dar de alta la reserva.' });
  }
});

// ── Huecos libres para reprogramar una cita concreta ──
router.get('/panel/reschedule-slots', async (req, res) => {
  const { bookingId, date } = req.query;
  if (!bookingId || !date) return res.status(400).json({ error: 'Faltan datos para consultar huecos.' });
  try {
    const booking = await findBookingById(bookingId);
    if (!booking) return res.status(404).json({ error: 'No se ha encontrado esa cita.' });
    const duration = Number(booking.durationMinutes) || 60;
    const slots = await getAvailableSlots(date, booking.calendarId, duration, weeklyScheduleFor(booking.employeeId));
    res.json({ slots });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudo consultar la disponibilidad.' });
  }
});

// ── Reprogramar cualquier cita (sin límite de 48h — lo decide el equipo) ──
router.post('/panel/reschedule', async (req, res) => {
  const { bookingId, date, time } = req.body || {};
  if (!bookingId || !date || !time) return res.status(400).json({ error: 'Faltan datos para reprogramar.' });
  try {
    const booking = await findBookingById(bookingId);
    if (!booking) return res.status(404).json({ error: 'No se ha encontrado esa cita.' });

    const duration = Number(booking.durationMinutes) || 60;
    const freeSlots = await getAvailableSlots(date, booking.calendarId, duration, weeklyScheduleFor(booking.employeeId));
    if (!freeSlots.includes(time)) {
      return res.status(409).json({ error: 'Ese hueco ya no está disponible. Elige otra hora.' });
    }

    const startISO = localToISO(date, time.length === 5 ? time : `${time}:00`, hours.timezone);
    const endISO = addMinutes(startISO, duration);
    await updateEvent(booking.calendarId, booking.eventId, { start: { dateTime: startISO }, end: { dateTime: endISO } });
    await updateBookingRow(booking._sheetRow, booking, { date, time });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudo reprogramar.' });
  }
});

// ── Ampliar el tiempo bloqueado de una cita (sin cambiar fecha/hora de
// inicio) — útil cuando una clienta concreta necesita más tiempo del
// habitual y hay que reservar ese hueco extra en el calendario para que
// nadie más pueda reservarlo justo después.
router.post('/panel/extend-time', async (req, res) => {
  const { bookingId, extraMinutes } = req.body || {};
  const extra = Number(extraMinutes);
  if (!bookingId || !extra || extra <= 0) {
    return res.status(400).json({ error: 'Indica cuántos minutos extra añadir.' });
  }
  try {
    const booking = await findBookingById(bookingId);
    if (!booking) return res.status(404).json({ error: 'No se ha encontrado esa cita.' });
    if (booking.status !== 'confirmed') return res.status(409).json({ error: 'Esta cita ya no está activa.' });

    const duration = Number(booking.durationMinutes) || 60;
    const time = booking.time.length === 5 ? booking.time : `${booking.time}:00`;
    const startISO = localToISO(booking.date, time, hours.timezone);
    const currentEndISO = addMinutes(startISO, duration);
    const newEndISO = addMinutes(currentEndISO, extra);

    const free = await isRangeFree(booking.date, booking.calendarId, currentEndISO, newEndISO, weeklyScheduleFor(booking.employeeId));
    if (!free) {
      return res.status(409).json({ error: 'No hay hueco libre justo después de esta cita para ampliar ese tiempo.' });
    }

    await updateEvent(booking.calendarId, booking.eventId, { end: { dateTime: newEndISO } });
    await updateBookingRow(booking._sheetRow, booking, { durationMinutes: duration + extra });

    res.json({ ok: true, newDurationMinutes: duration + extra });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudo ampliar el tiempo de la cita.' });
  }
});

// ── Cerrar cita: registrar importe total real y cómo se pagó el resto,
// sin tocar amountPaid (el pago online por Stripe queda como registro
// histórico intacto) — y acumular saldo de fidelización.
router.post('/panel/close', async (req, res) => {
  // remainderAmount2/paidHow2 son opcionales — para cuando el resto se paga
  // dividido entre dos formas de pago (p.ej. mitad tarjeta, mitad efectivo).
  // redeemAmount es opcional — saldo de fidelización que se aplica como
  // descuento directamente aquí, para no tener que restarlo a mano.
  const { bookingId, finalAmount, paidHow, remainderAmount2, paidHow2, redeemAmount } = req.body || {};
  if (!bookingId) return res.status(400).json({ error: 'Falta el identificador de la cita.' });
  if (finalAmount !== undefined && finalAmount !== '' && !Number.isFinite(Number(finalAmount))) {
    return res.status(400).json({ error: 'El importe total no es un número válido.' });
  }
  try {
    const booking = await findBookingById(bookingId);
    if (!booking) return res.status(404).json({ error: 'No se ha encontrado esa cita.' });

    // Ya cerrada antes: no volver a acumular saldo por duplicado.
    const alreadyClosed = booking.finalAmount !== undefined && booking.finalAmount !== '';

    const onlinePaid = Number(booking.amountPaid) || 0;
    const total = finalAmount !== undefined && finalAmount !== '' ? Number(finalAmount) : onlinePaid;
    let remainder = Math.max(0, round2(total - onlinePaid));

    // Calcular canje de saldo (si se pide): se resta del resto antes de
    // repartirlo en formas de pago, y nunca puede superar ni lo que queda
    // por pagar ni el saldo real disponible de la clienta. Solo vale en
    // tratamientos sueltos (no en sesiones de un bono) y con un mínimo de
    // MIN_REDEEM_AMOUNT por canje. Solo se CALCULA aquí; el movimiento en
    // el libro de saldo se escribe más abajo, después de marcar la cita
    // como cerrada, para que un reintento tras un fallo a mitad de camino
    // no pueda duplicar el canje (ver nota junto a updateBookingRow).
    let redeemed = 0;
    let phoneN = '';
    if (!alreadyClosed && !booking.bonoId && redeemAmount && Number(redeemAmount) >= MIN_REDEEM_AMOUNT) {
      phoneN = normalizePhone(booking.phone);
      const movements = await getLoyaltyMovementsForPhone(phoneN);
      const balance = computeLoyaltyBalance(movements);
      redeemed = Math.max(0, Math.min(remainder, balance, round2(Number(redeemAmount))));
      if (redeemed > 0) remainder = round2(remainder - redeemed);
    }

    const part2 = Math.max(0, Math.min(remainder, round2(Number(remainderAmount2) || 0)));
    const part1 = round2(remainder - part2);

    // remainingPaidHow del bono solo se rellena al cobrar el resto real
    // (sesión 1, cuando se hizo la seña) — en las sesiones siguientes
    // (amountPaid=0, ya cobradas) no hay nada nuevo que cobrar, y sobrescribir
    // aquí borraría el registro de cómo se cobró el resto en su momento.
    if (booking.bonoId && String(booking.sessionNumber) === '1') {
      const bono = await findSessionBonoById(booking.bonoId);
      if (bono) {
        await updateSessionBonoRow(bono._sheetRow, bono, { remainingPaidHow: paidHow || '' });
      }
    }

    // Escribimos primero la fila de la cita (lo que la marca como "cerrada"
    // para futuras llamadas) y solo después los movimientos de saldo — así,
    // si algo falla a mitad de camino y se reintenta, alreadyClosed ya será
    // true y no se puede duplicar ni el canje ni el ingreso de puntos.
    // Si ya estaba cerrada (se está corrigiendo un dato), no se toca
    // redeemedAmount para no borrar un canje ya aplicado la primera vez.
    await updateBookingRow(booking._sheetRow, booking, {
      finalAmount: total,
      remainderPaidHow: paidHow || '',
      remainderAmount2: part2 || '',
      remainderPaidHow2: part2 > 0 ? (paidHow2 || '') : '',
      ...(alreadyClosed ? {} : { redeemedAmount: redeemed || '' }),
    });

    if (!alreadyClosed) {
      if (redeemed > 0) {
        await appendLoyaltyMovement({
          date: new Date().toISOString().slice(0, 10),
          phoneNormalized: phoneN,
          emailNormalized: normalizeEmail(booking.email),
          name: booking.name,
          type: 'redeem',
          bookingId: booking.bookingId,
          serviceName: booking.serviceName,
          category: '',
          baseAmount: '',
          paidHow: '',
          rateApplied: '',
          amount: redeemed,
        });
      }
      // El saldo se acumula sobre TODO lo pagado de verdad (seña online +
      // resto), con una sola tasa para el conjunto: si alguna parte del
      // resto se pagó en efectivo, se aplica la tasa de efectivo al total
      // (no solo a esa parte) — así la clienta no nota que "solo una parte"
      // llevaba la bonificación, que da pie a quejas y confusión.
      const cashInvolved = paidHow === 'efectivo' || (part2 > 0 && paidHow2 === 'efectivo');
      const totalPaidReal = round2(onlinePaid + part1 + part2);
      await earnLoyalty({ booking, portionAmount: totalPaidReal, paidHow: cashInvolved ? 'efectivo' : (paidHow || 'tarjeta') });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudo cerrar la cita.' });
  }
});

// ── Registrar venta de producto suelta (no ligada a ninguna cita) ──
router.post('/panel/product-sale', async (req, res) => {
  const { date, product, amount, paidHow, notes } = req.body || {};
  if (!date || !product || !amount) return res.status(400).json({ error: 'Faltan datos de la venta.' });
  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    return res.status(400).json({ error: 'El importe no es un número válido.' });
  }
  try {
    await appendProductSale({
      saleId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      date,
      product,
      amount: Number(amount),
      paidHow: paidHow || '',
      notes: notes || '',
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudo registrar la venta.' });
  }
});

// ── Canjear saldo de fidelización (aplicado como descuento en el centro) ──
router.post('/panel/redeem', async (req, res) => {
  const { phone, amount, bookingId } = req.body || {};
  const redeemAmount = round2(Number(amount));
  if (!phone || !redeemAmount || redeemAmount <= 0) {
    return res.status(400).json({ error: 'Indica el teléfono de la clienta y el importe a canjear.' });
  }
  if (redeemAmount < MIN_REDEEM_AMOUNT) {
    return res.status(400).json({ error: `El canje mínimo es de ${MIN_REDEEM_AMOUNT} €.` });
  }
  try {
    const phoneN = normalizePhone(phone);
    const movements = await getLoyaltyMovementsForPhone(phoneN);
    const balance = computeLoyaltyBalance(movements);
    if (redeemAmount > balance) {
      return res.status(409).json({ error: `Saldo insuficiente: dispone de ${balance.toFixed(2)} €.` });
    }

    let name = '';
    if (bookingId) {
      const booking = await findBookingById(bookingId);
      if (booking) {
        if (booking.bonoId) {
          return res.status(400).json({ error: 'El saldo no se puede canjear en sesiones de un bono, solo en tratamientos sueltos.' });
        }
        name = booking.name;
      }
    }
    if (!name && movements.length) name = movements[movements.length - 1].name;

    await appendLoyaltyMovement({
      date: new Date().toISOString().slice(0, 10),
      phoneNormalized: phoneN,
      emailNormalized: '',
      name,
      type: 'redeem',
      bookingId: bookingId || '',
      serviceName: '',
      category: '',
      baseAmount: '',
      paidHow: '',
      rateApplied: '',
      amount: redeemAmount,
    });

    res.json({ ok: true, newBalance: round2(balance - redeemAmount) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudo canjear el saldo.' });
  }
});

// ── Añadir saldo de fidelización a mano (p.ej. por un malentendido o
// como detalle puntual) — queda registrado con el motivo, para que se
// pueda distinguir del saldo ganado automáticamente en las citas.
router.post('/panel/loyalty-adjust', async (req, res) => {
  const { phone, amount, note } = req.body || {};
  const addAmount = round2(Number(amount));
  if (!phone || !addAmount || addAmount <= 0) {
    return res.status(400).json({ error: 'Indica el teléfono de la clienta y el importe a añadir.' });
  }
  if (!note || !note.trim()) {
    return res.status(400).json({ error: 'Indica el motivo del ajuste, para dejar constancia.' });
  }
  try {
    const phoneN = normalizePhone(phone);
    const movements = await getLoyaltyMovementsForPhone(phoneN);
    const name = movements.length ? movements[movements.length - 1].name : '';

    await appendLoyaltyMovement({
      date: new Date().toISOString().slice(0, 10),
      phoneNormalized: phoneN,
      emailNormalized: '',
      name,
      type: 'manual_adjustment',
      bookingId: '',
      serviceName: '',
      category: '',
      baseAmount: '',
      paidHow: '',
      rateApplied: '',
      amount: addAmount,
      note: note.trim(),
    });

    res.json({ ok: true, newBalance: computeLoyaltyBalance([...movements, { type: 'manual_adjustment', amount: addAmount, date: new Date().toISOString().slice(0, 10) }]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudo añadir el saldo.' });
  }
});

// ── Corregir los datos de una clienta (nombre, teléfono o email mal
// escritos) en TODO su historial a la vez — reservas, bonos, avisos de
// ausencia y puntos de fidelidad — para que quede todo bajo una sola
// identidad y no se fragmenten los puntos ya ganados por un dato mal puesto.
router.post('/panel/edit-client', async (req, res) => {
  const { oldPhone, name, phone, email } = req.body || {};
  if (!oldPhone || !name || !name.trim() || !phone || !phone.trim()) {
    return res.status(400).json({ error: 'Indica el teléfono original y el nombre y teléfono corregidos.' });
  }
  try {
    const oldPhoneN = normalizePhone(oldPhone);
    if (!oldPhoneN) return res.status(400).json({ error: 'El teléfono original no es válido.' });
    const cleanName = name.trim();
    const cleanPhone = phone.trim();
    const cleanEmail = (email || '').trim();
    const newPhoneN = normalizePhone(cleanPhone);
    const newEmailN = normalizeEmail(cleanEmail);

    const [allBookings, allBonos, allStrikes, allLoyalty] = await Promise.all([
      getAllBookings(), getAllSessionBonos(), getAllStrikeRecords(), getAllLoyaltyMovements(),
    ]);

    let bookingsUpdated = 0;
    for (const b of allBookings) {
      if (normalizePhone(b.phone) === oldPhoneN) {
        await updateBookingRow(b._sheetRow, b, { name: cleanName, phone: cleanPhone, email: cleanEmail || b.email });
        bookingsUpdated += 1;
      }
    }
    for (const bo of allBonos) {
      if (normalizePhone(bo.clientPhone) === oldPhoneN) {
        await updateSessionBonoRow(bo._sheetRow, bo, {
          clientName: cleanName, clientPhone: cleanPhone, clientEmail: cleanEmail || bo.clientEmail,
        });
      }
    }
    for (const s of allStrikes) {
      if (s.phoneNormalized === oldPhoneN) {
        await upsertStrikeRecord({ phoneNormalized: newPhoneN, emailNormalized: newEmailN || s.emailNormalized, name: cleanName }, s);
      }
    }
    for (const m of allLoyalty) {
      if (m.phoneNormalized === oldPhoneN) {
        await updateLoyaltyMovementRow(m._sheetRow, m, {
          phoneNormalized: newPhoneN, emailNormalized: newEmailN || m.emailNormalized, name: cleanName,
        });
      }
    }

    res.json({ ok: true, bookingsUpdated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudieron actualizar los datos de la clienta.' });
  }
});

function noShowEmailHtml({ isFirstTime, booking, bono, lang }) {
  const isEn = lang === 'en';
  if (isFirstTime) {
    return isEn
      ? `<div style="font-family:Arial,sans-serif;color:#2a2520;max-width:480px;margin:0 auto;">
          <h2 style="font-size:18px;">Update on your appointment — Osana</h2>
          <p><b>Treatment:</b> ${booking.serviceName}<br><b>Date:</b> ${booking.date}<br><b>Status:</b> No-show (not deducted this time)</p>
          <p><b>Session deducted: No</b></p>
          <p>From now on, any no-show or cancellation with less than 48h notice will deduct a session from your package.</p>
          <p>Want to reschedule? Go to My Bookings or message us on WhatsApp.</p>
        </div>`
      : `<div style="font-family:Arial,sans-serif;color:#2a2520;max-width:480px;margin:0 auto;">
          <h2 style="font-size:18px;">Actualización de tu cita — Osana</h2>
          <p><b>Cita:</b> ${booking.serviceName}<br><b>Fecha:</b> ${booking.date}<br><b>Estado:</b> Ausencia sin preaviso (no descontable esta vez)</p>
          <p><b>Sesión descontada: No</b></p>
          <p>A partir de ahora, cualquier ausencia sin preaviso o cancelación con menos de 48h descontará una sesión de tu bono.</p>
          <p>¿Quieres reprogramar? Entra en Mis Reservas o escríbenos por WhatsApp.</p>
        </div>`;
  }
  const remainingLine = bono ? `<p><b>Sesiones restantes en tu bono: ${bono.sessionsRemaining} de ${bono.totalSessions}</b></p>` : '';
  const remainingLineEn = bono ? `<p><b>Sessions remaining in your package: ${bono.sessionsRemaining} of ${bono.totalSessions}</b></p>` : '';
  return isEn
    ? `<div style="font-family:Arial,sans-serif;color:#2a2520;max-width:480px;margin:0 auto;">
        <h2 style="font-size:18px;">Update on your appointment — Osana</h2>
        <p><b>Treatment:</b> ${booking.serviceName}<br><b>Date:</b> ${booking.date}<br><b>Status:</b> No-show</p>
        <p><b>Session deducted: Yes (1 session)</b></p>
        ${remainingLineEn}
        <p>Your no-show allowance was already used previously.</p>
        <p>Want to reschedule? Go to My Bookings or message us on WhatsApp.</p>
      </div>`
    : `<div style="font-family:Arial,sans-serif;color:#2a2520;max-width:480px;margin:0 auto;">
        <h2 style="font-size:18px;">Actualización de tu cita — Osana</h2>
        <p><b>Cita:</b> ${booking.serviceName}<br><b>Fecha:</b> ${booking.date}<br><b>Estado:</b> Ausencia sin preaviso</p>
        <p><b>Sesión descontada: Sí (1 sesión)</b></p>
        ${remainingLine}
        <p>Tu comodín de falta ya fue utilizado anteriormente.</p>
        <p>¿Quieres reprogramar? Entra en Mis Reservas o escríbenos por WhatsApp.</p>
      </div>`;
}

// ── Marcar como no-show: perdona la 1ª vez (y restaura la sesión si había
// bono), descuenta a partir de la 2ª — y avisa siempre por email ──
router.post('/panel/no-show', async (req, res) => {
  const { bookingId } = req.body || {};
  if (!bookingId) return res.status(400).json({ error: 'Falta el identificador de la cita.' });
  try {
    const booking = await findBookingById(bookingId);
    if (!booking) return res.status(404).json({ error: 'No se ha encontrado esa cita.' });
    // Evita que un doble clic o un reintento cuente la misma ausencia dos
    // veces (segundo strike / segunda restauración de sesión de bono).
    if (booking.status === 'no_show') {
      return res.json({ ok: true, alreadyMarked: true });
    }

    await updateBookingRow(booking._sheetRow, booking, { status: 'no_show' });

    const phoneN = normalizePhone(booking.phone);
    const emailN = normalizeEmail(booking.email);
    const allStrikes = await getAllStrikeRecords();
    const existing = allStrikes.find((s) => s.phoneNormalized === phoneN || (emailN && s.emailNormalized === emailN));
    const isFirstTime = !existing || Number(existing.strikeCount) === 0;

    let bono = null;
    if (booking.bonoId) {
      bono = await findSessionBonoById(booking.bonoId);
    }

    if (isFirstTime) {
      // Se perdona: si había bono, se restaura la sesión para que se pueda volver a agendar sin coste
      if (bono) {
        const sessionsUsed = Math.max(0, (Number(bono.sessionsUsed) || 0) - 1);
        const sessionsRemaining = (Number(bono.sessionsRemaining) || 0) + 1;
        await updateSessionBonoRow(bono._sheetRow, bono, { sessionsUsed, sessionsRemaining, status: 'active' });
        bono = { ...bono, sessionsUsed, sessionsRemaining };
      }
      await upsertStrikeRecord({
        phoneNormalized: phoneN, emailNormalized: emailN, name: booking.name,
        strikeCount: 1, lastStrikeDate: new Date().toISOString().slice(0, 10),
      }, existing);
    } else {
      // No se restaura nada — la sesión queda gastada
      await upsertStrikeRecord({
        phoneNormalized: phoneN, emailNormalized: emailN, name: booking.name,
        strikeCount: (Number(existing.strikeCount) || 0) + 1, lastStrikeDate: new Date().toISOString().slice(0, 10),
      }, existing);
    }

    if (booking.email) {
      try {
        await sendEmail({
          to: booking.email,
          subject: booking.lang === 'en' ? 'Update on your appointment — Osana' : 'Actualización de tu cita — Osana',
          html: noShowEmailHtml({ isFirstTime, booking, bono, lang: booking.lang }),
        });
      } catch (emailErr) {
        console.error('No se pudo enviar el email de no-show:', emailErr);
      }
    }

    res.json({ ok: true, isFirstTime, sessionsRemaining: bono ? bono.sessionsRemaining : null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudo marcar la ausencia.' });
  }
});

// ── Eliminar una cita por error (duplicada, mal introducida...): libera el
// hueco del calendario y la marca como anulada — no la borra físicamente de
// la Sheet (para conservar el rastro), pero deja de contar como facturación
// y desaparece de las acciones normales. OJO: esto NO tramita ningún
// reembolso en Stripe si la cita se había pagado de verdad online — eso
// sigue haciéndose a mano desde el Dashboard de Stripe si hace falta.
router.post('/panel/delete-booking', async (req, res) => {
  const { bookingId } = req.body || {};
  if (!bookingId) return res.status(400).json({ error: 'Falta el identificador de la cita.' });
  try {
    const booking = await findBookingById(bookingId);
    if (!booking) return res.status(404).json({ error: 'No se ha encontrado esa cita.' });
    if (booking.status === 'cancelled_refunded') {
      return res.json({ ok: true, alreadyDeleted: true });
    }

    if (booking.calendarId && booking.eventId) {
      try {
        await deleteEvent(booking.calendarId, booking.eventId);
      } catch (calErr) {
        console.error('No se pudo borrar el evento del calendario al eliminar la cita:', calErr.message);
      }
    }

    const deletedNote = `Eliminada manualmente desde el panel el ${new Date().toISOString().slice(0, 10)}.`;
    await updateBookingRow(booking._sheetRow, booking, {
      status: 'cancelled_refunded',
      notes: booking.notes ? `${booking.notes}\n${deletedNote}` : deletedNote,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudo eliminar la cita.' });
  }
});

// ── Informe trimestral en Excel, con la misma estructura que la plantilla
// de contabilidad real, listo para entregar al asesor cada 3 meses ──
router.get('/panel/report', async (req, res) => {
  const year = Number(req.query.year);
  const quarter = Number(req.query.quarter);
  if (!year || !quarter || quarter < 1 || quarter > 4) {
    return res.status(400).json({ error: 'Indica un año y un trimestre (1-4) válidos.' });
  }
  try {
    const [bookings, productSales, customQuotes] = await Promise.all([
      getAllBookings(), getAllProductSales(), getAllCustomQuotes(),
    ]);
    const workbook = await buildQuarterlyReportWorkbook({ year, quarter, bookings, productSales, customQuotes });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Osana_Informe_Q${quarter}_${year}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudo generar el informe.' });
  }
});

// ── Presupuesto personalizado: genera un link de pago de Stripe para un
// importe fuera de catálogo (con Klarna, ya que siempre es pago 100% online) ──
router.post('/panel/custom-quote', async (req, res) => {
  const { clientName, clientPhone, clientEmail, description, amount, category, lang } = req.body || {};
  const amountNum = Number(amount);
  if (!clientName || !description || !amountNum || amountNum <= 0) {
    return res.status(400).json({ error: 'Indica al menos el nombre, la descripción y el importe.' });
  }
  if (!QUOTE_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'Elige una categoría contable válida.' });
  }
  try {
    const quoteId = crypto.randomUUID();
    const origin = resolveOrigin(req);
    const thanksPath = lang === 'en' ? '/en/reserva.html' : '/reserva.html';
    const session = await createCheckoutSession({
      amountEuros: amountNum,
      description: `${description} — Osana`,
      successUrl: `${origin}${thanksPath}?estado=ok`,
      cancelUrl: `${origin}${thanksPath}?estado=cancelado`,
      allowKlarna: true, // siempre pago 100% online, tiene sentido ofrecer financiación
      metadata: {
        type: 'custom_quote',
        quoteId,
        clientName,
        clientPhone: clientPhone || '',
        clientEmail: clientEmail || '',
        description,
        category,
        amount: String(amountNum),
        lang: lang === 'en' ? 'en' : 'es',
      },
    });

    await appendCustomQuote({
      quoteId,
      createdAt: new Date().toISOString(),
      clientName,
      clientPhone: clientPhone || '',
      clientEmail: clientEmail || '',
      description,
      category,
      amount: amountNum,
      status: 'pending',
      paidDate: '',
      paymentIntentId: '',
      lang: lang === 'en' ? 'en' : 'es',
    });

    res.json({ ok: true, url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudo generar el link de pago.' });
  }
});

// ── Bonos regalo: búsqueda por código y canje ──
router.get('/panel/gift', async (req, res) => {
  const code = String(req.query.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Indica el código del bono regalo.' });
  try {
    const all = await getAllGifts();
    const gift = all.find((g) => String(g.code || '').trim().toUpperCase() === code);
    if (!gift) return res.status(404).json({ error: 'No se ha encontrado ningún bono regalo con ese código.' });
    res.json({ gift });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudo buscar el bono regalo.' });
  }
});

router.post('/panel/gift-redeem', async (req, res) => {
  const code = String((req.body || {}).code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Indica el código del bono regalo.' });
  try {
    const all = await getAllGifts();
    const gift = all.find((g) => String(g.code || '').trim().toUpperCase() === code);
    if (!gift) return res.status(404).json({ error: 'No se ha encontrado ningún bono regalo con ese código.' });
    if (gift.status === 'redeemed') {
      return res.status(409).json({ error: 'Este bono regalo ya se marcó como canjeado.' });
    }
    await updateGiftRow(gift._sheetRow, { status: 'redeemed', redeemedAt: new Date().toISOString() });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudo marcar el bono como canjeado.' });
  }
});

// ── Códigos de descuento: crear, listar, desactivar y avisar por email a
// las clientas ya registradas (p.ej. una promo de lanzamiento restringida
// a ciertos tratamientos y a un rango de fechas concreto). El código lo
// reparte el propio centro (Instagram, email...) — no aparece en la web.
router.post('/panel/discount', async (req, res) => {
  const { code, serviceIds, discountType, discountValue, validFrom, validUntil, note } = req.body || {};
  const ids = Array.isArray(serviceIds) ? serviceIds.filter(Boolean) : [];
  const value = Number(discountValue);
  if (!code || !code.trim()) return res.status(400).json({ error: 'Indica el código.' });
  if (!ids.length) return res.status(400).json({ error: 'Elige al menos un tratamiento al que aplique.' });
  if (!['percent', 'amount'].includes(discountType)) return res.status(400).json({ error: 'Indica si es % o € de descuento.' });
  if (!value || value <= 0) return res.status(400).json({ error: 'Indica el importe o porcentaje de descuento.' });
  if (!validFrom || !validUntil) return res.status(400).json({ error: 'Indica la fecha de inicio y de fin.' });
  if (validUntil < validFrom) return res.status(400).json({ error: 'La fecha de fin no puede ser anterior a la de inicio.' });

  try {
    const existing = await getAllDiscounts();
    if (existing.some((d) => String(d.code).trim().toUpperCase() === code.trim().toUpperCase())) {
      return res.status(409).json({ error: 'Ya existe un código de descuento con ese nombre.' });
    }
    const serviceNames = ids.map((id) => (services.find((s) => s.id === id) || {}).name || id).join(', ');
    await appendDiscount({
      discountId: crypto.randomUUID(),
      code: code.trim().toUpperCase(),
      serviceIds: ids.join(','),
      serviceNames,
      discountType,
      discountValue: value,
      validFrom,
      validUntil,
      active: 'true',
      createdAt: new Date().toISOString(),
      note: note || '',
      emailSentAt: '',
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudo crear el descuento.' });
  }
});

router.get('/panel/discounts', async (req, res) => {
  try {
    const all = await getAllDiscounts();
    const list = all
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((d) => ({
        discountId: d.discountId, code: d.code, serviceNames: d.serviceNames,
        discountType: d.discountType, discountValue: d.discountValue,
        validFrom: d.validFrom, validUntil: d.validUntil, note: d.note,
        active: d.active !== 'false', live: isDiscountLive(d), emailSentAt: d.emailSentAt || '',
      }));
    res.json({ discounts: list });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudieron cargar los descuentos.' });
  }
});

router.post('/panel/discount-deactivate', async (req, res) => {
  const { discountId } = req.body || {};
  if (!discountId) return res.status(400).json({ error: 'Falta el identificador del descuento.' });
  try {
    const all = await getAllDiscounts();
    const discount = all.find((d) => d.discountId === discountId);
    if (!discount) return res.status(404).json({ error: 'No se ha encontrado ese descuento.' });
    await updateDiscountRow(discount._sheetRow, { active: 'false' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudo desactivar el descuento.' });
  }
});

function discountEmailHtml(discount) {
  const valueLabel = discount.discountType === 'percent' ? `${discount.discountValue}%` : `${discount.discountValue} €`;
  const untilLabel = new Date(`${discount.validUntil}T12:00:00`).toLocaleDateString('es-ES', { day: '2-digit', month: 'long' });
  return `
    <p>Hola,</p>
    <p>Tenemos un descuento especial para ti: <strong>${valueLabel} de descuento</strong> en ${discount.serviceNames}.</p>
    <p>Solo tienes que introducir este código al reservar y pagar:</p>
    <p style="font-size:20px;font-weight:700;letter-spacing:2px;margin:16px 0;">${discount.code}</p>
    <p>Válido hasta el ${untilLabel}.</p>
    <p><a href="https://osana.es/reserva.html">Reserva tu cita aquí</a>.</p>
    <p>¡Te esperamos!<br>Osana</p>
  `;
}

// No se espera a que terminen todos los envíos antes de responder (podrían
// ser muchas clientas) — se lanza en segundo plano y el panel avisa de
// cuántas se van a avisar; los fallos puntuales quedan en el log del servidor.
router.post('/panel/discount-email-blast', async (req, res) => {
  const { discountId } = req.body || {};
  if (!discountId) return res.status(400).json({ error: 'Falta el identificador del descuento.' });
  try {
    const all = await getAllDiscounts();
    const discount = all.find((d) => d.discountId === discountId);
    if (!discount) return res.status(404).json({ error: 'No se ha encontrado ese descuento.' });

    const bookings = await getAllBookings();
    const uniqueEmails = new Map();
    bookings.forEach((b) => {
      const email = normalizeEmail(b.email);
      if (email && !uniqueEmails.has(email)) uniqueEmails.set(email, b.email);
    });

    res.json({ ok: true, recipients: uniqueEmails.size });

    (async () => {
      const html = discountEmailHtml(discount);
      for (const email of uniqueEmails.values()) {
        try {
          await sendEmail({ to: email, subject: `Un descuento especial de Osana para ti`, html });
        } catch (err) {
          console.error(`Error enviando email de descuento a ${email}:`, err.message);
        }
      }
      await updateDiscountRow(discount._sheetRow, { emailSentAt: new Date().toISOString() }).catch(() => {});
    })();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudo enviar la campaña.' });
  }
});

// ── Seguimientos de clientas ──
const FOLLOWUP_DAYS_BY_TIMEFRAME = {
  '3dias': 3, '1semana': 7, '1mes': 30, '3meses': 90,
};

router.post('/panel/followup', async (req, res) => {
  const { clientName, clientPhone, clientEmail, note, timeframe } = req.body || {};
  const days = FOLLOWUP_DAYS_BY_TIMEFRAME[timeframe];
  if (!clientName || !days) {
    return res.status(400).json({ error: 'Indica al menos el nombre de la clienta y el plazo.' });
  }
  try {
    const due = new Date();
    due.setDate(due.getDate() + days);
    await appendFollowup({
      followupId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      clientName, clientPhone: clientPhone || '', clientEmail: clientEmail || '',
      note: note || '',
      dueDate: due.toISOString().slice(0, 10),
      status: 'pending',
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudo guardar el seguimiento.' });
  }
});

router.post('/panel/followup-done', async (req, res) => {
  const { followupId } = req.body || {};
  if (!followupId) return res.status(400).json({ error: 'Falta el identificador del seguimiento.' });
  try {
    const all = await getAllFollowups();
    const followup = all.find((f) => f.followupId === followupId);
    if (!followup) return res.status(404).json({ error: 'No se ha encontrado ese seguimiento.' });
    await updateFollowupRow(followup._sheetRow, { status: 'done' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudo marcar como hecho.' });
  }
});

// ── Agenda / panel de control: todo lo que necesita atención de un
// vistazo — citas sin cerrar, agenda de los próximos días, seguimientos
// pendientes, bonos con sesión por agendar, bonos cerca de caducar y
// presupuestos sin pagar.
router.get('/panel/agenda', async (req, res) => {
  const days = Math.max(1, Number(req.query.days) || 7);
  try {
    const [bookings, sessionBonos, customQuotes, followups] = await Promise.all([
      getAllBookings(), getAllSessionBonos(), getAllCustomQuotes(), getAllFollowups(),
    ]);
    const now = Date.now();
    const rangeEndMs = now + days * 24 * 60 * 60 * 1000;
    const expiringWindowMs = now + 30 * 24 * 60 * 60 * 1000;

    const unclosedBookings = bookings
      .filter((b) => b.status === 'confirmed' && (b.finalAmount === undefined || b.finalAmount === '')
        && appointmentDateTime(b).getTime() < now)
      .sort((a, b) => appointmentDateTime(a) - appointmentDateTime(b));

    const upcomingBookings = bookings
      .filter((b) => b.status === 'confirmed' && appointmentDateTime(b).getTime() >= now
        && appointmentDateTime(b).getTime() <= rangeEndMs)
      .sort((a, b) => appointmentDateTime(a) - appointmentDateTime(b));

    const pendingBonoSessions = sessionBonos
      .filter((bono) => bono.status === 'active' && Number(bono.sessionsRemaining) > 0
        && !bookings.some((b) => b.bonoId === bono.bonoId && b.status === 'confirmed'
          && appointmentDateTime(b).getTime() >= now));

    const expiringBonos = sessionBonos
      .filter((bono) => bono.status === 'active' && bono.expiryDate
        && new Date(bono.expiryDate).getTime() >= now && new Date(bono.expiryDate).getTime() <= expiringWindowMs)
      .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));

    const unpaidQuotes = customQuotes
      .filter((q) => q.status === 'pending')
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    const dueFollowups = followups
      .filter((f) => f.status !== 'done' && new Date(`${f.dueDate}T12:00:00`).getTime() <= rangeEndMs)
      .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

    res.json({
      unclosedBookings: unclosedBookings.map((b) => ({
        bookingId: b.bookingId, name: b.name, phone: b.phone, serviceName: b.serviceName,
        date: b.date, time: b.time, employeeName: b.employeeName,
      })),
      upcomingBookings: upcomingBookings.map((b) => ({
        bookingId: b.bookingId, name: b.name, phone: b.phone, serviceName: b.serviceName,
        date: b.date, time: b.time, employeeName: b.employeeName,
      })),
      pendingBonoSessions: pendingBonoSessions.map((bono) => ({
        bonoId: bono.bonoId, clientName: bono.clientName, clientPhone: bono.clientPhone,
        serviceName: bono.serviceName, sessionsUsed: bono.sessionsUsed, totalSessions: bono.totalSessions,
      })),
      expiringBonos: expiringBonos.map((bono) => ({
        bonoId: bono.bonoId, clientName: bono.clientName, clientPhone: bono.clientPhone,
        serviceName: bono.serviceName, sessionsRemaining: bono.sessionsRemaining, expiryDate: bono.expiryDate,
      })),
      unpaidQuotes: unpaidQuotes.map((q) => ({
        quoteId: q.quoteId, clientName: q.clientName, clientPhone: q.clientPhone,
        description: q.description, amount: q.amount, createdAt: q.createdAt,
      })),
      dueFollowups: dueFollowups.map((f) => ({
        followupId: f.followupId, clientName: f.clientName, clientPhone: f.clientPhone,
        note: f.note, dueDate: f.dueDate,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudo cargar la agenda.' });
  }
});

module.exports = router;
