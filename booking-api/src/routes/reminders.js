const express = require('express');
const { getAllBookings, updateBookingRow } = require('../lib/sheets');
const { sendEmail } = require('../lib/email');
const { sendWhatsAppTemplate } = require('../lib/whatsapp');
const { localToISO } = require('../lib/timezone');
const hours = require('../config/hours');

const router = express.Router();

// Ventana real: recordatorio entre 47 y 49h antes de la cita (~48h).
const WINDOW_MIN_HOURS = 47;
const WINDOW_MAX_HOURS = 49;

function appointmentDateTime(booking) {
  const time = booking.time.length === 5 ? booking.time : `${booking.time}:00`;
  return new Date(localToISO(booking.date, time, hours.timezone));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Varios tratamientos reservados juntos en la misma visita (p.ej. íntimo +
// axilas + piernas) comparten el mismo evento de Google Calendar, pero son
// filas independientes en la Sheet — sin agrupar, cada una mandaba su
// propio recordatorio (2-3 emails/WhatsApp casi idénticos para UNA sola
// cita) y el importe pendiente que mostraba cada uno era solo el de esa
// línea, no el total real que queda por cobrar en esa visita.
function groupKey(b) {
  return (b.calendarId && b.eventId) ? `${b.calendarId}|${b.eventId}` : `solo:${b.bookingId}`;
}

// Saldo pendiente de pago en el centro para TODA la visita (suma de las
// líneas del grupo), para el recordatorio de WhatsApp.
function pendingBalanceFor(group) {
  const total = group.reduce((sum, b) => sum + (Number(b.price) || 0), 0);
  const paid = group.reduce((sum, b) => sum + (Number(b.amountPaid) || 0), 0);
  const remainder = Math.max(0, round2(total - paid));
  return `${remainder.toFixed(2)} €`;
}

function serviceNamesFor(group) {
  return group.map((b) => b.serviceName).filter(Boolean).join(' + ');
}

const EMAIL_STRINGS = {
  es: {
    subject: 'Recordatorio: tu próxima cita en Osana',
    greeting: (name) => `Hola ${name || ''},`.trim(),
    body: (group, dateLabel) => {
      const pending = pendingBalanceFor(group);
      return `
      <p>Te recordamos tu cita en <strong>Osana</strong>:</p>
      <p>
        📅 <strong>${dateLabel}</strong> a las <strong>${group[0].time}</strong><br>
        💆 ${serviceNamesFor(group)}<br>
        👤 Con ${group[0].employeeName}
      </p>
      <p>💶 Importe pendiente de pago en el centro: <strong>${pending}</strong></p>
      <p>📍 Calle Manuel Bello Ramos, 56, Adeje (Tenerife Sur)</p>
      <p>¿Necesitas cancelar o cambiar la hora? Entra a <a href="https://osana.es/mis-reservas.html">osana.es/mis-reservas.html</a>. Recuerda que si cancelas con menos de 48h de antelación, el importe pagado no se reembolsa.</p>
      <p>¡Te esperamos!<br>Osana</p>
    `;
    },
  },
  en: {
    subject: 'Reminder: your upcoming Osana appointment',
    greeting: (name) => `Hi ${name || ''},`.trim(),
    body: (group, dateLabel) => {
      const pending = pendingBalanceFor(group);
      return `
      <p>This is a reminder of your appointment at <strong>Osana</strong>:</p>
      <p>
        📅 <strong>${dateLabel}</strong> at <strong>${group[0].time}</strong><br>
        💆 ${serviceNamesFor(group)}<br>
        👤 With ${group[0].employeeName}
      </p>
      <p>💶 Amount pending at the centre: <strong>${pending}</strong></p>
      <p>📍 Calle Manuel Bello Ramos, 56, Adeje (South Tenerife)</p>
      <p>Need to cancel or change the time? Go to <a href="https://osana.es/en/mis-reservas.html">osana.es/en/mis-reservas.html</a>. Please note that if you cancel less than 48h in advance, the amount paid will not be refunded.</p>
      <p>See you soon!<br>Osana</p>
    `;
    },
  },
  it: {
    subject: 'Promemoria: il tuo prossimo appuntamento da Osana',
    greeting: (name) => `Ciao ${name || ''},`.trim(),
    body: (group, dateLabel) => {
      const pending = pendingBalanceFor(group);
      return `
      <p>Ti ricordiamo il tuo appuntamento da <strong>Osana</strong>:</p>
      <p>
        📅 <strong>${dateLabel}</strong> alle <strong>${group[0].time}</strong><br>
        💆 ${serviceNamesFor(group)}<br>
        👤 Con ${group[0].employeeName}
      </p>
      <p>💶 Importo da saldare in centro: <strong>${pending}</strong></p>
      <p>📍 Calle Manuel Bello Ramos, 56, Adeje (Tenerife Sud)</p>
      <p>Devi cancellare o cambiare l'orario? Vai su <a href="https://osana.es/it/mis-reservas.html">osana.es/it/mis-reservas.html</a>. Ricorda che se cancelli con meno di 48h di anticipo, l'importo pagato non viene rimborsato.</p>
      <p>A presto!<br>Osana</p>
    `;
    },
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

    const groupsMap = new Map();
    all.filter((b) => b.status === 'confirmed' && b.email).forEach((b) => {
      const key = groupKey(b);
      if (!groupsMap.has(key)) groupsMap.set(key, []);
      groupsMap.get(key).push(b);
    });

    // Un grupo está "pendiente" si le toca (está en la ventana de 47-49h) y
    // le queda al menos una línea sin recordatorio enviado (por si un envío
    // anterior falló a medias). Todas las líneas de un mismo grupo comparten
    // fecha/hora, así que basta con mirar la primera para calcular cuánto
    // falta para la cita.
    const dueGroups = Array.from(groupsMap.values()).filter((group) => {
      const hrs = (appointmentDateTime(group[0]).getTime() - now) / 3600000;
      return hrs >= WINDOW_MIN_HOURS && hrs <= WINDOW_MAX_HOURS && group.some((b) => b.reminderSent !== 'sent');
    });

    let sent = 0;
    const errors = [];
    for (const group of dueGroups) {
      const first = group[0];
      const lang = first.lang === 'en' ? 'en' : first.lang === 'it' ? 'it' : 'es';
      const strings = EMAIL_STRINGS[lang];
      const locale = lang === 'en' ? 'en-GB' : lang === 'it' ? 'it-IT' : 'es-ES';
      const dateLabel = appointmentDateTime(first).toLocaleDateString(locale, {
        weekday: 'long', day: 'numeric', month: 'long',
      });
      // Email y WhatsApp son canales independientes: un fallo en uno (por
      // ejemplo, un email mal configurado) no debe impedir que el otro se
      // intente igualmente.
      let emailOk = true;
      try {
        await sendEmail({
          to: first.email,
          subject: strings.subject,
          html: `<p>${strings.greeting(first.name)}</p>${strings.body(group, dateLabel)}`,
        });
      } catch (emailErr) {
        emailOk = false;
        console.error(`Error enviando email a ${first.email}:`, emailErr.message);
        errors.push({ bookingIds: group.map((b) => b.bookingId), channel: 'email', error: emailErr.message });
      }
      // El WhatsApp es un extra: si Twilio no está configurado todavía,
      // sendWhatsAppTemplate no hace nada; si falla el envío, no debe
      // impedir que el recordatorio quede marcado como intentado.
      if (first.phone) {
        try {
          await sendWhatsAppTemplate({
            to: first.phone,
            variables: {
              1: first.name || '', 2: dateLabel, 3: first.time, 4: serviceNamesFor(group),
              5: pendingBalanceFor(group),
            },
          });
        } catch (waErr) {
          console.error(`Error enviando WhatsApp a ${first.phone}:`, waErr.message);
          errors.push({ bookingIds: group.map((b) => b.bookingId), channel: 'whatsapp', error: waErr.message });
        }
      }
      for (const b of group) {
        try {
          await updateBookingRow(b._sheetRow, b, { reminderSent: 'sent' });
        } catch (err) {
          console.error(`Error marcando recordatorio como enviado para ${b.bookingId}:`, err.message);
          errors.push({ bookingId: b.bookingId, error: err.message });
        }
      }
      if (emailOk) sent++;
    }

    res.json({ checked: all.length, due: dueGroups.length, sent, errors });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudieron enviar los recordatorios.' });
  }
});

// ── Prueba manual: manda la plantilla de recordatorio ya mismo a un
// teléfono concreto, sin esperar a que una cita real entre en la ventana
// de 47-49h — solo para verificar que Twilio/WhatsApp están bien
// configurados (nuevo número, plantilla aprobada...) antes de confiar en
// el envío automático.
router.get('/test-whatsapp', async (req, res) => {
  const expected = process.env.REMINDER_CRON_SECRET;
  if (!expected || req.query.secret !== expected) {
    return res.status(403).json({ error: 'No autorizado' });
  }
  if (!req.query.phone) {
    return res.status(400).json({ error: 'Indica ?phone=612345678' });
  }
  try {
    const data = await sendWhatsAppTemplate({
      to: req.query.phone,
      variables: { 1: 'Prueba', 2: 'hoy', 3: '12:00', 4: 'Mensaje de prueba', 5: '0.00 €' },
    });
    res.json({ ok: true, sid: data.sid, status: data.status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudo enviar el WhatsApp de prueba.' });
  }
});

module.exports = router;
