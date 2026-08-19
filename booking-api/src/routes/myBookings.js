const express = require('express');
const crypto = require('crypto');
const { getAllBookings, findBookingById, updateBookingRow, getLoyaltyMovementsForPhone, findSessionBonoById, updateSessionBonoRow, getAllSessionBonos, appendBooking, getAllStrikeRecords, upsertStrikeRecord } = require('../lib/sheets');
const { deleteEvent, updateEvent, createBookingEvent, isEventUsable } = require('../lib/googleCalendar');
const { refundPayment } = require('../lib/stripeClient');
const { getAvailableSlots } = require('../lib/availability');
const { localToISO, addMinutes } = require('../lib/timezone');
const hours = require('../config/hours');
const employees = require('../config/employees');
const services = require('../config/services');
const { normalizePhone, normalizeEmail } = require('../lib/clientId');
const { computeLoyaltyBalance } = require('../config/loyalty');
const { sendEmail } = require('../lib/email');
const { hasOtherActiveBookingsOnSameEvent } = require('../lib/sharedCalendarEvent');
const { withLock } = require('../lib/asyncLock');
const { canDo } = require('./services');

const SALON_EMAIL = process.env.GIFT_NOTIFY_EMAIL || 'osanatenerife@gmail.com';

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const router = express.Router();

const FREE_CANCEL_HOURS = 48;

function appointmentDateTime(booking) {
  const time = booking.time.length === 5 ? booking.time : `${booking.time}:00`;
  return new Date(localToISO(booking.date, time, hours.timezone));
}

function hoursUntil(booking) {
  return (appointmentDateTime(booking).getTime() - Date.now()) / 3600000;
}

function isOwner(booking, phone, email) {
  return normalizePhone(booking.phone) === normalizePhone(phone)
    && normalizeEmail(booking.email) === normalizeEmail(email);
}

function isOwnerBono(bono, phone, email) {
  return normalizePhone(bono.clientPhone) === normalizePhone(phone)
    && normalizeEmail(bono.clientEmail) === normalizeEmail(email);
}

function toPublicBooking(b) {
  const hrs = hoursUntil(b);
  const forgiven = b.status === 'no_show_forgiven';
  return {
    bookingId: b.bookingId,
    serviceId: b.serviceId,
    serviceName: b.serviceName,
    employeeId: b.employeeId,
    employeeName: b.employeeName,
    bonoId: b.bonoId || '',
    date: b.date,
    time: b.time,
    durationMinutes: Number(b.durationMinutes) || 0,
    price: Number(b.price) || 0,
    amountPaid: Number(b.amountPaid) || 0,
    paymentType: b.paymentType,
    status: b.status,
    // Una ausencia perdonada la primera vez ya pasó (su fecha es del
    // pasado) — no tiene sentido pedirle 48h de antelación sobre una cita
    // que ya no existe, así que se puede reprogramar siempre, sin las
    // condiciones normales de antelación. No se ofrece cancelarla (no hay
    // reembolso que tenga sentido dar por una cita a la que no se vino):
    // solo se puede reprogramar sin coste, o dejarla así.
    canCancelFree: !forgiven && hrs >= FREE_CANCEL_HOURS,
    canReschedule: forgiven || hrs >= FREE_CANCEL_HOURS,
    noShowForgiven: forgiven,
  };
}

