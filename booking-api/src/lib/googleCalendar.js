const { google } = require('googleapis');

function loadCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error('Falta la variable de entorno GOOGLE_SERVICE_ACCOUNT_JSON');
  }
  // Admite tanto el JSON tal cual como en base64 (útil si el hosting
  // no acepta bien saltos de línea en variables de entorno).
  try {
    return JSON.parse(raw);
  } catch (e) {
    return JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
  }
}

let cachedAuth = null;
function getAuth() {
  if (cachedAuth) return cachedAuth;
  const credentials = loadCredentials();
  cachedAuth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  return cachedAuth;
}

function getCalendarClient() {
  return google.calendar({ version: 'v3', auth: getAuth() });
}

/**
 * Devuelve los intervalos ocupados de un calendario entre dos fechas ISO.
 * @returns {Promise<Array<{start:string end:string}>>}
 */
async function getBusyIntervals(calendarId, timeMinISO, timeMaxISO) {
  const calendar = getCalendarClient();
  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: timeMinISO,
      timeMax: timeMaxISO,
      items: [{ id: calendarId }],
    },
  });
  const cal = res.data.calendars && res.data.calendars[calendarId];
  if (!cal) return [];
  if (cal.errors && cal.errors.length) {
    throw new Error(
      `No se pudo leer el calendario ${calendarId}. Comprueba que se ha compartido con la cuenta de servicio (ver SETUP.md).`
    );
  }
  return cal.busy || [];
}

/**
 * Crea el evento de la cita en el calendario de la empleada.
 */
async function createBookingEvent(calendarId, { summary, description, startISO, endISO, clientEmail, clientName }) {
  const calendar = getCalendarClient();
  const event = {
    summary,
    description,
    start: { dateTime: startISO },
    end: { dateTime: endISO },
    extendedProperties: {
      private: { osanaBooking: 'true' },
    },
  };
  // Añadimos al cliente como asistente solo si nos dio email
  // (no obligatorio: crear invitados requiere permisos de invitados
  // en el calendario, así que lo dejamos opcional y en description igual).
  if (clientEmail) {
    event.attendees = [{ email: clientEmail, displayName: clientName }];
  }
  const res = await calendar.events.insert({
    calendarId,
    requestBody: event,
    sendUpdates: clientEmail ? 'all' : 'none',
  });
  return res.data;
}

async function getEvent(calendarId, eventId) {
  const calendar = getCalendarClient();
  const res = await calendar.events.get({ calendarId, eventId });
  return res.data;
}

async function updateEvent(calendarId, eventId, patch) {
  const calendar = getCalendarClient();
  const res = await calendar.events.patch({ calendarId, eventId, requestBody: patch });
  return res.data;
}

async function deleteEvent(calendarId, eventId) {
  const calendar = getCalendarClient();
  try {
    await calendar.events.delete({ calendarId, eventId });
  } catch (e) {
    // Si ya no existe (por ejemplo, borrado a mano), no pasa nada.
    if (e.code !== 410 && e.code !== 404) throw e;
  }
}

module.exports = { getBusyIntervals, createBookingEvent, getEvent, updateEvent, deleteEvent };
