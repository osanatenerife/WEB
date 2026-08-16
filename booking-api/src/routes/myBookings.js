const express = require('express');
const { getAllBookings, findBookingById, updateBookingRow, getLoyaltyMovementsForPhone, findSessionBonoById, updateSessionBonoRow } = require('../lib/sheets');
const { deleteEvent, updateEvent, createBookingEvent, isEventUsable } = require('../lib/googleCalendar');
const { refundPayment } = require('../lib/stripeClient');
const { getAvailableSlots } = require('../lib/availability');
const { localToISO, addMinutes } = require('../lib/timezone');
const hours = require('../config/hours');
const employees = require('../config/employees');
const { normalizePhone, normalizeEmail } = require('../lib/clientId');
const { computeLoyaltyBalance } = require('../config/loyalty');
const { sendEmail } = require('../lib/email');
const { hasOtherActiveBookingsOnSameEvent } = require('../lib/sharedCalendarEvent');
const { withLock } = require('../lib/asyncLock');

const SALON_EMAIL = process.env.GIFT_NOTIFY_EMAIL || 'osanatenerife@gmail.com';

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function weeklyScheduleFor(booking) {
  const employee = employees.find((e) => e.id === booking.employeeId);
  return employee && employee.weekly;
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

function toPublicBooking(b) {
  const hrs = hoursUntil(b);
  const forgiven = b.status === 'no_show_forgiven';
  return {
    bookingId: b.bookingId,
    serviceName: b.serviceName,
    employeeName: b.employeeName,
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
    const all = await getAllBookings();
    const now = Date.now();
    const mine = all.filter((b) => (
      isOwner(b, phone, email)
      && (
        (b.status === 'confirmed' && appointmentDateTime(b).getTime() > now)
        || b.status === 'no_show_forgiven'
      )
    ));
    mine.sort((a, b) => appointmentDateTime(a) - appointmentDateTime(b));

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

    res.json({ bookings: mine.map(toPublicBooking), loyaltyBalance, loyaltyHistory });
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
    ));
    past.sort((a, b) => appointmentDateTime(b) - appointmentDateTime(a)); // más reciente primero
    res.json({
      bookings: past.map((b) => ({
        serviceName: b.serviceName,
        employeeName: b.employeeName,
        date: b.date,
        time: b.time,
        price: Number(b.price) || 0,
        status: b.status,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudo consultar tu historial.' });
  }
});

// ── Huecos libres para reprogramar (misma duración y profesional de la reserva original) ──
router.get('/my-bookings/slots', async (req, res) => {
  const { bookingId, phone, email, date } = req.query;
  if (!bookingId || !phone || !email || !date) {
    return res.status(400).json({ error: 'Faltan datos para consultar huecos.' });
  }
  try {
    const booking = await findBookingById(bookingId);
    if (!booking || !isOwner(booking, phone, email)) {
      return res.status(404).json({ error: 'No se ha encontrado esa reserva con esos datos.' });
    }
    const duration = Number(booking.durationMinutes) || 60;
    const slots = await getAvailableSlots(date, booking.calendarId, duration, weeklyScheduleFor(booking));
    res.json({ slots });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudo consultar la disponibilidad.' });
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

// ── Reprogramar ──
router.post('/my-bookings/reschedule', async (req, res) => {
  const { bookingId, phone, email, newDate, newTime } = req.body || {};
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
    if (!forgiven) {
      const hrs = hoursUntil(booking);
      if (hrs < FREE_CANCEL_HOURS) {
        return res.status(409).json({ error: 'Para reprogramar hace falta avisar con al menos 48h de antelación. Escríbenos por WhatsApp si es más urgente.' });
      }
    }

    const daysAhead = Math.floor((new Date(`${newDate}T12:00:00Z`) - new Date()) / 86400000);
    if (daysAhead < 0 || daysAhead > hours.bookingWindowDays) {
      return res.status(400).json({ error: 'Esa fecha no está disponible para reservar.' });
    }

    const duration = Number(booking.durationMinutes) || 60;
    const freeSlots = await getAvailableSlots(newDate, booking.calendarId, duration, weeklyScheduleFor(booking));
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
    // nuevo solo para este tratamiento.
    const allBookingsForCheck = await getAllBookings();
    const hasActiveSiblings = hasOtherActiveBookingsOnSameEvent(booking, allBookingsForCheck);
    let newEventId = booking.eventId;
    if (!hasActiveSiblings && await isEventUsable(booking.calendarId, booking.eventId)) {
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
      // Una ausencia perdonada vuelve a ser una cita normal en cuanto se le
      // pone nueva fecha — ya cumplió su papel de "comodín".
      ...(forgiven ? { status: 'confirmed' } : {}),
    });

    res.json({ ok: true, date: newDate, time: newTime });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudo reprogramar la reserva.' });
  }
});

module.exports = router;