// ── Listar reservas futuras de un cliente (incluye las ausencias
// perdonadas la 1ª vez, aunque su fecha ya haya pasado — siguen "activas"
// a efectos de poder reprogramarlas sin coste) ──
router.get('/my-bookings', async (req, res) => {
  const { phone, email } = req.query;
  if (!phone || !email) {
    return res.status(400).json({ error: 'Introduce tu teléfono y tu email para buscar tus reservas.' });
  }
  try {
    const [all, allBonos] = await Promise.all([getAllBookings(), getAllSessionBonos()]);
    const now = Date.now();
    const mine = all.filter((b) => (
      isOwner(b, phone, email)
      && (
        (b.status === 'confirmed' && appointmentDateTime(b).getTime() > now)
        || b.status === 'no_show_forgiven'
      )
    ));
    mine.sort((a, b) => appointmentDateTime(a) - appointmentDateTime(b));

    // Bonos suyos con sesiones por agendar — para que pueda reservarse ella
    // misma la siguiente sesión desde aquí. sessionsRemaining ya baja en
    // cuanto se agenda una sesión (no cuando se hace de verdad), así que
    // esto no depende de si la sesión anterior ya se realizó o se cerró:
    // si le quedan sesiones por agendar, puede pedir la siguiente aunque la
    // de antes siga pendiente (p.ej. adelantar ya la 3ª sin esperar a la 2ª).
    const pendingBonoSessions = allBonos
      .filter((bo) => bo.status === 'active' && Number(bo.sessionsRemaining) > 0
        && isOwnerBono(bo, phone, email)
        && services.find((s) => s.id === bo.serviceId))
      .map((bo) => ({
        bonoId: bo.bonoId,
        serviceId: bo.serviceId,
        serviceName: bo.serviceName,
        employeeId: bo.employeeId || '',
        sessionsUsed: Number(bo.sessionsUsed) || 0,
        sessionsRemaining: Number(bo.sessionsRemaining) || 0,
        totalSessions: Number(bo.totalSessions) || 0,
      }));

    // El saldo de fidelización solo se calcula/devuelve si el teléfono+email
    // coinciden con al menos una reserva real (mismo criterio que isOwner
    // para las reservas) — si no, cualquiera que adivine un teléfono podría
    // ver el saldo de otra clienta aunque el email no coincida.
    const hasOwnedBooking = all.some((b) => isOwner(b, phone, email));
    let loyaltyBalance = 0;
    let loyaltyHistory = [];
    if (hasOwnedBooking) {
      const movements = await getLoyaltyMovementsForPhone(normalizePhone(phone));
      loyaltyBalance = computeLoyaltyBalance(movements);
      // Historial visible aunque el saldo actual sea 0 (p.ej. tras canjear
      // todo) — así la clienta siempre puede ver qué ganó y qué canjeó.
      loyaltyHistory = movements
        .slice()
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 30)
        .map((m) => ({
          date: m.date,
          type: m.type,
          serviceName: m.serviceName || '',
          amount: Number(m.amount) || 0,
        }));
    }

    res.json({ bookings: mine.map(toPublicBooking), pendingBonoSessions, loyaltyBalance, loyaltyHistory });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudieron consultar tus reservas.' });
  }
});

