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
    // Calendar (para las citas) + Sheets (para el registro de "Mis reservas")
    scopes: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/spreadsheets',
    ],
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
async function createBookingEvent(calendarId, { summary, description, startISO, endISO }) {
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
  // No añadimos al cliente como "attendee": los calendarios son cuentas de
  // Gmail personales compartidas con la cuenta de servicio, y Google no
  // deja que una cuenta de servicio invite asistentes sin Domain-Wide
  // Delegation (solo disponible en Google Workspace) — daría un 403. El
  // cliente ya recibe su confirmación por email aparte (ver lib/email.js).
  const res = await calendar.events.insert({
    calendarId,
    requestBody: event,
    sendUpdates: 'none',
  });
  return res.data;
}

async function getEvent(calendarId, eventId) {
  const calendar = getCalendarClient();
  const res = await calendar.events.get({ calendarId, eventId });
  return res.data;
}

// Lista eventos reales (con id, no solo huecos ocupados) en un rango — se usa
// para encontrar el evento de una cita ya existente en el calendario (creada
// a mano) y enlazarla con una reserva dada de alta manualmente en la Sheet.
async function listEvents(calendarId, timeMinISO, timeMaxISO) {
  const calendar = getCalendarClient();
  const res = await calendar.events.list({
    calendarId,
    timeMin: timeMinISO,
    timeMax: timeMaxISO,
    singleEvents: true,
    orderBy: 'startTime',
  });
  return res.data.items || [];
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

// Google no siempre purga un evento borrado al instante — a veces el
// recurso sigue existiendo con status "cancelled" un tiempo, y un PATCH
// sobre él (p.ej. al reprogramar) "tiene éxito" sin volver a bloquear el
// hueco de verdad, porque un evento cancelado no cuenta como ocupado.
// Hay que comprobar esto antes de fiarse de un updateEvent sobre un
// eventId que pudiera venir de una cita cancelada y reutilizada.
async function isEventUsable(calendarId, eventId) {
  if (!eventId) return false;
  try {
    const current = await getEvent(calendarId, eventId);
    return !!current && current.status !== 'cancelled';
  } catch (e) {
    return false;
  }
}

module.exports = { getBusyIntervals, createBookingEvent, getEvent, listEvents, updateEvent, deleteEvent, isEventUsable, getAuth };
