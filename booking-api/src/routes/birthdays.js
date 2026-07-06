const express = require('express');
const { getAllBookings, getAllBirthdayRecords, upsertBirthdayRecord } = require('../lib/sheets');
const { sendEmail } = require('../lib/email');
const hours = require('../config/hours');

const router = express.Router();

// Código de cupón fijo (creado y gestionado a mano en el Dashboard de
// Stripe, igual que cualquier otra promo) — se usa tal cual en el email.
const BIRTHDAY_PROMO_CODE = process.env.BIRTHDAY_PROMO_CODE || 'CUMPLEOSANA15';

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.slice(-9);
}
function normalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

const EMAIL_STRINGS = {
  es: {
    subject: '¡Feliz cumpleaños! 🎂 Un regalo de Osana para ti',
    body: (name, year) => `
      <p>Hola ${name || ''},</p>
      <p>¡Desde Osana te deseamos un muy feliz cumpleaños! 🎉</p>
      <p>Como regalo, tienes un <strong>15% de descuento</strong> en tu próxima reserva durante todo este mes. Solo tienes que introducir este código al pagar:</p>
      <p style="font-size:20px;font-weight:700;letter-spacing:2px;margin:16px 0;">${BIRTHDAY_PROMO_CODE}</p>
      <p><a href="https://osana.es/reserva.html">Reserva tu cita aquí</a>.</p>
      <p>¡Te esperamos para celebrarlo contigo!<br>Osana</p>
    `,
  },
  en: {
    subject: 'Happy birthday! 🎂 A gift from Osana',
    body: (name, year) => `
      <p>Hi ${name || ''},</p>
      <p>The whole Osana team wishes you a very happy birthday! 🎉</p>
      <p>As a gift, enjoy a <strong>15% discount</strong> on your next booking this month. Just enter this code at checkout:</p>
      <p style="font-size:20px;font-weight:700;letter-spacing:2px;margin:16px 0;">${BIRTHDAY_PROMO_CODE}</p>
      <p><a href="https://osana.es/en/reserva.html">Book your appointment here</a>.</p>
      <p>We'd love to celebrate with you!<br>Osana</p>
    `,
  },
};

router.get('/send-birthday-emails', async (req, res) => {
  const expected = process.env.REMINDER_CRON_SECRET;
  if (!expected || req.query.secret !== expected) {
    return res.status(403).json({ error: 'No autorizado' });
  }

  try {
    const todayLabel = new Intl.DateTimeFormat('en-CA', {
      timeZone: hours.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    const [todayYear, todayMonth, todayDay] = todayLabel.split('-');

    const allBookings = await getAllBookings();
    const candidates = allBookings.filter((b) => {
      if (!b.birthdate || !b.email || !b.phone) return false;
      const parts = String(b.birthdate).split('-');
      return parts.length === 3 && parts[1] === todayMonth && parts[2] === todayDay;
    });

    // Un cliente puede tener varias reservas — nos quedamos con una fila por persona
    const uniqueClients = new Map();
    candidates.forEach((b) => {
      const key = `${normalizeEmail(b.email)}|${normalizePhone(b.phone)}`;
      if (!uniqueClients.has(key)) uniqueClients.set(key, b);
    });

    const birthdayRecords = await getAllBirthdayRecords();

    let sent = 0;
    const errors = [];
    for (const [key, b] of uniqueClients) {
      const existing = birthdayRecords.find((r) => `${r.emailNormalized}|${r.phoneNormalized}` === key);
      if (existing && existing.lastSentYear === todayYear) continue; // ya felicitado este año

      const lang = b.lang === 'en' ? 'en' : 'es';
      const strings = EMAIL_STRINGS[lang];
      try {
        await sendEmail({
          to: b.email,
          subject: strings.subject,
          html: strings.body(b.name, todayYear),
        });
        await upsertBirthdayRecord({
          emailNormalized: normalizeEmail(b.email),
          phoneNormalized: normalizePhone(b.phone),
          name: b.name || '',
          birthdate: b.birthdate,
          lastSentYear: todayYear,
        }, existing);
        sent++;
      } catch (err) {
        console.error(`Error enviando email de cumpleaños a ${b.email}:`, err.message);
        errors.push({ email: b.email, error: err.message });
      }
    }

    res.json({ checked: allBookings.length, matches: uniqueClients.size, sent, errors });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudieron enviar los emails de cumpleaños.' });
  }
});

module.exports = router;
