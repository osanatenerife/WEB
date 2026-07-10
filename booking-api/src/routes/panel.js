const express = require('express');
const {
  getAllBookings, findBookingById, updateBookingRow, appendBooking,
  getAllSessionBonos, findSessionBonoById, updateSessionBonoRow,
  getAllStrikeRecords, upsertStrikeRecord,
  appendLoyaltyMovement, appendProductSale,
} = require('../lib/sheets');
const { createBookingEvent, updateEvent } = require('../lib/googleCalendar');
const { getAvailableSlots } = require('../lib/availability');
const { localToISO, addMinutes } = require('../lib/timezone');
const { sendEmail } = require('../lib/email');
const { normalizePhone, normalizeEmail } = require('../lib/clientId');
const { accountingCategoryFor } = require('../config/accountingCategories');
const { earnRateFor } = require('../config/loyalty');
const hours = require('../config/hours');
const services = require('../config/services');
const employees = require('../config/employees');
const crypto = require('crypto');

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
router.use('/panel', (req, res, next) => {
  const expected = process.env.PANEL_SECRET;
  if (!expected) return res.status(500).json({ error: 'Falta configurar PANEL_SECRET en el servidor.' });
  if (req.header('x-panel-key') !== expected) {
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
    const [allBookings, allBonos, allStrikes] = await Promise.all([
      getAllBookings(), getAllSessionBonos(), getAllStrikeRecords(),
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
      return {
        name: latest.name,
        phone: latest.phone,
        email: latest.email,
        strikeCount: strike ? Number(strike.strikeCount) || 0 : 0,
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
router.post('/panel/note', async (req, res) => {
  const { bookingId, note } = req.body || {};
  if (!bookingId) return res.status(400).json({ error: 'Falta el identificador de la cita.' });
  try {
    const booking = await findBookingById(bookingId);
    if (!booking) return res.status(404).json({ error: 'No se ha encontrado esa cita.' });
    await updateBookingRow(booking._sheetRow, booking, { notes: note || '' });
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

// ── Cerrar cita: registrar importe total real y cómo se pagó el resto,
// sin tocar amountPaid (el pago online por Stripe queda como registro
// histórico intacto) — y acumular saldo de fidelización.
router.post('/panel/close', async (req, res) => {
  const { bookingId, finalAmount, paidHow } = req.body || {};
  if (!bookingId) return res.status(400).json({ error: 'Falta el identificador de la cita.' });
  try {
    const booking = await findBookingById(bookingId);
    if (!booking) return res.status(404).json({ error: 'No se ha encontrado esa cita.' });

    // Ya cerrada antes: no volver a acumular saldo por duplicado.
    const alreadyClosed = booking.finalAmount !== undefined && booking.finalAmount !== '';

    const onlinePaid = Number(booking.amountPaid) || 0;
    const total = finalAmount !== undefined && finalAmount !== '' ? Number(finalAmount) : onlinePaid;
    const remainder = Math.max(0, round2(total - onlinePaid));

    if (booking.bonoId) {
      const bono = await findSessionBonoById(booking.bonoId);
      if (bono) {
        await updateSessionBonoRow(bono._sheetRow, bono, { remainingPaidHow: paidHow || '' });
      }
    }

    await updateBookingRow(booking._sheetRow, booking, {
      finalAmount: total,
      remainderPaidHow: paidHow || '',
    });

    if (!alreadyClosed) {
      await earnLoyalty({ booking, portionAmount: onlinePaid, paidHow: 'tarjeta' });
      await earnLoyalty({ booking, portionAmount: remainder, paidHow: paidHow || '' });
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

module.exports = router;
