const express = require('express');
const { getAllBookings, updateBookingRow } = require('../lib/sheets');
const { sendEmail } = require('../lib/email');
const { sendWhatsAppTemplate } = require('../lib/whatsapp');
const { localToISO } = require('../lib/timezone');
const { earnRateFor } = require('../config/loyalty');
const hours = require('../config/hours');

const router = express.Router();

// Ventana de antelación objetivo: entre 47h y 49h antes de la cita (48h,
// para que coincida con el plazo real de cancelación sin penalización).
// Como el disparador externo llama a este endpoint cada hora, esta
// ventana de 2h asegura que ninguna cita se quede sin recordatorio
// aunque el disparo llegue con algo de retraso.
const WINDOW_MIN_HOURS = 47;
const WINDOW_MAX_HOURS = 49;

function appointmentDateTime(booking) {
  const time = booking.time.length === 5 ? booking.time : `${booking.time}:00`;
  return new Date(localToISO(booking.date, time, hours.timezone));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Saldo pendiente de pago en el centro, para el recordatorio de WhatsApp.
function pendingBalanceFor(b) {
  const price = Number(b.price) || 0;
  const paid = Number(b.amountPaid) || 0;
  const remainder = Math.max(0, round2(price - paid));
  return remainder > 0
    ? `${remainder.toFixed(2)} € (efectivo o Bizum al 623 725 551)`
    : '0 € — pago ya completado';
}

// Saldo de fidelidad estimado que generará esta reserva (a la tasa base,
// sin contar el +2% de efectivo, que depende de cómo se pague al final).
function estimatedEarnFor(b) {
  const price = Number(b.price) || 0;
  const earned = round2(price * earnRateFor('facial', 'tarjeta'));
  return `${earned.toFixed(2)} €`;
}

const EMAIL_STRINGS = {
  es: {
    subject: 'Recordatorio: tu próxima cita en Osana',
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
    subject: 'Reminder: your upcoming Osana appointment',
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
      // Email y WhatsApp son canales independientes: un fallo en uno (por
      // ejemplo, un email mal configurado) no debe impedir que el otro se
      // intente igualmente.
      let emailOk = true;
      try {
        await sendEmail({
          to: b.email,
          subject: strings.subject,
          html: `<p>${strings.greeting(b.name)}</p>${strings.body(b, dateLabel)}`,
        });
      } catch (emailErr) {
        emailOk = false;
        console.error(`Error enviando email a ${b.email}:`, emailErr.message);
        errors.push({ bookingId: b.bookingId, channel: 'email', error: emailErr.message });
      }
      // El WhatsApp es un extra: si Twilio no está configurado todavía,
      // sendWhatsAppTemplate no hace nada; si falla el envío, no debe
      // impedir que el recordatorio quede marcado como intentado.
      if (b.phone) {
        try {
          await sendWhatsAppTemplate({
            to: b.phone,
            variables: {
              1: b.name || '', 2: dateLabel, 3: b.time, 4: b.serviceName,
              5: pendingBalanceFor(b), 6: estimatedEarnFor(b),
            },
          });
        } catch (waErr) {
          console.error(`Error enviando WhatsApp a ${b.phone}:`, waErr.message);
          errors.push({ bookingId: b.bookingId, channel: 'whatsapp', error: waErr.message });
        }
      }
      try {
        await updateBookingRow(b._sheetRow, b, { reminderSent: 'sent' });
        if (emailOk) sent++;
      } catch (err) {
        console.error(`Error marcando recordatorio como enviado para ${b.bookingId}:`, err.message);
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