// ── Historial de visitas pasadas (solo lectura, sin cancelar/reprogramar) ──
router.get('/my-bookings/history', async (req, res) => {
  const { phone, email } = req.query;
  if (!phone || !email) {
    return res.status(400).json({ error: 'Introduce tu teléfono y tu email para buscar tu historial.' });
  }
  try {
    const all = await getAllBookings();
    const now = Date.now();
    const past = all.filter((b) => (
      // Solo citas que de verdad tuvieron lugar — una cancelada (con o sin
      // reembolso) o una falta no son una "visita" real, y enseñar su
      // precio aquí como si se hubiera cobrado normal confundiría a la
      // clienta (parecería que se le cobró algo que en realidad se le
      // devolvió, o que vino un día que no vino).
      b.status === 'confirmed'
      && isOwner(b, phone, email)
      && appointmentDateTime(b).getTime() <= now
      // Y solo si el equipo ya la ha cerrado — su hora puede haber pasado
      // sin que la clienta haya venido de verdad todavía, o sin que el
      // equipo haya confirmado cómo fue; hasta entonces sigue "pendiente
      // de realizar", no aparece como una visita ya hecha.
      && b.finalAmount !== undefined && b.finalAmount !== ''
    ));
    past.sort((a, b) => appointmentDateTime(b) - appointmentDateTime(a)); // más reciente primero
    res.json({
      bookings: past.map((b) => ({
        serviceName: b.serviceName,
        employeeName: b.employeeName,
        date: b.date,
        time: b.time,
        price: Number(b.price) || 0,
        bonoId: b.bonoId || '',
        status: b.status,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudo consultar tu historial.' });
  }
});

// ── Huecos libres para reprogramar (misma duración de la reserva original;
// misma profesional salvo que se pida explícitamente otra) ──
router.get('/my-bookings/slots', async (req, res) => {
  const { bookingId, phone, email, date, employeeId } = req.query;
  if (!bookingId || !phone || !email || !date) {
    return res.status(400).json({ error: 'Faltan datos para consultar huecos.' });
  }
  try {
    const booking = await findBookingById(bookingId);
    if (!booking || !isOwner(booking, phone, email)) {
      return res.status(404).json({ error: 'No se ha encontrado esa reserva con esos datos.' });
    }
    let targetEmployee = employees.find((e) => e.id === booking.employeeId);
    if (employeeId && employeeId !== booking.employeeId) {
      const candidate = employees.find((e) => e.id === employeeId);
      if (!candidate || !canDo(candidate, booking.serviceId)) {
        return res.status(400).json({ error: 'Esa profesional no puede realizar este tratamiento.' });
      }
      targetEmployee = candidate;
    }
    if (!targetEmployee) return res.status(404).json({ error: 'No se ha encontrado la profesional de esta cita.' });
    const duration = Number(booking.durationMinutes) || 60;
    const slots = await getAvailableSlots(date, targetEmployee.calendarId, duration, targetEmployee.weekly);
    res.json({ slots });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudo consultar la disponibilidad.' });
  }
});

// ── Huecos libres para reservar ella misma la siguiente sesión de un bono
// que todavía no tiene cita puesta (mismo criterio de profesional que el
// resto: la habitual por defecto, o cualquiera que pueda con el tratamiento) ──
router.get('/my-bookings/bono-slots', async (req, res) => {
  const { bonoId, phone, email, date, employeeId } = req.query;
  if (!bonoId || !phone || !email || !date || !employeeId) {
    return res.status(400).json({ error: 'Faltan datos para consultar huecos.' });
  }
  try {
    const bono = await findSessionBonoById(bonoId);
    if (!bono || !isOwnerBono(bono, phone, email)) {
      return res.status(404).json({ error: 'No se ha encontrado ese bono con esos datos.' });
    }
    if (bono.status !== 'active' || Number(bono.sessionsRemaining) <= 0) {
      return res.status(409).json({ error: 'Este bono no tiene sesiones pendientes.' });
    }
    const service = services.find((s) => s.id === bono.serviceId);
    if (!service) return res.status(404).json({ error: 'No se ha encontrado el tratamiento de este bono.' });
    const employee = employees.find((e) => e.id === employeeId);
    if (!employee || !canDo(employee, bono.serviceId)) {
      return res.status(400).json({ error: 'Esa profesional no puede realizar este tratamiento.' });
    }
    const slots = await getAvailableSlots(date, employee.calendarId, service.durationMinutes, employee.weekly);
    res.json({ slots });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudo consultar la disponibilidad.' });
  }
});

// ── Reservar ella misma la siguiente sesión de un bono — misma lógica que
// /panel/book-session (descuenta la sesión, crea el evento y la fila de
// reserva ya pagada como parte del bono) pero sin las opciones de solo
// equipo (agrupar varias sesiones, cambiar el tratamiento del día, forzar
// un hueco pasado, notas internas). ──
router.post('/my-bookings/book-bono-session', async (req, res) => {
  const { bonoId, phone, email, employeeId, date, time } = req.body || {};
  if (!bonoId || !phone || !email || !employeeId || !date || !time) {
    return res.status(400).json({ error: 'Faltan datos para reservar la sesión.' });
  }
  try {
    return await withLock(`bono:${bonoId}`, async () => {
    const bono = await findSessionBonoById(bonoId);
    if (!bono || !isOwnerBono(bono, phone, email)) {
      return res.status(404).json({ error: 'No se ha encontrado ese bono con esos datos.' });
    }
    const remaining = Number(bono.sessionsRemaining) || 0;
    if (bono.status !== 'active' || remaining <= 0) {
      return res.status(409).json({ error: 'Este bono no tiene sesiones pendientes.' });
    }
    const service = services.find((s) => s.id === bono.serviceId);
    if (!service) return res.status(404).json({ error: 'No se ha encontrado el tratamiento de este bono.' });
    const employee = employees.find((e) => e.id === employeeId);
    if (!employee || !canDo(employee, bono.serviceId)) {
      return res.status(400).json({ error: 'Esa profesional no puede realizar este tratamiento.' });
    }

    const daysAhead = Math.floor((new Date(`${date}T12:00:00Z`) - new Date()) / 86400000);
    if (daysAhead < 0 || daysAhead > hours.bookingWindowDays) {
      return res.status(400).json({ error: 'Esa fecha no está disponible para reservar.' });
    }

    const durationMinutes = service.durationMinutes;
    const startISO = localToISO(date, time.length === 5 ? time : `${time}:00`, hours.timezone);
    const endISO = addMinutes(startISO, durationMinutes);
    const fromSession = (Number(bono.sessionsUsed) || 0) + 1;
    const sessionLabel = `${fromSession}/${bono.totalSessions}`;

    // Revalidar disponibilidad y crear el evento dentro del mismo bloqueo en
    // memoria por profesional+día que usa el panel — evita que esto choque
    // con el equipo agendándole la misma sesión casi a la vez.
    const newEventId = await withLock(`slot:${employeeId}:${date}`, async () => {
      const freeSlots = await getAvailableSlots(date, employee.calendarId, durationMinutes, employee.weekly);
      if (!freeSlots.includes(time)) return null;
      const event = await createBookingEvent(employee.calendarId, {
        summary: `✅ Bono (${sessionLabel}) — ${service.name} — ${bono.clientName}`,
        description: [
          `Cliente: ${bono.clientName}`,
          `Teléfono: ${bono.clientPhone}`,
          `Bono: ${bono.serviceName} — sesión ${sessionLabel}`,
          'Ya pagada como parte del bono.',
          'Reservada por la clienta desde Mis Reservas.',
        ].join('\n'),
        startISO, endISO,
      });
      return event.id;
    });
    if (!newEventId) {
      return res.status(409).json({ error: 'Ese hueco ya no está disponible. Elige otra hora.' });
    }

    const bookingId = crypto.randomUUID();
    await appendBooking({
      bookingId,
      createdAt: new Date().toISOString(),
      status: 'confirmed',
      name: bono.clientName,
      phone: bono.clientPhone,
      email: bono.clientEmail,
      serviceId: bono.serviceId,
      serviceName: `${service.name} (${sessionLabel})`,
      employeeId,
      employeeName: employee.name,
      calendarId: employee.calendarId,
      eventId: newEventId,
      date, time,
      durationMinutes,
      price: '',
      amountPaid: 0,
      paymentType: 'bono',
      paymentIntentId: '',
      lang: bono.lang || 'es',
      reminderSent: '',
      birthdate: '',
      bonoId,
      sessionNumber: fromSession,
      notes: '',
    });

    const sessionsRemaining = remaining - 1;
    await updateSessionBonoRow(bono._sheetRow, bono, {
      sessionsUsed: fromSession,
      sessionsRemaining,
      status: sessionsRemaining <= 0 ? 'completed' : 'active',
    });

    res.json({ ok: true, bookingId, date, time });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo reservar la sesión.' });
  }
});

// ── Cancelar ──
router.post('/my-bookings/cancel', async (req, res) => {
  const { bookingId, phone, email } = req.body || {};
  if (!bookingId || !phone || !email) {
    return res.status(400).json({ error: 'Faltan datos para cancelar la reserva.' });
  }
  try {
    // Dos cancelaciones casi simultáneas de la misma cita (doble clic, dos
    // pestañas) podrían leer status="confirmed" las dos antes de que
    // ninguna escriba, y las dos intentar reembolsar — el bloqueo serializa
    // las peticiones sobre la misma cita.
    return await withLock(`booking:${bookingId}`, async () => {
    const booking = await findBookingById(bookingId);
    if (!booking || !isOwner(booking, phone, email)) {
      return res.status(404).json({ error: 'No se ha encontrado esa reserva con esos datos.' });
    }
    if (booking.status !== 'confirmed') {
      return res.status(409).json({ error: 'Esta reserva ya no está activa.' });
    }
    const hrs = hoursUntil(booking);
    if (hrs < 0) {
      return res.status(409).json({ error: 'Esta cita ya ha pasado.' });
    }

    const eligibleForRefund = hrs >= FREE_CANCEL_HOURS;
    const hadOnlinePayment = !!booking.paymentIntentId && Number(booking.amountPaid) > 0;
    let refunded = false;
    // 'not_eligible' | 'nothing_to_refund' | 'failed' | 'refunded' — el
    // frontend usa esto para no decir "menos de 48h" cuando en realidad sí
    // se avisó con tiempo pero el reembolso automático falló por otro motivo
    // (p.ej. el pago se hizo con una cuenta de Stripe que ya no es la activa).
    let refundStatus = 'not_eligible';
    if (eligibleForRefund) {
      refundStatus = hadOnlinePayment ? 'failed' : 'nothing_to_refund'; // se corrige abajo si el reembolso sale bien
      if (hadOnlinePayment) {
        try {
          // Reembolsamos solo lo que esta fila dice haber cobrado online —
          // el payment_intent puede cubrir VARIOS tratamientos comprados
          // juntos (p.ej. un bono + un tratamiento suelto en la misma
          // compra), y reembolsar sin importe devolvería la compra entera.
          await refundPayment(booking.paymentIntentId, Number(booking.amountPaid));
          refunded = true;
          refundStatus = 'refunded';
        } catch (refundErr) {
          console.error('Error al reembolsar:', refundErr);
          // Seguimos cancelando la cita aunque el reembolso falle — avisamos
          // al salón por email para que lo resuelva a mano cuanto antes, en
          // vez de que se quede solo en el log del servidor.
          sendEmail({
            to: SALON_EMAIL,
            subject: `⚠️ Reembolso automático fallido — ${booking.name || 'clienta'}`,
            html: `<p><strong>${escapeHtml(booking.name || '')}</strong> (${escapeHtml(booking.phone || '')}) ha cancelado su cita de <strong>${escapeHtml(booking.serviceName || '')}</strong> del ${booking.date} a las ${booking.time} con más de 48h de antelación, así que le corresponde reembolso — pero el reembolso automático de <strong>${Number(booking.amountPaid).toFixed(2)} €</strong> ha fallado.</p><p>Hay que reembolsarlo a mano desde Stripe (revisa si el pago se hizo con la cuenta de Stripe antigua). Motivo del fallo: ${escapeHtml(refundErr.message || '')}</p>`,
          }).catch((e) => console.error('No se pudo avisar del fallo de reembolso:', e));
        }
      }
    }

    if (booking.calendarId && booking.eventId) {
      const allBookings = await getAllBookings();
      // Si otro tratamiento de la misma cita sigue activo, no borramos el
      // evento compartido — solo se borra cuando este era el último.
      if (!hasOtherActiveBookingsOnSameEvent(booking, allBookings)) {
        await deleteEvent(booking.calendarId, booking.eventId);
      }
    }

    // Si es la sesión de un bono y avisó con tiempo suficiente, le
    // devolvemos la sesión — no la ha disfrutado, así que no debería
    // perderla (igual que un no-show con antelación no debería costarle
    // dinero, cancelar con tiempo no debería costarle una sesión).
    if (booking.bonoId && eligibleForRefund) {
      const bono = await findSessionBonoById(booking.bonoId);
      if (bono) {
        const sessionsUsed = Math.max(0, (Number(bono.sessionsUsed) || 0) - 1);
        const sessionsRemaining = (Number(bono.sessionsRemaining) || 0) + 1;
        await updateSessionBonoRow(bono._sheetRow, bono, {
          sessionsUsed,
          sessionsRemaining,
          status: 'active',
        });
      }
    }

    await updateBookingRow(booking._sheetRow, booking, {
      status: refunded ? 'cancelled_refunded' : 'cancelled_no_refund',
    });

    res.json({ ok: true, refunded, refundStatus, amountRefunded: refunded ? Number(booking.amountPaid) : 0 });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudo cancelar la reserva.' });
  }
});

// ── Reprogramar (opcionalmente con otra profesional, si "newEmployeeId"
// viene y es distinta de la actual — p.ej. la clienta prefiere adelantar
// la cita y le da igual quién se la haga) ──
router.post('/my-bookings/reschedule', async (req, res) => {
  const { bookingId, phone, email, newDate, newTime, newEmployeeId } = req.body || {};
  if (!bookingId || !phone || !email || !newDate || !newTime) {
    return res.status(400).json({ error: 'Faltan datos para reprogramar la reserva.' });
  }
  try {
    // Evita que esta reprogramación se pise con un cierre/edición/cancelación
    // casi simultánea de la misma cita desde el panel (o desde esta misma
    // pantalla en dos pestañas).
    return await withLock(`booking:${bookingId}`, async () => {
    const booking = await findBookingById(bookingId);
    if (!booking || !isOwner(booking, phone, email)) {
      return res.status(404).json({ error: 'No se ha encontrado esa reserva con esos datos.' });
    }
    const forgiven = booking.status === 'no_show_forgiven';
    if (booking.status !== 'confirmed' && !forgiven) {
      return res.status(409).json({ error: 'Esta reserva ya no está activa.' });
    }
    // La ausencia perdonada la 1ª vez ya es de una fecha pasada por
    // definición — la condición de "avisar con 48h" no aplica, solo a
    // citas que todavía no han pasado.
    //
    // Reprogramar con menos de 48h ya no se bloquea del todo — se deja
    // hacer, pero cuenta como una falta (mismo contador que un no-show,
    // ver /panel/no-show): la 1ª vez se perdona sin más, a partir de la 2ª
    // queda registrada. No afecta a ningún bono (no se pierde ninguna
    // sesión — la cita simplemente cambia de hora), solo al historial de
    // faltas de la clienta, que si ya tenía una falta anterior deja de
    // perdonarle la siguiente ausencia/aviso tardío de verdad.
    let lateStrike = null;
    if (!forgiven) {
      const hrs = hoursUntil(booking);
      if (hrs < FREE_CANCEL_HOURS) {
        const phoneN = normalizePhone(phone);
        const emailN = normalizeEmail(email);
        const allStrikes = await getAllStrikeRecords();
        const existing = allStrikes.find((s) => s.phoneNormalized === phoneN || (emailN && s.emailNormalized === emailN));
        const isFirstTime = !existing || Number(existing.strikeCount) === 0;
        await upsertStrikeRecord({
          phoneNormalized: phoneN, emailNormalized: emailN, name: booking.name,
          strikeCount: isFirstTime ? 1 : (Number(existing.strikeCount) || 0) + 1,
          lastStrikeDate: new Date().toISOString().slice(0, 10),
        }, existing);
        lateStrike = { isFirstTime };
      }
    }

    const daysAhead = Math.floor((new Date(`${newDate}T12:00:00Z`) - new Date()) / 86400000);
    if (daysAhead < 0 || daysAhead > hours.bookingWindowDays) {
      return res.status(400).json({ error: 'Esa fecha no está disponible para reservar.' });
    }

    let targetEmployee = employees.find((e) => e.id === booking.employeeId);
    const changingEmployee = !!newEmployeeId && newEmployeeId !== booking.employeeId;
    if (changingEmployee) {
      const candidate = employees.find((e) => e.id === newEmployeeId);
      if (!candidate || !canDo(candidate, booking.serviceId)) {
        return res.status(400).json({ error: 'Esa profesional no puede realizar este tratamiento.' });
      }
      targetEmployee = candidate;
    }
    if (!targetEmployee) return res.status(404).json({ error: 'No se ha encontrado la profesional de esta cita.' });

    const duration = Number(booking.durationMinutes) || 60;
    const freeSlots = await getAvailableSlots(newDate, targetEmployee.calendarId, duration, targetEmployee.weekly);
    if (!freeSlots.includes(newTime)) {
      return res.status(409).json({ error: 'Ese hueco ya no está disponible. Elige otra hora.' });
    }

    const startISO = localToISO(newDate, newTime.length === 5 ? newTime : `${newTime}:00`, hours.timezone);
    const endISO = addMinutes(startISO, duration);

    // Si otro tratamiento de la misma cita sigue activo y comparte este
    // evento, no podemos parchear el evento compartido — se movería la
    // cita entera para esos otros tratamientos sin actualizar sus filas.
    // En ese caso (o si el evento original ya no es usable, p.ej. quedó
    // "cancelado" en Google tras un borrado anterior) creamos un evento
    // nuevo solo para este tratamiento. Si además cambia de profesional, el
    // evento tiene que pasar de calendario — eso no se puede "mover" con un
    // simple update, así que directamente se borra el de la profesional
    // antigua (si no queda ningún otro tratamiento activo en él) y se crea
    // uno nuevo en el calendario de la profesional nueva.
    const allBookingsForCheck = await getAllBookings();
    const hasActiveSiblings = hasOtherActiveBookingsOnSameEvent(booking, allBookingsForCheck);
    let newEventId = booking.eventId;
    if (changingEmployee) {
      if (!hasActiveSiblings && booking.calendarId && booking.eventId) {
        await deleteEvent(booking.calendarId, booking.eventId).catch(() => {}); // no bloquear si ya no existía
      }
      const event = await createBookingEvent(targetEmployee.calendarId, {
        summary: booking.serviceName || 'Cita Osana',
        description: `Clienta: ${booking.name || ''} · ${booking.phone || ''}`,
        startISO, endISO,
      });
      newEventId = event.id;
    } else if (!hasActiveSiblings && await isEventUsable(booking.calendarId, booking.eventId)) {
      await updateEvent(booking.calendarId, booking.eventId, {
        start: { dateTime: startISO },
        end: { dateTime: endISO },
      });
    } else {
      const event = await createBookingEvent(booking.calendarId, {
        summary: booking.serviceName || 'Cita Osana',
        description: `Clienta: ${booking.name || ''} · ${booking.phone || ''}`,
        startISO, endISO,
      });
      newEventId = event.id;
    }

    await updateBookingRow(booking._sheetRow, booking, {
      date: newDate, time: newTime, eventId: newEventId,
      ...(changingEmployee ? { employeeId: targetEmployee.id, employeeName: targetEmployee.name, calendarId: targetEmployee.calendarId } : {}),
      // Una ausencia perdonada vuelve a ser una cita normal en cuanto se le
      // pone nueva fecha — ya cumplió su papel de "comodín".
      ...(forgiven ? { status: 'confirmed' } : {}),
    });

    res.json({ ok: true, date: newDate, time: newTime, employeeId: targetEmployee.id, employeeName: targetEmployee.name, lateStrike });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudo reprogramar la reserva.' });
  }
});

module.exports = router;
