const express = require('express');
const { getAllBookings, findBookingById, updateBookingRow, getLoyaltyMovementsForPhone } = require('../lib/sheets');
const { deleteEvent, updateEvent } = require('../lib/googleCalendar');
const { refundPayment } = require('../lib/stripeClient');
const { getAvailableSlots } = require('../lib/availability');
const { localToISO, addMinutes } = require('../lib/timezone');
const hours = require('../config/hours');
const employees = require('../config/employees');
const { normalizePhone, normalizeEmail } = require('../lib/clientId');
const { computeLoyaltyBalance } = require('../config/loyalty');
const { sendEmail } = require('../lib/email');
const { hasOtherActiveBookingsOnSameEvent } = require('../lib/sharedCalendarEvent');

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
    canCancelFree: hrs >= FREE_CANCEL_HOURS,
    canReschedule: hrs >= FREE_CANCEL_HOURS,
  };
}

// ── Listar reservas futuras de un cliente ──
router.get('/my-bookings', async (req, res) => {
  const { phone, email } = req.query;
  if (!phone || !email) {
    return res.status(400).json({ error: 'Introduce tu teléfono y tu email para buscar tus reservas.' });
  }
  try {
    const all = await getAllBookings();
    const now = Date.now();
    const mine = all.filter((b) => (
      b.status === 'confirmed'
      && isOwner(b, phone, email)
      && appointmentDateTime(b).getTime() > now
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
      b.status !== '' // solo filas reales
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
          await refundPayment(booking.paymentIntentId);
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

    await updateBookingRow(booking._sheetRow, booking, {
      status: refunded ? 'cancelled_refunded' : 'cancelled_no_refund',
    });

    res.json({ ok: true, refunded, refundStatus, amountRefunded: refunded ? Number(booking.amountPaid) : 0 });
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
    const booking = await findBookingById(bookingId);
    if (!booking || !isOwner(booking, phone, email)) {
      return res.status(404).json({ error: 'No se ha encontrado esa reserva con esos datos.' });
    }
    if (booking.status !== 'confirmed') {
      return res.status(409).json({ error: 'Esta reserva ya no está activa.' });
    }
    const hrs = hoursUntil(booking);
    if (hrs < FREE_CANCEL_HOURS) {
      return res.status(409).json({ error: 'Para reprogramar hace falta avisar con al menos 48h de antelación. Escríbenos por WhatsApp si es más urgente.' });
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

    await updateEvent(booking.calendarId, booking.eventId, {
      start: { dateTime: startISO },
      end: { dateTime: endISO },
    });

    await updateBookingRow(booking._sheetRow, booking, { date: newDate, time: newTime });

    res.json({ ok: true, date: newDate, time: newTime });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudo reprogramar la reserva.' });
  }
});

module.exports = router;
