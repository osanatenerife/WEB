const express = require('express');
const { getAllBookings, updateBookingRow } = require('../lib/sheets');
const { sendEmail } = require('../lib/email');
const { localToISO } = require('../lib/timezone');
const hours = require('../config/hours');

const router = express.Router();

// Ventana de antelación objetivo: entre 23h y 25h antes de la cita.
// Como el disparador externo llama a este endpoint cada hora, esta
// ventana de 2h asegura que ninguna cita se quede sin recordatorio
// aunque el disparo llegue con algo de retraso.
const WINDOW_MIN_HOURS = 23;
const WINDOW_MAX_HOURS = 25;

function appointmentDateTime(booking) {
  const time = booking.time.length === 5 ? booking.time : `${booking.time}:00`;
  return new Date(localToISO(booking.date, time, hours.timezone));
}

const EMAIL_STRINGS = {
  es: {
    subject: 'Recordatorio: tu cita en Osana es mañana',
    greeting: (name) => `Hola ${name || ''},`.trim(),
    body: (b, dateLabel) => `
      <p>Te recordamos tu cita en <strong>Osana</strong>:</p>
      <p>
        📅 <strong>${dateLabel}</strong> a las <strong>${b.time}</strong><br>
        💆 ${b.serviceName}<br>
        👤 Con ${b.employeeName}
      </p>
      <p>📍 Calle Manuel Bello Ramos, 56, Adeje (Tenerife Sur)</p>
      <p>¿Necesitas cancelar o cambiar la hora? Entra a <a href="https://osana.es/mis-reservas.html">osana.es/mis-reservas.html</a>. Recuerda que si cancelas con menos de 48h de antelación, el importe pagado no se reembolsa.</p>
      <p>¡Te esperamos!<br>Osana</p>
    `,
  },
  en: {
    subject: 'Reminder: your Osana appointment is tomorrow',
    greeting: (name) => `Hi ${name || ''},`.trim(),
    body: (b, dateLabel) => `
      <p>This is a reminder of your appointment at <strong>Osana</strong>:</p>
      <p>
        📅 <strong>${dateLabel}</strong> at <strong>${b.time}</strong><br>
        💆 ${b.serviceName}<br>
        👤 With ${b.employeeName}
      </p>
      <p>📍 Calle Manuel Bello Ramos, 56, Adeje (South Tenerife)</p>
      <p>Need to cancel or change the time? Go to <a href="https://osana.es/en/mis-reservas.html">osana.es/en/mis-reservas.html</a>. Please note that if you cancel less than 48h in advance, the amount paid will not be refunded.</p>
      <p>See you soon!<br>Osana</p>
    `,
  },
};

router.get('/send-reminders', async (req, res) => {
  const expected = process.env.REMINDER_CRON_SECRET;
  if (!expected || req.query.secret !== expected) {
    return res.status(403).json({ error: 'No autorizado' });
  }

  try {
    const all = await getAllBookings();
    const now = Date.now();
    const due = all.filter((b) => {
      if (b.status !== 'confirmed' || !b.email || b.reminderSent === 'sent') return false;
      const hrs = (appointmentDateTime(b).getTime() - now) / 3600000;
      return hrs >= WINDOW_MIN_HOURS && hrs <= WINDOW_MAX_HOURS;
    });

    let sent = 0;
    const errors = [];
    for (const b of due) {
      const lang = b.lang === 'en' ? 'en' : 'es';
      const strings = EMAIL_STRINGS[lang];
      const dateLabel = appointmentDateTime(b).toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', {
        weekday: 'long', day: 'numeric', month: 'long',
      });
      try {
        await sendEmail({
          to: b.email,
          subject: strings.subject,
          html: `<p>${strings.greeting(b.name)}</p>${strings.body(b, dateLabel)}`,
        });
        await updateBookingRow(b._sheetRow, b, { reminderSent: 'sent' });
        sent++;
      } catch (err) {
        console.error(`Error enviando recordatorio a ${b.email}:`, err.message);
        errors.push({ bookingId: b.bookingId, error: err.message });
      }
    }

    res.json({ checked: all.length, due: due.length, sent, errors });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudieron enviar los recordatorios.' });
  }
});

module.exports = router;
