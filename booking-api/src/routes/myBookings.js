const express = require('express');
const { getAllBookings, findBookingById, updateBookingRow } = require('../lib/sheets');
const { deleteEvent, updateEvent } = require('../lib/googleCalendar');
const { refundPayment } = require('../lib/stripeClient');
const { getAvailableSlots } = require('../lib/availability');
const { localToISO, addMinutes } = require('../lib/timezone');
const hours = require('../config/hours');
const employees = require('../config/employees');

function weeklyScheduleFor(booking) {
  const employee = employees.find((e) => e.id === booking.employeeId);
  return employee && employee.weekly;
}

const router = express.Router();

const FREE_CANCEL_HOURS = 24;

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.slice(-9); // compara los últimos 9 dígitos (móvil español), ignora prefijo de país
}
function normalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

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
    res.json({ bookings: mine.map(toPublicBooking) });
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
    let refunded = false;
    if (eligibleForRefund && booking.paymentIntentId && Number(booking.amountPaid) > 0) {
      try {
        await refundPayment(booking.paymentIntentId);
        refunded = true;
      } catch (refundErr) {
        console.error('Error al reembolsar:', refundErr);
        // seguimos cancelando la cita aunque el reembolso falle; se resuelve a mano
      }
    }

    if (booking.calendarId && booking.eventId) {
      await deleteEvent(booking.calendarId, booking.eventId);
    }

    await updateBookingRow(booking._sheetRow, booking, {
      status: refunded ? 'cancelled_refunded' : 'cancelled_no_refund',
    });

    res.json({ ok: true, refunded, amountRefunded: refunded ? Number(booking.amountPaid) : 0 });
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
      return res.status(409).json({ error: 'Para reprogramar hace falta avisar con al menos 24h de antelación. Escríbenos por WhatsApp si es más urgente.' });
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
