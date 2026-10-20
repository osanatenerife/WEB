const express = require('express');
const services = require('../config/services');
const employees = require('../config/employees');
const extras = require('../config/extras');
const hours = require('../config/hours');
const { parseExtraIds: parseIds } = require('../lib/pricing');
const { normalizePhone, normalizeEmail } = require('../lib/clientId');
const { getAllBookings, appendUnsubscribe } = require('../lib/sheets');

const router = express.Router();

// Lista pública de servicios agrupados por categoría
// ?lang=en / ?lang=it devuelve nombre y categoría en ese idioma (con fallback al español si faltara)
router.get('/services', (req, res) => {
  const { lang } = req.query;
  let list = services;
  if (lang === 'en') {
    list = services.map((s) => ({ ...s, name: s.nameEn || s.name, category: s.categoryEn || s.category, description: s.descriptionEn || s.description }));
  } else if (lang === 'it') {
    list = services.map((s) => ({ ...s, name: s.nameIt || s.name, category: s.categoryIt || s.category, description: s.descriptionIt || s.description }));
  }
  res.json({ services: list });
});

function canDo(employee, serviceId) {
  if (employee.excludedServices && employee.excludedServices.includes(serviceId)) return false;
  return employee.services.length === 0 || employee.services.includes(serviceId);
}

// Lista de empleadas que pueden realizar TODOS los servicios dados
// (si la cita combina varios tratamientos, la profesional tiene que poder con todos)
router.get('/employees', (req, res) => {
  const ids = parseIds(req.query.serviceIds || req.query.serviceId);
  let list = employees;
  if (ids.length) {
    list = employees.filter((e) => ids.every((id) => canDo(e, id)));
  }
  // No exponemos el calendarId al frontend, no hace falta y es un dato interno.
  // "weekly" sí se expone: el calendario de reserva lo usa para marcar sus días libres.
  // "closures" son los cierres puntuales del centro (vacaciones, reformas...), iguales
  // para todas las empleadas, para que el calendario también los tache visualmente.
  res.json({ employees: list.map(({ id, name, weekly }) => ({ id, name, weekly, closures: hours.closures || [] })) });
});

// Comprueba si un teléfono ya tiene alguna reserva en el sistema — solo
// devuelve un booleano, nunca datos de la clienta, se usa en el paso de
// elegir profesional para derivar a las clientas nuevas (sin ninguna
// reserva previa) hacia una profesional concreta en Depilación Láser SHR.
router.get('/client-status', async (req, res) => {
  const target = normalizePhone(req.query.phone);
  if (!target) return res.json({ isNew: true });
  try {
    const all = await getAllBookings();
    const isNew = !all.some((b) => normalizePhone(b.phone) === target);
    res.json({ isNew });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo comprobar el teléfono.' });
  }
});

// Baja de emails comerciales (newsletter/campañas) — enlace que se manda
// en el pie de esos emails, obligatorio por ley (LSSI-CE). No requiere
// confirmación aparte ni login: un solo clic desde el email ya da de baja,
// que es lo que se espera de este tipo de enlace. Los emails
// transaccionales (confirmación de cita, recordatorios, pagos) no miran
// esta lista, solo los de campaña/cumpleaños.
const UNSUB_PAGE_STRINGS = {
  es: { title: 'Baja confirmada', body: 'No volverás a recibir emails de publicidad de Osana. Seguirás recibiendo los avisos de tus propias citas (confirmaciones, recordatorios).', missing: 'Falta el email.', error: 'No se pudo procesar la baja — escríbenos por WhatsApp.' },
  en: { title: 'Unsubscribed', body: "You won't receive any more marketing emails from Osana. You'll still get your own appointment notices (confirmations, reminders).", missing: 'Missing email.', error: 'Could not process the unsubscribe — message us on WhatsApp.' },
  it: { title: 'Disiscrizione confermata', body: 'Non riceverai più email pubblicitarie da Osana. Continuerai a ricevere gli avvisi dei tuoi appuntamenti (conferme, promemoria).', missing: 'Email mancante.', error: 'Non è stato possibile completare la disiscrizione — scrivici su WhatsApp.' },
};
function unsubPageHtml(lang, text) {
  const t = UNSUB_PAGE_STRINGS[lang] || UNSUB_PAGE_STRINGS.es;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${t.title}</title></head>
    <body style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:70px auto;text-align:center;color:#1a1612;padding:0 20px;">
      <h1 style="font-size:20px;">${t.title}</h1>
      <p style="font-size:14px;line-height:1.6;color:#4a4238;">${text || t.body}</p>
    </body></html>`;
}
router.get('/unsubscribe', async (req, res) => {
  const lang = ['en', 'it'].includes(req.query.lang) ? req.query.lang : 'es';
  const email = normalizeEmail(req.query.email);
  if (!email) return res.status(400).send(unsubPageHtml(lang, UNSUB_PAGE_STRINGS[lang].missing));
  try {
    await appendUnsubscribe(email);
    res.send(unsubPageHtml(lang));
  } catch (err) {
    console.error(err);
    res.status(500).send(unsubPageHtml(lang, UNSUB_PAGE_STRINGS[lang].error));
  }
});

// Lista de extras que se pueden añadir a los servicios dados (unión, sin duplicados)
router.get('/extras', (req, res) => {
  const { lang } = req.query;
  const ids = parseIds(req.query.serviceIds || req.query.serviceId);
  let list = extras;
  if (ids.length) {
    list = list.filter((e) => e.applicableServices.length === 0 || ids.some((id) => e.applicableServices.includes(id)));
  }
  if (lang === 'en') {
    list = list.map((e) => ({ ...e, name: e.nameEn || e.name }));
  } else if (lang === 'it') {
    list = list.map((e) => ({ ...e, name: e.nameIt || e.name }));
  }
  res.json({ extras: list });
});

module.exports = router;
module.exports.canDo = canDo;
