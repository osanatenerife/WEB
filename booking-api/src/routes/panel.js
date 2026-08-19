const express = require('express');
const {
  getAllBookings, findBookingById, updateBookingRow, appendBooking,
  getAllSessionBonos, findSessionBonoById, updateSessionBonoRow, appendSessionBono,
  getAllStrikeRecords, upsertStrikeRecord,
  appendLoyaltyMovement, appendProductSale, getAllProductSales, updateProductSaleRow,
  getAllLoyaltyMovements, getLoyaltyMovementsForPhone, updateLoyaltyMovementRow,
  appendCustomQuote, getAllCustomQuotes,
  appendFollowup, getAllFollowups, updateFollowupRow,
  getAllGifts, updateGiftRow,
  appendDiscount, getAllDiscounts, updateDiscountRow,
} = require('../lib/sheets');
const { isDiscountLive } = require('../lib/discounts');
const { createBookingEvent, updateEvent, getEvent, listEvents, deleteEvent, isEventUsable } = require('../lib/googleCalendar');
const { getAvailableSlots, isRangeFree } = require('../lib/availability');
const { localToISO, addMinutes } = require('../lib/timezone');
const { sendEmail } = require('../lib/email');
const { normalizePhone, normalizeEmail } = require('../lib/clientId');
const { computeLoyaltyBalance, MIN_REDEEM_AMOUNT } = require('../config/loyalty');
const { earnLoyalty } = require('../lib/loyaltyEarn');
const { hasOtherActiveBookingsOnSameEvent } = require('../lib/sharedCalendarEvent');
const { withLock, withLocks } = require('../lib/asyncLock');
const { effectiveStrikeCount, isStrikeExpired } = require('../lib/strikes');
const { buildQuarterlyReportWorkbook } = require('../lib/quarterlyReport');
const { createCheckoutSession } = require('../lib/stripeClient');
const { resolveOrigin } = require('../lib/origin');
const hours = require('../config/hours');
const services = require('../config/services');
const employees = require('../config/employees');
const crypto = require('crypto');

const QUOTE_CATEGORIES = ['laser', 'corporal', 'facial', 'cejas'];

const router = express.Router();

function round2(n) {
  return Math.round(n * 100) / 100;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Todas las clientas con email registrado en alguna reserva, sin duplicados
// — la lista base para cualquier envío masivo (descuentos, campañas...).
// Se queda con el nombre de la reserva más reciente de cada email (las
// filas están en orden cronológico), para poder personalizar los envíos.
async function getUniqueClientEmails() {
  const bookings = await getAllBookings();
  const uniqueEmails = new Map();
  bookings.forEach((b) => {
    const email = normalizeEmail(b.email);
    if (email) uniqueEmails.set(email, { email: b.email, name: b.name || '' });
  });
  return uniqueEmails;
}

// earnLoyalty vive en lib/loyaltyEarn.js (compartida con webhook.js, que
// cierra sola y acumula puntos al momento cuando una reserva se paga al
// 100% online — ver handleBookingPayment).

// ── Todas las rutas del panel exigen la clave interna ──
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  // Buffers de distinta longitud harían fallar timingSafeEqual — comparamos
  // igualmente con la clave esperada para no filtrar la longitud tampoco.
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
router.use('/panel', (req, res, next) => {
  const expected = process.env.PANEL_SECRET;
  if (!expected) return res.status(500).json({ error: 'Falta configurar PANEL_SECRET en el servidor.' });
  const provided = req.header('x-panel-key') || '';
  if (!safeEqual(provided, expected)) {
    return res.status(401).json({ error: 'Clave incorrecta.' });
  }
  next();
});

function weeklyScheduleFor(employeeId) {
  const employee = employees.find((e) => e.id === employeeId);
  return employee && employee.weekly;
}

function appointmentDateTime(b) {
  const time = b.time.length === 5 ? b.time : `${b.time}:00`;
  return new Date(localToISO(b.date, time, hours.timezone));
}

// ── Buscar clienta por teléfono, email o nombre ──
router.get('/panel/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Escribe un teléfono, email o nombre para buscar.' });

  try {
    const [allBookings, allBonos, allStrikes, allLoyalty, allExtras] = await Promise.all([
      getAllBookings(), getAllSessionBonos(), getAllStrikeRecords(), getAllLoyaltyMovements(), getAllProductSales(),
    ]);

    const digits = q.replace(/\D/g, '');
    const isPhoneLike = digits.length >= 6;
    const isEmailLike = q.includes('@');

    let matches;
    if (isPhoneLike) {
      const qNorm = normalizePhone(q);
      matches = allBookings.filter((b) => normalizePhone(b.phone) === qNorm);
    } else if (isEmailLike) {
      const qNorm = normalizeEmail(q);
      matches = allBookings.filter((b) => normalizeEmail(b.email) === qNorm);
    } else {
      const qLower = q.toLowerCase();
      matches = allBookings.filter((b) => (b.name || '').toLowerCase().includes(qLower));
    }
    // Las eliminadas marcando "fue un error al registrarla" no deben
    // aparecer aquí — es como si nunca hubieran existido, no una cita
    // cancelada de verdad que tenga sentido seguir viendo en el historial.
    matches = matches.filter((b) => b.deletedAsMistake !== '1');

    // Agrupamos solo por teléfono (siempre obligatorio en la reserva) — el email
    // es opcional, así que agrupar también por email fragmentaría el historial
    // de una misma clienta si una vez lo puso y otra vez no.
    const clientsMap = new Map();
    matches.forEach((b) => {
      const key = normalizePhone(b.phone);
      if (!clientsMap.has(key)) clientsMap.set(key, []);
      clientsMap.get(key).push(b);
    });

    const clients = Array.from(clientsMap.entries()).map(([phoneN, bookings]) => {
      const latest = bookings.slice().sort((a, b) => appointmentDateTime(b) - appointmentDateTime(a))[0];
      const emailN = normalizeEmail(latest.email);
      const bonos = allBonos.filter((bo) => normalizePhone(bo.clientPhone) === phoneN);
      const strike = allStrikes.find((s) => s.phoneNormalized === phoneN);
      const loyaltyMovements = allLoyalty.filter((m) => m.phoneNormalized === phoneN);
      // Productos comprados por esta clienta — tanto sueltos (vendidos
      // desde su ficha o desde la herramienta aparte) como los añadidos
      // como extra dentro de una cita, siempre que se identificara a la
      // clienta al venderlos (los de antes de que esto existiera no
      // llevan teléfono guardado y no aparecerán aquí).
      const products = allExtras
        .filter((s) => s.status !== 'deleted' && s.clientPhone && normalizePhone(s.clientPhone) === phoneN)
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));
      // El cumpleaños suele quedar guardado solo en la reserva donde se
      // escribió por primera vez, no necesariamente en la más reciente.
      const birthdateBooking = bookings.find((b) => b.birthdate);
      return {
        name: latest.name,
        phone: latest.phone,
        email: latest.email,
        birthdate: birthdateBooking ? birthdateBooking.birthdate : '',
        strikeCount: effectiveStrikeCount(strike),
        lastStrikeDate: (strike && !isStrikeExpired(strike)) ? strike.lastStrikeDate : '',
        loyaltyBalance: computeLoyaltyBalance(loyaltyMovements),
        bonos: bonos.map((bo) => ({
          bonoId: bo.bonoId,
          serviceName: bo.serviceName,
          totalSessions: Number(bo.totalSessions) || 0,
          sessionsUsed: Number(bo.sessionsUsed) || 0,
          sessionsRemaining: Number(bo.sessionsRemaining) || 0,
          status: bo.status,
          expiryDate: bo.expiryDate,
          remainingAmount: Number(bo.remainingAmount) || 0,
          remainingPaidHow: bo.remainingPaidHow || '',
        })),
        products: products.map((s) => ({
          saleId: s.saleId, date: s.date, product: s.product,
          amount: Number(s.amount) || 0, paidHow: s.paidHow || '', bookingId: s.bookingId || '',
        })),
        bookings: bookings
          .sort((a, b) => appointmentDateTime(b) - appointmentDateTime(a))
          .map((b) => ({
            bookingId: b.bookingId,
            serviceId: b.serviceId || '',
            serviceName: b.serviceName,
            employeeId: b.employeeId || '',
            employeeName: b.employeeName,
            date: b.date,
            time: b.time,
            durationMinutes: Number(b.durationMinutes) || 0,
            price: Number(b.price) || 0,
            amountPaid: Number(b.amountPaid) || 0,
            finalAmount: b.finalAmount !== undefined && b.finalAmount !== '' ? Number(b.finalAmount) : null,
            remainderPaidHow: b.remainderPaidHow || '',
            remainderAmount2: b.remainderAmount2 !== undefined && b.remainderAmount2 !== '' ? Number(b.remainderAmount2) : 0,
            remainderPaidHow2: b.remainderPaidHow2 || '',
            redeemedAmount: b.redeemedAmount !== undefined && b.redeemedAmount !== '' ? Number(b.redeemedAmount) : 0,
            depositPaidHow: b.depositPaidHow || '',
            paymentType: b.paymentType,
            status: b.status,
            bonoId: b.bonoId || '',
            sessionNumber: b.sessionNumber || '',
            notes: b.notes || '',
            isPast: appointmentDateTime(b).getTime() <= Date.now(),
            extras: allExtras.filter((s) => s.bookingId === b.bookingId).map((s) => ({
              saleId: s.saleId, product: s.product, amount: Number(s.amount) || 0,
              paidHow: s.paidHow || '', category: s.category || 'venta',
            })),
          })),
      };
    });

    res.json({ clients });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo buscar.' });
  }
});

// ── Añadir/editar nota de una sesión ──
// Las notas también se escriben en la descripción del evento de Google
// Calendar, así se ven de un vistazo sin entrar al panel — solo las ve
// quien tenga ese calendario compartido (nunca la clienta).
const NOTE_MARKER = '\n\n📝 Notas internas (solo equipo):\n';

router.post('/panel/note', async (req, res) => {
  const { bookingId, note } = req.body || {};
  if (!bookingId) return res.status(400).json({ error: 'Falta el identificador de la cita.' });
  try {
    const booking = await findBookingById(bookingId);
    if (!booking) return res.status(404).json({ error: 'No se ha encontrado esa cita.' });
    await updateBookingRow(booking._sheetRow, booking, { notes: note || '' });

    if (booking.calendarId && booking.eventId) {
      try {
        const event = await getEvent(booking.calendarId, booking.eventId);
        const baseDescription = (event.description || '').split(NOTE_MARKER)[0];
        const newDescription = note ? `${baseDescription}${NOTE_MARKER}${note}` : baseDescription;
        await updateEvent(booking.calendarId, booking.eventId, { description: newDescription });
      } catch (calErr) {
        console.error('No se pudo actualizar la nota en Google Calendar:', calErr);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo guardar la nota.' });
  }
});

// ── Corregir el tratamiento/precio/pagado/nº de sesión de una cita ya
// registrada (por si al darla de alta a mano hubo algún error) ──
router.post('/panel/edit-booking', async (req, res) => {
  const {
    bookingId, serviceId, removeServiceId, addServiceId, addWithoutTimeExtend, swapServiceId, employeeId, price, amountPaid, depositPaidHow, sessionNumber, durationMinutes,
    // Solo para convertToBono: registra de golpe el bono que compró la clienta
    // y engancha esta misma cita como una de sus sesiones — sin tener que
    // borrar la cita y volver a darla de alta a mano desde otro formulario.
    convertToBono, bonoTargetServiceId, bonoTotalSessions, bonoSessionNumber, bonoTotalPrice,
    bonoPaidCash, bonoPaidBizum, bonoPaidCard,
  } = req.body || {};
  if (!bookingId) return res.status(400).json({ error: 'Falta el identificador de la cita.' });
  if ([serviceId, removeServiceId, addServiceId, swapServiceId, convertToBono].filter(Boolean).length > 1) {
    return res.status(400).json({ error: 'Solo se puede cambiar, quitar, añadir, cambiar un tratamiento por otro o convertir en bono a la vez.' });
  }
  try {
    const booking = await findBookingById(bookingId);
    if (!booking) return res.status(404).json({ error: 'No se ha encontrado esa cita.' });

    const updates = {};
    let newService = null;
    let newDurationForCalendar = null; // si cambia, se intenta ajustar el evento real más abajo
    let restoredBonoSession = false;
    // Una cita ya pasada no puede "chocar" con nada real — la hora ya
    // ocurrió, así que no tiene sentido bloquear el cambio de tratamiento
    // (o su ampliación) solo porque en teoría no cabría de haberse reservado
    // hoy. Esto es sobre todo para corregir al cerrar: la clienta decidió
    // en el sitio hacerse otra cosa distinta a lo reservado.
    const isPast = appointmentDateTime(booking).getTime() <= Date.now();

    if (serviceId) {
      newService = services.find((s) => s.id === serviceId);
      if (!newService) return res.status(404).json({ error: 'Tratamiento no encontrado.' });
      updates.serviceId = serviceId;
      updates.durationMinutes = newService.durationMinutes;
      newDurationForCalendar = newService.durationMinutes;
    }

    // Quitar UN tratamiento de una cita con varios combinados (p.ej. "Axilas
    // + Medios brazos + Limpieza facial") sin cancelar los demás — el
    // formulario de "Añadir reserva manual" ya permite añadir varios de
    // golpe, pero hasta ahora no había forma de quitar uno después.
    if (removeServiceId) {
      const currentIds = String(booking.serviceId || '').split(',').map((s) => s.trim()).filter(Boolean);
      const idx = currentIds.indexOf(removeServiceId);
      if (idx === -1) {
        return res.status(400).json({ error: 'Ese tratamiento no está en esta cita.' });
      }
      if (currentIds.length <= 1) {
        return res.status(400).json({ error: 'Es el único tratamiento de esta cita — usa "Eliminar" para cancelarla entera.' });
      }
      // Si lo que se quita es el propio tratamiento del bono (no un extra),
      // la sesión no se ha llegado a usar de verdad — se le devuelve a la
      // clienta y esta cita deja de estar vinculada al bono (se queda solo
      // con los extras que le sigan quedando).
      if (booking.bonoId && idx === 0) {
        const bono = await findSessionBonoById(booking.bonoId);
        if (bono) {
          const sessionsUsed = Math.max(0, (Number(bono.sessionsUsed) || 0) - 1);
          const sessionsRemaining = (Number(bono.sessionsRemaining) || 0) + 1;
          await updateSessionBonoRow(bono._sheetRow, bono, { sessionsUsed, sessionsRemaining, status: 'active' });
          restoredBonoSession = true;
        }
        updates.bonoId = '';
        updates.sessionNumber = '';
      }
      // Los nombres se guardaron en el mismo orden que los ids (se
      // construyeron a la vez) — quitamos por posición en vez de
      // reconstruir los nombres desde el catálogo, así se conserva tal
      // cual la etiqueta "(n/total)" del bono si la hay.
      const nameSegments = String(booking.serviceName || '').split(' + ');
      const remainingIds = currentIds.filter((_, i) => i !== idx);
      const remainingNames = nameSegments.length === currentIds.length
        ? nameSegments.filter((_, i) => i !== idx)
        : remainingIds.map((id) => (services.find((s) => s.id === id) || {}).name).filter(Boolean);
      updates.serviceId = remainingIds.join(',');
      updates.serviceName = remainingNames.join(' + ');

      const removedService = services.find((s) => s.id === removeServiceId);
      newDurationForCalendar = Math.max(0, (Number(booking.durationMinutes) || 0) - (removedService ? Number(removedService.durationMinutes) || 0 : 0));
      updates.durationMinutes = newDurationForCalendar;
    }

    // Añadir UN tratamiento extra a una cita ya existente (con uno o varios
    // combinados) sin tener que cancelarla y volver a crearla — antes solo
    // se podía añadir un extra al darla de alta la primera vez.
    if (addServiceId) {
      const currentIds = String(booking.serviceId || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (currentIds.includes(addServiceId)) {
        return res.status(400).json({ error: 'Ese tratamiento ya está en esta cita.' });
      }
      const addedService = services.find((s) => s.id === addServiceId);
      if (!addedService) return res.status(404).json({ error: 'Tratamiento no encontrado.' });

      const oldDuration = Number(booking.durationMinutes) || 0;

      // "Ya se hizo, sin ampliar el hueco": para tratamientos que en la
      // práctica se hicieron en el mismo rato (p.ej. algo rápido añadido de
      // más en cabina) sin que hiciera falta más tiempo real de calendario
      // — se añade solo para que quede reflejado en la cita, sin comprobar
      // huecos ni tocar la duración ni el evento de Google Calendar.
      if (!addWithoutTimeExtend) {
        newDurationForCalendar = oldDuration + (Number(addedService.durationMinutes) || 0);

        // Antes de dar por hecho que cabe, comprobamos que el tiempo extra
        // está libre justo después de la cita — igual que "Ampliar tiempo".
        // Salvo que la cita ya haya pasado: no hay nada real que comprobar.
        if (!isPast && booking.calendarId && booking.date && booking.time) {
          const time = booking.time.length === 5 ? booking.time : `${booking.time}:00`;
          const startISO = localToISO(booking.date, time, hours.timezone);
          const currentEndISO = addMinutes(startISO, oldDuration);
          const newEndISO = addMinutes(startISO, newDurationForCalendar);
          const free = await isRangeFree(booking.date, booking.calendarId, currentEndISO, newEndISO, weeklyScheduleFor(booking.employeeId), { ignoreClosingTime: true });
          if (!free) {
            return res.status(409).json({ error: 'No hay hueco libre justo después de esta cita para añadir ese tratamiento.' });
          }
        }
      }

      const nameSegments = String(booking.serviceName || '').split(' + ').filter(Boolean);
      updates.serviceId = [...currentIds, addServiceId].join(',');
      updates.serviceName = [...(nameSegments.length ? nameSegments : [booking.serviceName]), addedService.name].join(' + ');
      if (!addWithoutTimeExtend) {
        updates.durationMinutes = newDurationForCalendar;
      }
    }

    // Cambiar CUÁL tratamiento es uno de los de esta cita (p.ej. se dio de
    // alta "Axilas" por error y era "Ingles") sin tener que quitarlo y
    // volver a añadir el correcto por separado — mantiene su sitio en la
    // lista (así, si es el primero de una sesión de bono, sigue enganchado)
    // y ajusta la duración/calendario como una mezcla de quitar+añadir.
    if (swapServiceId) {
      const { from, to } = swapServiceId;
      if (!from || !to) return res.status(400).json({ error: 'Indica qué tratamiento cambiar y por cuál.' });
      const currentIds = String(booking.serviceId || '').split(',').map((s) => s.trim()).filter(Boolean);
      const idx = currentIds.indexOf(from);
      if (idx === -1) return res.status(400).json({ error: 'Ese tratamiento no está en esta cita.' });
      if (currentIds.includes(to)) return res.status(400).json({ error: 'Ese tratamiento ya está en esta cita.' });
      const oldSwapService = services.find((s) => s.id === from);
      const newSwapService = services.find((s) => s.id === to);
      if (!newSwapService) return res.status(404).json({ error: 'Tratamiento no encontrado.' });

      const oldDuration = Number(booking.durationMinutes) || 0;
      const durationDelta = (Number(newSwapService.durationMinutes) || 0) - (oldSwapService ? Number(oldSwapService.durationMinutes) || 0 : 0);
      newDurationForCalendar = Math.max(0, oldDuration + durationDelta);

      // Si el cambio alarga la cita, hay que comprobar que sigue habiendo
      // hueco libre justo después — igual que al añadir un tratamiento.
      // Salvo que la cita ya haya pasado: no hay nada real que comprobar
      // (p.ej. al cerrar, la clienta decidió en el sitio otra cosa distinta
      // a lo que había reservado).
      if (!isPast && durationDelta > 0 && booking.calendarId && booking.date && booking.time) {
        const time = booking.time.length === 5 ? booking.time : `${booking.time}:00`;
        const startISO = localToISO(booking.date, time, hours.timezone);
        const currentEndISO = addMinutes(startISO, oldDuration);
        const newEndISO = addMinutes(startISO, newDurationForCalendar);
        const free = await isRangeFree(booking.date, booking.calendarId, currentEndISO, newEndISO, weeklyScheduleFor(booking.employeeId), { ignoreClosingTime: true });
        if (!free) {
          return res.status(409).json({ error: 'No hay hueco libre justo después de esta cita para alargarla con ese tratamiento.' });
        }
      }

      const nameSegments = String(booking.serviceName || '').split(' + ');
      const remainingIds = currentIds.slice();
      remainingIds[idx] = to;
      const remainingNames = nameSegments.length === currentIds.length
        ? nameSegments.slice()
        : currentIds.map((id) => (services.find((s) => s.id === id) || {}).name || '');
      // Si es el tratamiento del bono (el primero, en una sesión de bono),
      // conserva la etiqueta "(n/total)" que ya llevara.
      const bonoLabelMatch = idx === 0 && booking.bonoId ? String(remainingNames[idx] || '').match(/\(\d+\/\d+\)\s*$/) : null;
      remainingNames[idx] = bonoLabelMatch ? `${newSwapService.name} ${bonoLabelMatch[0]}` : newSwapService.name;
      updates.serviceId = remainingIds.join(',');
      updates.serviceName = remainingNames.join(' + ');
      updates.durationMinutes = newDurationForCalendar;

      // Si lo que cambia es el propio tratamiento del bono, el bono en sí
      // también hay que corregirlo — si no, se quedaría registrado con el
      // tratamiento viejo aunque la cita ya diga el nuevo.
      if (idx === 0 && booking.bonoId) {
        const bono = await findSessionBonoById(booking.bonoId);
        if (bono) {
          await updateSessionBonoRow(bono._sheetRow, bono, { serviceId: to, serviceName: newSwapService.name });
        }
      }
    }

    // Convertir una cita suelta ya dada de alta en la sesión de un bono que
    // la clienta acaba de decidir comprar — antes había que borrar la cita y
    // volver a crearla desde "Añadir reserva manual" marcando "es un bono",
    // buscando de nuevo el evento en Calendar; ahora se hace desde el mismo
    // sitio donde ya se está editando la cita.
    let convertedBonoId = '';
    if (convertToBono) {
      const currentIds = String(booking.serviceId || '').split(',').map((s) => s.trim()).filter(Boolean);
      const nameSegments = String(booking.serviceName || '').split(' + ').filter(Boolean);
      // Por defecto se convierte el primer tratamiento (el único, en una cita
      // suelta) — pero si la cita combina varios y alguno YA es el del bono
      // (siempre el primero, por convención de esta app), se puede elegir
      // cuál de los DEMÁS convertir sin tocar el bono que ya tenía.
      const targetServiceId = bonoTargetServiceId || currentIds[0];
      const targetIdx = currentIds.indexOf(targetServiceId);
      if (targetIdx === -1) {
        return res.status(400).json({ error: 'Ese tratamiento no está en esta cita.' });
      }
      if (targetIdx === 0 && booking.bonoId) {
        return res.status(400).json({ error: 'Esta cita ya es una sesión de un bono.' });
      }
      const total = Number(bonoTotalSessions);
      const current = Number(bonoSessionNumber);
      if (!Number.isInteger(total) || total < 1 || !Number.isInteger(current) || current < 1 || current > total) {
        return res.status(400).json({ error: 'Indica un número de sesión y un total de sesiones del bono válidos.' });
      }
      const coreService = services.find((s) => s.id === targetServiceId);
      if (!coreService) return res.status(404).json({ error: 'Tratamiento no encontrado.' });

      const bonoPrice = bonoTotalPrice !== undefined && bonoTotalPrice !== '' ? Number(bonoTotalPrice) : round2(coreService.price * total);
      const cash = Math.max(0, Number(bonoPaidCash) || 0);
      const bizum = Math.max(0, Number(bonoPaidBizum) || 0);
      const card = Math.max(0, Number(bonoPaidCard) || 0);
      for (const [label, val] of [['El precio del bono', bonoPrice], ['Lo pagado en efectivo', cash], ['Lo pagado por Bizum', bizum], ['Lo pagado con tarjeta', card]]) {
        if (!Number.isFinite(val) || val < 0) return res.status(400).json({ error: `${label} no es un número válido.` });
      }
      const paidOnline = round2(cash + bizum + card);

      // Esta misma cita YA es la sesión "current" (está confirmada, con su
      // hora y calendario) — cuenta como usada desde ya, así que sessionsUsed
      // es "current", no "current - 1" (eso dejaba la próxima sesión que se
      // agendase con el número repetido, p.ej. "1-2/3" en vez de "2/3").
      const sessionsUsed = Math.min(total, current);
      const sessionsRemaining = Math.max(0, total - sessionsUsed);
      const remainingAmount = Math.max(0, round2(bonoPrice - paidOnline));

      convertedBonoId = crypto.randomUUID();
      await appendSessionBono({
        bonoId: convertedBonoId,
        createdAt: new Date().toISOString(),
        clientName: booking.name, clientPhone: booking.phone, clientEmail: booking.email,
        serviceId: targetServiceId, serviceName: coreService.name,
        employeeId: booking.employeeId,
        totalSessions: total,
        sessionsUsed,
        sessionsRemaining,
        totalPrice: bonoPrice,
        amountPaidOnline: paidOnline,
        paymentType: '',
        remainingAmount,
        remainingPaidHow: '',
        status: sessionsRemaining <= 0 ? 'completed' : 'active',
        expiryDate: addMonthsISO(LEGACY_BONO_VALIDITY_MONTHS),
        paymentIntentId: '',
        lang: 'es',
        paidCash: cash || '', paidBizum: bizum || '', paidCard: card || '',
      });

      if (currentIds.length > 1) {
        // La cita combina varios tratamientos y el que se convierte NO es el
        // único — se separa a su propia fila (compartiendo el mismo evento
        // de Calendar, igual que cuando se combina bono+suelto al pagar
        // online), y la fila original se queda solo con los demás.
        const removedDuration = coreService.durationMinutes;
        const remainingIds = currentIds.filter((_, i) => i !== targetIdx);
        const remainingNames = nameSegments.length === currentIds.length
          ? nameSegments.filter((_, i) => i !== targetIdx)
          : remainingIds.map((id) => (services.find((s) => s.id === id) || {}).name).filter(Boolean);
        updates.serviceId = remainingIds.join(',');
        updates.serviceName = remainingNames.join(' + ');
        updates.durationMinutes = Math.max(0, (Number(booking.durationMinutes) || 0) - removedDuration);

        await appendBooking({
          bookingId: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          status: 'confirmed',
          name: booking.name, phone: booking.phone, email: booking.email,
          serviceId: targetServiceId,
          serviceName: `${coreService.name} (${current}/${total})`,
          employeeId: booking.employeeId, employeeName: booking.employeeName,
          calendarId: booking.calendarId, eventId: booking.eventId,
          date: booking.date, time: booking.time,
          durationMinutes: removedDuration,
          price: '', amountPaid: 0,
          paymentType: 'bono', paymentIntentId: '',
          lang: booking.lang || 'es', reminderSent: '', birthdate: booking.birthdate || '',
          bonoId: convertedBonoId, sessionNumber: current,
          notes: 'Separada de una cita combinada al convertir un tratamiento en bono.',
        });
      } else {
        // Único tratamiento en la cita — se convierte esta misma fila.
        // El precio del bono en sí ya queda registrado en su propia fila de
        // SessionBono (arriba); aquí el precio/pagado se limpia para no
        // duplicar el importe del bono en dos sitios distintos.
        updates.serviceName = `${coreService.name} (${current}/${total})`;
        updates.bonoId = convertedBonoId;
        updates.sessionNumber = current;
        updates.price = '';
        updates.amountPaid = 0;
        updates.paymentType = 'bono';
      }
    }

    // Corregir a mano la duración real de la cita (p.ej. la clienta reservó
    // varios tratamientos combinados que suman 80min según el catálogo,
    // pero en la práctica se hace en 60 — o al revés, hace falta más
    // tiempo del de catálogo). Solo tiene sentido si no se ha tocado ya el
    // tratamiento en esta misma edición (eso ya recalcula su propia
    // duración arriba).
    if (durationMinutes !== undefined && durationMinutes !== '' && newDurationForCalendar === null) {
      const newDur = Math.round(Number(durationMinutes));
      if (!Number.isFinite(newDur) || newDur < 5) {
        return res.status(400).json({ error: 'La duración no es un número de minutos válido.' });
      }
      const oldDur = Number(booking.durationMinutes) || 0;
      if (newDur !== oldDur) {
        // Si se alarga, comprobamos que el tiempo extra está libre justo
        // después — igual que al añadir un tratamiento. Si se acorta, no
        // hace falta comprobar nada (libera hueco, nunca lo invade).
        if (!isPast && newDur > oldDur && booking.calendarId && booking.date && booking.time) {
          const time = booking.time.length === 5 ? booking.time : `${booking.time}:00`;
          const startISO = localToISO(booking.date, time, hours.timezone);
          const currentEndISO = addMinutes(startISO, oldDur);
          const newEndISO = addMinutes(startISO, newDur);
          const free = await isRangeFree(booking.date, booking.calendarId, currentEndISO, newEndISO, weeklyScheduleFor(booking.employeeId), { ignoreClosingTime: true });
          if (!free) {
            return res.status(409).json({ error: 'No hay hueco libre justo después de esta cita para alargarla tanto tiempo.' });
          }
        }
        updates.durationMinutes = newDur;
        newDurationForCalendar = newDur;
      }
    }

    // Si cambia la duración total (por cambiar el tratamiento, quitar uno de
    // varios combinados o añadir uno nuevo, o corregirla a mano), ajustamos
    // también el bloqueo real en Google Calendar — SIEMPRE que sea posible,
    // no solo "si es fácil": antes, cuando el evento no era usable (p.ej.
    // quedó cancelado tras un borrado anterior), este bloque no hacía nada
    // en absoluto, dejando la Sheet con una duración mayor de la que el
    // calendario realmente bloqueaba — eso hacía que, al buscar hueco para
    // otra cosa más tarde, el sistema pensara que esta cita ocupaba más
    // tiempo del que de verdad bloqueaba en Google, y escondiera huecos
    // libres de verdad. Ahora, si no se puede parchear el evento, se crea
    // uno nuevo que cubra la duración correcta (igual que ya hace "Ampliar
    // tiempo").
    if (newDurationForCalendar !== null && booking.calendarId && booking.date && booking.time) {
      const oldDuration = Number(booking.durationMinutes) || 0;
      if (newDurationForCalendar !== oldDuration) {
        const time = booking.time.length === 5 ? booking.time : `${booking.time}:00`;
        const startISO = localToISO(booking.date, time, hours.timezone);
        const newEndISO = addMinutes(startISO, newDurationForCalendar);
        try {
          const allBookingsForCheck = await getAllBookings();
          const hasActiveSiblings = hasOtherActiveBookingsOnSameEvent(booking, allBookingsForCheck);
          if (hasActiveSiblings) {
            console.error(`No se pudo ajustar el calendario de la cita ${booking.bookingId}: comparte evento con otro tratamiento activo.`);
          } else if (booking.eventId && await isEventUsable(booking.calendarId, booking.eventId)) {
            await updateEvent(booking.calendarId, booking.eventId, { end: { dateTime: newEndISO } });
          } else {
            const event = await createBookingEvent(booking.calendarId, {
              summary: updates.serviceName || booking.serviceName || 'Cita Osana',
              description: `Clienta: ${booking.name || ''} · ${booking.phone || ''}`,
              startISO, endISO: newEndISO,
            });
            updates.eventId = event.id;
          }
        } catch (e) {
          console.error('No se pudo ajustar la duración del evento al editar la cita:', e.message);
        }
      }
    }

    if (employeeId) {
      // Solo corrige el dato en el registro (para informes y la ficha de la
      // clienta) — NO mueve el evento ya creado en Google Calendar de una
      // profesional a otra, eso hay que hacerlo a mano en el calendario si
      // hiciera falta.
      const newEmployee = employees.find((e) => e.id === employeeId);
      if (!newEmployee) return res.status(404).json({ error: 'Profesional no encontrada.' });
      updates.employeeId = employeeId;
      updates.employeeName = newEmployee.name;
    }
    if (price !== undefined && price !== '') {
      if (!Number.isFinite(Number(price)) || Number(price) < 0) return res.status(400).json({ error: 'El precio no es un número válido.' });
      updates.price = Number(price);
    }
    if (amountPaid !== undefined && amountPaid !== '') {
      if (!Number.isFinite(Number(amountPaid)) || Number(amountPaid) < 0) return res.status(400).json({ error: 'El importe pagado no es un número válido.' });
      updates.amountPaid = Number(amountPaid);
    }
    // Cómo se cobró ese "ya pagado" cuando se cobró en persona (no por
    // Stripe) — para poder corregirlo a mano en citas dadas de alta antes
    // de que este campo existiera, o si se equivocó al elegirlo.
    if (depositPaidHow !== undefined) updates.depositPaidHow = depositPaidHow;

    // Si es una sesión de un bono, el nombre lleva "(n/total)" — lo
    // reconstruimos con el total real del bono para no tener que pedirlo.
    // (Si se quitó/añadió un tratamiento extra con removeServiceId/
    // addServiceId, el nombre ya se recalculó arriba y no lo tocamos aquí.)
    if (booking.bonoId && !removeServiceId && !addServiceId && !swapServiceId) {
      const bono = await findSessionBonoById(booking.bonoId);
      const num = sessionNumber !== undefined && sessionNumber !== '' ? Number(sessionNumber) : Number(booking.sessionNumber);
      if (sessionNumber !== undefined && sessionNumber !== '') updates.sessionNumber = num;
      const baseName = newService ? newService.name : (bono ? bono.serviceName : String(booking.serviceName || '').replace(/\s*\(\d+\/\d+\)\s*$/, ''));
      const total = bono ? bono.totalSessions : (String(booking.serviceName || '').match(/\((\d+)\/(\d+)\)/) || [])[2];
      if (baseName && total && num) updates.serviceName = `${baseName} (${num}/${total})`;
    } else if (newService) {
      updates.serviceName = newService.name;
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'No hay ningún cambio que guardar.' });
    }

    await updateBookingRow(booking._sheetRow, booking, updates);
    res.json({ ok: true, restoredBonoSession, convertedBonoId: convertedBonoId || undefined });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo editar la cita.' });
  }
});

// ── Agendar la siguiente sesión de un bono (sin cobrar, ya está pagada) ──
// sessionsToUse permite consumir más de una sesión de golpe en la misma
// visita (p.ej. dos zonas distintas del mismo bono el mismo día).
// extraMinutes y notes se guardan también aquí mismo — así, en el mismo
// paso de agendar la próxima cita, queda registrada la duración real y la
// potencia/observaciones de esta sesión, sin tener que entrar luego a
// otra pantalla a añadirlas.
router.post('/panel/book-session', async (req, res) => {
  const { bonoId, employeeId, date, time, sessionsToUse, extraMinutes, notes, treatmentOverrideId, force } = req.body || {};
  if (!bonoId || !employeeId || !date || !time) {
    return res.status(400).json({ error: 'Faltan datos para agendar la sesión.' });
  }
  if (force && !/^\d{2}:\d{2}$/.test(time)) {
    return res.status(400).json({ error: 'La hora no tiene un formato válido (HH:MM).' });
  }
  const useCount = Math.max(1, Math.round(Number(sessionsToUse) || 1));
  // Puede ser negativo — el equipo sabe que en realidad da tiempo de sobra
  // y quiere liberar ese hueco para más citas (nunca se deja bajar de un
  // mínimo absurdo, ver más abajo donde se aplica a durationMinutes).
  const extra = Math.round(Number(extraMinutes) || 0);
  try {
    // Dos peticiones casi simultáneas para el mismo bono (doble clic, o dos
    // pestañas del panel) podrían leer el mismo "sessionsRemaining" antes de
    // que ninguna escriba, y agendar dos sesiones descontando solo una —
    // el bloqueo serializa las peticiones sobre el mismo bono.
    return await withLock(`bono:${bonoId}`, async () => {
    const bono = await findSessionBonoById(bonoId);
    if (!bono) return res.status(404).json({ error: 'Bono no encontrado.' });
    const remaining = Number(bono.sessionsRemaining) || 0;
    if (remaining <= 0) return res.status(409).json({ error: 'Este bono no tiene sesiones restantes.' });
    if (useCount > remaining) {
      return res.status(400).json({ error: `Solo quedan ${remaining} sesión(es) en este bono — no se pueden consumir ${useCount}.` });
    }

    const employee = employees.find((e) => e.id === employeeId);
    if (!employee) return res.status(404).json({ error: 'Empleada no encontrada.' });

    // Si esta visita en concreto se usa para otra zona/tratamiento del
    // mismo bono (mismo precio, distinto nombre) — la sesión se sigue
    // descontando del MISMO bono, solo cambia lo que se muestra/registra.
    const displayService = treatmentOverrideId ? services.find((s) => s.id === treatmentOverrideId) : null;
    // El tratamiento base normalmente sale de bono.serviceId, pero algún
    // bono antiguo puede tener ese campo vacío o con un id que ya no existe
    // en la Sheet — si el equipo ha elegido explícitamente un tratamiento en
    // "Tratamiento de hoy", lo usamos también como base en vez de bloquear
    // la reserva por un dato que la clienta no tiene forma de arreglar.
    const baseService = services.find((s) => s.id === bono.serviceId) || displayService;
    if (!baseService) {
      return res.status(404).json({ error: 'Tratamiento del bono no encontrado — elige uno en "Tratamiento de hoy" para poder agendar.' });
    }
    const displayName = displayService ? displayService.name : bono.serviceName;

    const durationMinutes = Math.max(5, (displayService || baseService).durationMinutes + extra);
    const startISO = localToISO(date, time.length === 5 ? time : `${time}:00`, hours.timezone);
    const endISO = addMinutes(startISO, durationMinutes);
    const fromSession = (Number(bono.sessionsUsed) || 0) + 1;
    const toSession = fromSession + useCount - 1;
    const sessionLabel = useCount > 1 ? `${fromSession}-${toSession}/${bono.totalSessions}` : `${fromSession}/${bono.totalSessions}`;

    const description = [
      `Cliente: ${bono.clientName}`,
      `Teléfono: ${bono.clientPhone}`,
      `Bono: ${bono.serviceName} — sesión ${sessionLabel}`,
      displayService ? `Tratamiento de hoy: ${displayName}` : '',
      'Ya pagada como parte del bono.',
      notes ? `\n📝 Notas internas (solo equipo):\n${notes}` : '',
    ].filter(Boolean).join('\n');

    // Revalidar disponibilidad y crear el evento dentro del mismo bloqueo
    // en memoria por profesional+día — evita que esto choque con una
    // clienta reservando online ese mismo hueco casi a la vez.
    const newEventId = await withLock(`slot:${employeeId}:${date}`, async () => {
      // "force" salta la comprobación de hueco entero — para registrar una
      // sesión que YA se hizo (p.ej. hoy más tarde, o se olvidó anotar
      // ayer), donde la hora ya ha pasado y por eso el buscador normal de
      // huecos libres no la ofrece — no es una reserva de verdad, es dejar
      // constancia de una que ya pasó.
      if (!force) {
        // skipGapHeuristic: el panel ya le enseñó este hueco al equipo con
        // ese mismo criterio relajado (ver /availability) — sin esto, un
        // hueco que el buscador de huecos "buenos" descarta por dejar un
        // tramo corto detrás (pero que SÍ está libre de verdad) se
        // rechazaría aquí aunque el panel lo acabase de ofrecer.
        const freeSlots = await getAvailableSlots(date, employee.calendarId, durationMinutes, employee.weekly, { ignoreClosingTime: true, skipGapHeuristic: true });
        if (!freeSlots.includes(time)) return null;
      }
      const event = await createBookingEvent(employee.calendarId, {
        summary: `✅ Bono (${sessionLabel}) — ${displayName} — ${bono.clientName}`,
        description,
        startISO,
        endISO,
        clientEmail: bono.clientEmail,
        clientName: bono.clientName,
      });
      return event.id;
    });
    if (!newEventId) {
      return res.status(409).json({ error: 'Ese hueco ya no está disponible. Elige otra hora.' });
    }

    const bookingId = crypto.randomUUID();
    await appendBooking({
      bookingId,
      createdAt: new Date().toISOString(),
      status: 'confirmed',
      name: bono.clientName,
      phone: bono.clientPhone,
      email: bono.clientEmail,
      serviceId: bono.serviceId || baseService.id,
      serviceName: `${displayName} (${sessionLabel})`,
      employeeId,
      employeeName: employee.name,
      calendarId: employee.calendarId,
      eventId: newEventId,
      date, time,
      durationMinutes,
      price: '',
      amountPaid: 0,
      paymentType: 'bono',
      paymentIntentId: '',
      lang: bono.lang || 'es',
      reminderSent: '',
      birthdate: '',
      bonoId,
      sessionNumber: useCount > 1 ? sessionLabel : fromSession,
      notes: notes || '',
    });

    const sessionsRemaining = remaining - useCount;
    await updateSessionBonoRow(bono._sheetRow, bono, {
      sessionsUsed: toSession,
      sessionsRemaining,
      status: sessionsRemaining <= 0 ? 'completed' : 'active',
    });

    res.json({ ok: true, bookingId, sessionsRemaining });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo agendar la sesión.' });
  }
});

// ── Dar de alta a mano una cita ya existente (reservada por teléfono/en
// persona antes de o al margen de la web) para que la clienta pueda
// gestionarla desde "Mis Reservas". El evento de calendario debe existir
// YA en el calendario de la profesional — aquí solo lo buscamos y lo
// enlazamos con una fila nueva en la Sheet, nunca creamos un evento nuevo
// (evita duplicar la cita en el calendario).
const IMPORT_MATCH_TOLERANCE_MIN = 20;

function addMonthsISO(months, fromDate) {
  const d = fromDate ? new Date(`${fromDate}T12:00:00`) : new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}
const LEGACY_BONO_VALIDITY_MONTHS = 12;

router.post('/panel/import-legacy-booking', async (req, res) => {
  const {
    name, phone, email, birthdate, employeeId, date, time,
    price, amountPaid, notes, paidHow, extraMinutes, bonoPurchaseDate,
    // items: cada tratamiento de la visita — { serviceId, isBono,
    // totalSessions, sessionNumber, bonoTotalPrice, bonoAmountPaid }.
    // CUALQUIERA de ellos puede ser un bono (no solo el primero) — una
    // clienta puede comprar dos bonos distintos en la misma visita.
    items,
    // accountingOnly = cita que ya pasó y solo se registra para que cuente
    // en la contabilidad — sin comprobar hueco ni tocar el calendario de
    // Google (no haría falta, ya pasó), sin exigir hora (solo la fecha en
    // la que se hizo) y sin exigir teléfono/email (para clientas sin ficha,
    // que no interesa dejar identificadas).
    accountingOnly,
  } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Indica al menos un tratamiento.' });
  }
  if (accountingOnly) {
    if (!date) return res.status(400).json({ error: 'Indica la fecha en la que se hizo.' });
  } else if (!name || !phone || !email || !employeeId || !date || !time) {
    return res.status(400).json({ error: 'Faltan datos obligatorios (nombre, teléfono, email, profesional, fecha y hora).' });
  }
  for (const item of items) {
    if (!item || !item.serviceId) return res.status(400).json({ error: 'Falta el tratamiento de una de las líneas.' });
    if (item.isBono && (!item.totalSessions || !item.sessionNumber)) {
      return res.status(400).json({ error: 'Indica el número de sesión y el total de sesiones de cada bono.' });
    }
  }
  const numericChecks = [['El precio', price], ['El importe pagado', amountPaid]];
  items.forEach((item, i) => {
    numericChecks.push([`El precio del bono ${i + 1}`, item.bonoTotalPrice], [`El importe pagado del bono ${i + 1}`, item.bonoAmountPaid]);
  });
  for (const [label, val] of numericChecks) {
    if (val !== undefined && val !== '' && (!Number.isFinite(Number(val)) || Number(val) < 0)) {
      return res.status(400).json({ error: `${label} no es un número válido.` });
    }
  }
  try {
    const resolvedItems = items.map((item) => ({ ...item, service: services.find((s) => s.id === item.serviceId) }));
    const missingIdx = resolvedItems.findIndex((r) => !r.service);
    if (missingIdx !== -1) return res.status(404).json({ error: 'Tratamiento no encontrado.' });
    const employee = employeeId ? employees.find((e) => e.id === employeeId) : null;
    if (employeeId && !employee) return res.status(404).json({ error: 'Empleada no encontrada.' });
    if (!accountingOnly && !employee) return res.status(404).json({ error: 'Empleada no encontrada.' });

    const combinedServiceName = resolvedItems.map((r) => r.service.name).join(' + ');

    const timeNorm = time ? (time.length === 5 ? time : `${time}:00`) : '12:00';
    // extraMinutes: ajuste sobre la duración estándar del catálogo para
    // esta visita en concreto — puede ser negativo (el equipo sabe que da
    // tiempo de sobra y quiere liberar ese hueco para más citas).
    const extraMin = Math.round(Number(extraMinutes) || 0);
    const durationMinutes = Math.max(5, resolvedItems.reduce((sum, r) => sum + r.service.durationMinutes, 0) + extraMin);

    let eventId = '';
    if (accountingOnly) {
      // Ya pasó y solo se registra por contabilidad — no hace falta
      // comprobar hueco ni crear/enlazar ningún evento de Google Calendar.
    } else {
      const startISO = localToISO(date, timeNorm, hours.timezone);
      const dayStartISO = localToISO(date, '00:00', hours.timezone);
      const dayEndISO = localToISO(date, '23:59', hours.timezone);
      const dayEvents = await listEvents(employee.calendarId, dayStartISO, dayEndISO);

      const targetMs = new Date(startISO).getTime();
      let best = null;
      let bestDiff = Infinity;
      dayEvents.forEach((ev) => {
        if (!ev.start || !ev.start.dateTime) return; // ignora eventos de día completo
        const diff = Math.abs(new Date(ev.start.dateTime).getTime() - targetMs);
        if (diff < bestDiff) { bestDiff = diff; best = ev; }
      });
      if (best && bestDiff <= IMPORT_MATCH_TOLERANCE_MIN * 60 * 1000) {
        // Ya existía un evento en el calendario cerca de esa hora (reserva
        // hecha por teléfono o en persona y anotada primero a mano en Google
        // Calendar) — se enlaza con él en vez de crear uno nuevo.
        eventId = best.id;
      } else {
        // No hay ningún evento ahí — es una cita completamente nueva (p.ej.
        // la clienta la pide en el momento, estando en el centro) — se
        // comprueba que el hueco está libre y se crea el evento nosotros.
        const rangeEndISO = addMinutes(startISO, durationMinutes);
        const free = await isRangeFree(date, employee.calendarId, startISO, rangeEndISO, weeklyScheduleFor(employeeId), { ignoreClosingTime: true });
        if (!free) {
          return res.status(409).json({ error: `${employee.name} no tiene hueco libre el ${date} a las ${timeNorm} para ese tratamiento. Elige otra hora.` });
        }
        const newEvent = await createBookingEvent(employee.calendarId, {
          summary: combinedServiceName,
          description: `Clienta: ${name} · ${phone}`,
          startISO, endISO: rangeEndISO,
          clientEmail: email, clientName: name,
        });
        eventId = newEvent.id;
      }
    }

    // El precio/importe pagado que se pide en el formulario es solo el de
    // los tratamientos SUELTOS (no-bono) de la visita — cada bono, si lo
    // hay, lleva su propio precio aparte (en su fila de SessionBono), para
    // no duplicar el importe.
    const looseItems = resolvedItems.filter((r) => !r.isBono);
    const looseDefaultPrice = looseItems.reduce((sum, r) => sum + r.service.price, 0);
    const bookingPrice = price !== undefined && price !== '' ? Number(price) : (looseItems.length ? looseDefaultPrice : '');
    const bookingAmountPaid = amountPaid !== undefined && amountPaid !== '' ? Number(amountPaid) : 0;

    // Si lo cobrado ahora mismo (la parte suelta, sin contar los bonos) ya
    // cubre el precio entero, no queda nada por cobrar más adelante — se da
    // por cerrada desde ya (igual que una cita pagada al 100% online), en
    // vez de esperar a que pase la fecha de la cita para poder cerrarla a
    // mano. Así aparece ya en "Comprobar cobros" y no se vuelve a contar el
    // saldo de fidelización una segunda vez al cerrarla.
    const extrasFullyPaidNow = bookingPrice !== '' && Number(bookingPrice) > 0
      && bookingAmountPaid > 0 && round2(Number(bookingPrice) - bookingAmountPaid) <= 0;

    // Cada tratamiento de la visita se guarda en su PROPIA fila — comparten
    // fecha/hora/profesional/evento (es la misma visita), pero así cada uno
    // se puede reprogramar, marcar como no-show o eliminar por separado
    // (igual que ya pasa con varios bonos combinados en
    // /panel/book-combined-sessions), en vez de quedar encajonados como un
    // único texto "A + B + C" imposible de tocar por partes.
    const priceRowIdx = resolvedItems.findIndex((r) => !r.isBono);

    const bookingIds = [];
    let priceBookingId = '';
    let priceServiceId = '';
    for (let i = 0; i < resolvedItems.length; i++) {
      const r = resolvedItems[i];
      const isFirst = i === 0;
      const carriesPrice = i === priceRowIdx;
      let rowServiceName = r.service.name;
      let rowBonoId = '';
      let rowSessionNumber = '';
      let rowPaymentType = '';
      let paidOnlineForLoyalty = 0;

      if (r.isBono) {
        const total = Number(r.totalSessions);
        const current = Number(r.sessionNumber);
        // Esta misma cita YA es la sesión "current" (se está dando de alta
        // confirmada, con su hora y calendario) — cuenta como usada desde
        // ya, así que sessionsUsed es "current", no "current - 1" (eso
        // dejaba un bono de 1 sesión ya hecha mostrando "0 de 1 usadas" en
        // vez de "completado", y ofreciendo agendar una sesión inexistente).
        const sessionsUsed = Math.min(total, current);
        const sessionsRemaining = Math.max(0, total - sessionsUsed);
        const bonoPrice = r.bonoTotalPrice !== undefined && r.bonoTotalPrice !== '' ? Number(r.bonoTotalPrice) : round2(r.service.price * total);
        const paidOnline = r.bonoAmountPaid !== undefined && r.bonoAmountPaid !== '' ? Number(r.bonoAmountPaid) : bonoPrice;
        const remainingAmount = Math.max(0, round2(bonoPrice - paidOnline));
        paidOnlineForLoyalty = paidOnline;

        rowBonoId = crypto.randomUUID();
        await appendSessionBono({
          bonoId: rowBonoId,
          createdAt: new Date().toISOString(),
          clientName: name, clientPhone: phone, clientEmail: email,
          serviceId: r.serviceId, serviceName: r.service.name,
          employeeId,
          totalSessions: total,
          sessionsUsed,
          sessionsRemaining,
          totalPrice: bonoPrice,
          amountPaidOnline: paidOnline,
          paymentType: '',
          remainingAmount,
          remainingPaidHow: '',
          status: sessionsRemaining <= 0 ? 'completed' : 'active',
          expiryDate: addMonthsISO(LEGACY_BONO_VALIDITY_MONTHS, bonoPurchaseDate || undefined),
          paymentIntentId: '',
          lang: 'es',
        });
        rowServiceName = `${r.service.name} (${current}/${total})`;
        rowSessionNumber = current;
        rowPaymentType = 'bono';
      }

      const bookingId = crypto.randomUUID();
      await appendBooking({
        bookingId,
        createdAt: new Date().toISOString(),
        status: 'confirmed',
        name, phone, email,
        serviceId: r.serviceId, serviceName: rowServiceName,
        employeeId: employeeId || '', employeeName: employee ? employee.name : '',
        calendarId: employee ? employee.calendarId : '',
        eventId,
        date, time: timeNorm,
        // El ajuste de minutos de toda la visita (si lo hay) se refleja en
        // la fila del primer tratamiento — las demás guardan su duración
        // estándar de catálogo (solo importa de verdad para el hueco de
        // calendario, que ya usa el total ajustado más arriba).
        durationMinutes: isFirst ? Math.max(1, r.service.durationMinutes + extraMin) : r.service.durationMinutes,
        price: carriesPrice ? bookingPrice : (r.isBono ? '' : 0),
        amountPaid: carriesPrice ? bookingAmountPaid : 0,
        paymentType: rowPaymentType,
        paymentIntentId: '',
        lang: 'es',
        reminderSent: '',
        birthdate: isFirst ? (birthdate || '') : '',
        bonoId: rowBonoId,
        sessionNumber: rowSessionNumber,
        notes: isFirst ? (notes || 'Alta manual de cita ya existente.') : '',
        depositPaidHow: carriesPrice ? (paidHow || '') : '',
        ...(carriesPrice && extrasFullyPaidNow && paidHow ? { finalAmount: bookingAmountPaid, remainderPaidHow: paidHow } : {}),
      });
      bookingIds.push(bookingId);
      if (carriesPrice) { priceBookingId = bookingId; priceServiceId = r.serviceId; }

      // El importe de este bono en sí (si lo hay) no vuelve a pasar por
      // /panel/close — se gana siempre aquí, al momento.
      if (paidOnlineForLoyalty > 0 && paidHow) {
        await earnLoyalty({
          booking: { serviceId: r.serviceId, phone, email, name, bookingId },
          portionAmount: paidOnlineForLoyalty,
          paidHow,
        });
      }
    }

    // La parte suelta solo se gana aquí si queda completamente pagada ya
    // (nada por cobrar después). Si queda un resto pendiente, se gana más
    // tarde al cerrar la cita, junto con ese resto y con una sola tasa para
    // el conjunto — igual que una cita con seña pagada online — para no
    // contarla dos veces.
    if (extrasFullyPaidNow && paidHow && phone && priceBookingId) {
      await earnLoyalty({
        booking: { serviceId: priceServiceId, phone, email, name, bookingId: priceBookingId },
        portionAmount: bookingAmountPaid,
        paidHow,
      });
    }

    res.json({ ok: true, bookingId: bookingIds[0], bookingIds });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo dar de alta la reserva.' });
  }
});

// ── Huecos libres para reprogramar una cita concreta ──
router.get('/panel/reschedule-slots', async (req, res) => {
  const { bookingId, bookingIds, date } = req.query;
  if ((!bookingId && !bookingIds) || !date) return res.status(400).json({ error: 'Faltan datos para consultar huecos.' });
  try {
    // bookingIds (varios, separados por coma) es para cuando se van a mover
    // VARIOS tratamientos de la misma visita a la vez — busca la duración
    // conjunta real, no la de un tratamiento suelto (ver /panel/reschedule-combined).
    const ids = bookingIds ? String(bookingIds).split(',').map((s) => s.trim()).filter(Boolean) : [bookingId];
    const bookings = [];
    for (const id of ids) {
      const b = await findBookingById(id);
      if (!b) return res.status(404).json({ error: 'No se ha encontrado esa cita.' });
      bookings.push(b);
    }
    const first = bookings[0];
    const duration = bookings.reduce((sum, b) => sum + (Number(b.durationMinutes) || 0), 0) || 60;
    const slots = await getAvailableSlots(date, first.calendarId, duration, weeklyScheduleFor(first.employeeId), { skipGapHeuristic: true, ignoreClosingTime: true });
    res.json({ slots });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo consultar la disponibilidad.' });
  }
});

// ── Reprogramar cualquier cita (sin límite de 48h — lo decide el equipo) ──
router.post('/panel/reschedule', async (req, res) => {
  const { bookingId, date, time, force } = req.body || {};
  if (!bookingId || !date || !time) return res.status(400).json({ error: 'Faltan datos para reprogramar.' });
  if (!/^\d{2}:\d{2}$/.test(time)) return res.status(400).json({ error: 'Formato de hora inválido.' });
  try {
    // Evita que esto se pise con una cancelación/reprogramación casi
    // simultánea de la misma cita desde "Mis reservas" o desde otra
    // pestaña del panel.
    return await withLock(`booking:${bookingId}`, async () => {
    const booking = await findBookingById(bookingId);
    if (!booking) return res.status(404).json({ error: 'No se ha encontrado esa cita.' });
    if (booking.status !== 'confirmed') {
      return res.status(409).json({ error: 'Esta cita no está activa (cancelada o marcada como falta) — no se puede reprogramar así.' });
    }

    const duration = Number(booking.durationMinutes) || 60;
    // "force" permite al equipo saltarse el cálculo automático de huecos
    // cuando sabe que en realidad sí cabe (p.ej. la duración guardada no
    // es del todo exacta, o quiere aprovechar un hueco que el sistema
    // descarta por criterios que aquí no aplican) — es una herramienta
    // interna, se confía en el criterio de quien la usa.
    if (!force) {
      const freeSlots = await getAvailableSlots(date, booking.calendarId, duration, weeklyScheduleFor(booking.employeeId), { skipGapHeuristic: true, ignoreClosingTime: true });
      if (!freeSlots.includes(time)) {
        return res.status(409).json({ error: 'Ese hueco ya no está disponible. Elige otra hora (o fuerza igualmente si sabes que sí cabe).' });
      }
    }

    const startISO = localToISO(date, time.length === 5 ? time : `${time}:00`, hours.timezone);
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
      await updateEvent(booking.calendarId, booking.eventId, { start: { dateTime: startISO }, end: { dateTime: endISO } });
    } else {
      const event = await createBookingEvent(booking.calendarId, {
        summary: booking.serviceName || 'Cita Osana',
        description: `Clienta: ${booking.name || ''} · ${booking.phone || ''}`,
        startISO, endISO,
      });
      newEventId = event.id;
    }

    const oldDate = booking.date;
    const oldTime = booking.time;
    await updateBookingRow(booking._sheetRow, booking, { date, time, eventId: newEventId });

    if (booking.email) {
      sendEmail({
        to: booking.email,
        subject: booking.lang === 'en' ? 'Your appointment was rescheduled — Osana' : 'Tu cita ha sido reprogramada — Osana',
        html: rescheduleEmailHtml({ booking, oldDate, oldTime, newDate: date, newTime: time }),
      }).catch((e) => console.error('No se pudo avisar por email de la reprogramación:', e));
    }

    res.json({ ok: true });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo reprogramar.' });
  }
});

// ── Reprogramar varios tratamientos de una misma visita (que comparten
// hueco de calendario) a la vez, con un solo cambio de fecha/hora — para no
// tener que reprogramar cada uno por separado. Si se elige a TODOS los que
// comparten el evento original, se mueve ese evento entero; si se deja
// alguno sin marcar (p.ej. un bono que no se sabe si se va a renovar, o que
// va a un ritmo distinto), ese se queda donde estaba y los marcados se
// mueven a un evento nuevo aparte.
router.post('/panel/reschedule-combined', async (req, res) => {
  const { bookingIds, date, time, force } = req.body || {};
  if (!Array.isArray(bookingIds) || bookingIds.length < 2 || !date || !time) {
    return res.status(400).json({ error: 'Elige al menos dos tratamientos, fecha y hora.' });
  }
  if (!/^\d{2}:\d{2}$/.test(time)) return res.status(400).json({ error: 'Formato de hora inválido.' });
  const uniqueIds = [...new Set(bookingIds)];
  try {
    return await withLocks(uniqueIds.slice().sort().map((id) => `booking:${id}`), async () => {
    const bookings = [];
    for (const id of uniqueIds) {
      const booking = await findBookingById(id);
      if (!booking) return res.status(404).json({ error: 'Una de las citas ya no existe.' });
      if (booking.status !== 'confirmed') {
        return res.status(409).json({ error: `"${booking.serviceName}" ya no está activa — no se puede mover así.` });
      }
      bookings.push(booking);
    }
    const first = bookings[0];
    if (!bookings.every((b) => b.calendarId === first.calendarId && b.employeeId === first.employeeId)) {
      return res.status(400).json({ error: 'Los tratamientos elegidos no son de la misma profesional/calendario.' });
    }

    const duration = bookings.reduce((sum, b) => sum + (Number(b.durationMinutes) || 0), 0);
    if (!force) {
      const freeSlots = await getAvailableSlots(date, first.calendarId, duration, weeklyScheduleFor(first.employeeId), { skipGapHeuristic: true, ignoreClosingTime: true });
      if (!freeSlots.includes(time)) {
        return res.status(409).json({ error: 'Ese hueco ya no está disponible. Elige otra hora (o fuerza igualmente si sabes que sí cabe).' });
      }
    }

    const startISO = localToISO(date, time.length === 5 ? time : `${time}:00`, hours.timezone);
    const endISO = addMinutes(startISO, duration);

    // Si se mueven TODOS los tratamientos que compartían el evento original,
    // se parchea ese mismo evento. Si se deja alguno atrás, ese evento se
    // queda tal cual para el que no se mueve, y se crea uno nuevo solo para
    // los que sí se mueven (mismo patrón que /panel/reschedule).
    const allBookingsForCheck = await getAllBookings();
    const originalSiblings = allBookingsForCheck.filter((b) => b.status === 'confirmed' && b.calendarId === first.calendarId && b.eventId === first.eventId);
    const movingIds = new Set(uniqueIds);
    const allMoving = originalSiblings.every((b) => movingIds.has(b.bookingId));

    let newEventId = first.eventId;
    if (allMoving && await isEventUsable(first.calendarId, first.eventId)) {
      await updateEvent(first.calendarId, first.eventId, { start: { dateTime: startISO }, end: { dateTime: endISO } });
    } else {
      const event = await createBookingEvent(first.calendarId, {
        summary: bookings.map((b) => b.serviceName).join(' + '),
        description: `Cliente: ${first.name || ''} · ${first.phone || ''}`,
        startISO, endISO,
        clientEmail: first.email, clientName: first.name,
      });
      newEventId = event.id;
    }

    for (const booking of bookings) {
      await updateBookingRow(booking._sheetRow, booking, { date, time, eventId: newEventId });
    }

    if (first.email) {
      sendEmail({
        to: first.email,
        subject: first.lang === 'en' ? 'Your appointment was rescheduled — Osana' : 'Tu cita ha sido reprogramada — Osana',
        html: rescheduleEmailHtml({ booking: first, oldDate: first.date, oldTime: first.time, newDate: date, newTime: time }),
      }).catch((e) => console.error('No se pudo avisar por email de la reprogramación:', e));
    }

    res.json({ ok: true });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo reprogramar la cita combinada.' });
  }
});

// ── Ampliar el tiempo bloqueado de una cita (sin cambiar fecha/hora de
// inicio) — útil cuando una clienta concreta necesita más tiempo del
// habitual y hay que reservar ese hueco extra en el calendario para que
// nadie más pueda reservarlo justo después.
router.post('/panel/extend-time', async (req, res) => {
  const { bookingId, extraMinutes } = req.body || {};
  const extra = Number(extraMinutes);
  if (!bookingId || !extra || extra <= 0) {
    return res.status(400).json({ error: 'Indica cuántos minutos extra añadir.' });
  }
  try {
    const booking = await findBookingById(bookingId);
    if (!booking) return res.status(404).json({ error: 'No se ha encontrado esa cita.' });
    if (booking.status !== 'confirmed') return res.status(409).json({ error: 'Esta cita ya no está activa.' });

    const duration = Number(booking.durationMinutes) || 60;
    const time = booking.time.length === 5 ? booking.time : `${booking.time}:00`;
    const startISO = localToISO(booking.date, time, hours.timezone);
    const currentEndISO = addMinutes(startISO, duration);
    const newEndISO = addMinutes(currentEndISO, extra);

    const free = await isRangeFree(booking.date, booking.calendarId, currentEndISO, newEndISO, weeklyScheduleFor(booking.employeeId), { ignoreClosingTime: true });
    if (!free) {
      return res.status(409).json({ error: 'No hay hueco libre justo después de esta cita para ampliar ese tiempo.' });
    }

    // Si el evento ya no es usable (p.ej. quedó "cancelado" en Google tras
    // un borrado anterior), un simple patch no lo alarga de verdad —
    // creamos uno nuevo que cubra toda la cita.
    let newEventId = booking.eventId;
    if (await isEventUsable(booking.calendarId, booking.eventId)) {
      await updateEvent(booking.calendarId, booking.eventId, { end: { dateTime: newEndISO } });
    } else {
      const event = await createBookingEvent(booking.calendarId, {
        summary: booking.serviceName || 'Cita Osana',
        description: `Clienta: ${booking.name || ''} · ${booking.phone || ''}`,
        startISO, endISO: newEndISO,
      });
      newEventId = event.id;
    }
    await updateBookingRow(booking._sheetRow, booking, { durationMinutes: duration + extra, eventId: newEventId });

    res.json({ ok: true, newDurationMinutes: duration + extra });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo ampliar el tiempo de la cita.' });
  }
});

// ── Ajustar de una vez la duración TOTAL de una visita combinada (varios
// tratamientos que comparten el mismo hueco de calendario) — antes, editar
// la duración de un solo tratamiento de una cita combinada (ver
// /panel/edit-booking) se guardaba en la Sheet pero NO llegaba a tocar el
// calendario real, porque esa ruta se niega a parchear un evento que
// comparte con otros tratamientos activos sin contabilizar (para no
// descuadrar el hueco de los demás sin querer). Aquí se pasa el grupo
// COMPLETO de la visita, así que si toca alargar o acortar el hueco de
// verdad, se puede hacer con seguridad.
router.post('/panel/visit-duration', async (req, res) => {
  const { bookingIds, durationMinutes } = req.body || {};
  if (!Array.isArray(bookingIds) || !bookingIds.length || !durationMinutes) {
    return res.status(400).json({ error: 'Indica los tratamientos y la nueva duración total.' });
  }
  const newTotal = Math.round(Number(durationMinutes));
  if (!Number.isFinite(newTotal) || newTotal < 5) {
    return res.status(400).json({ error: 'La duración no es un número de minutos válido.' });
  }
  const uniqueIds = [...new Set(bookingIds)];
  try {
    return await withLocks(uniqueIds.slice().sort().map((id) => `booking:${id}`), async () => {
    const bookings = [];
    for (const id of uniqueIds) {
      const booking = await findBookingById(id);
      if (!booking) return res.status(404).json({ error: 'Una de las citas ya no existe.' });
      if (booking.status !== 'confirmed') return res.status(409).json({ error: `"${booking.serviceName}" ya no está activa.` });
      bookings.push(booking);
    }
    const first = bookings[0];
    if (!bookings.every((b) => b.calendarId === first.calendarId && b.eventId === first.eventId)) {
      return res.status(400).json({ error: 'Los tratamientos elegidos no son de la misma visita.' });
    }
    // Tienen que venir TODOS los tratamientos activos que comparten ese
    // evento — si faltara alguno, no sabríamos cuánto de la duración total
    // real es suyo, y el hueco del calendario se descuadraría para él.
    const allBookingsForCheck = await getAllBookings();
    const allSiblings = allBookingsForCheck.filter((b) => b.status === 'confirmed' && b.calendarId === first.calendarId && b.eventId === first.eventId);
    if (allSiblings.length !== bookings.length) {
      return res.status(400).json({ error: 'Faltan tratamientos de esta visita por incluir — recarga la página e inténtalo de nuevo.' });
    }

    const currentTotal = bookings.reduce((sum, b) => sum + (Number(b.durationMinutes) || 0), 0);
    const delta = newTotal - currentTotal;
    if (delta === 0) return res.json({ ok: true, durationMinutes: newTotal });

    const time = first.time.length === 5 ? first.time : `${first.time}:00`;
    const startISO = localToISO(first.date, time, hours.timezone);
    const currentEndISO = addMinutes(startISO, currentTotal);
    const newEndISO = addMinutes(startISO, newTotal);

    // Si se alarga, comprobamos que el tiempo extra está libre justo
    // después — igual que "Ampliar tiempo". Si se acorta, no hace falta
    // comprobar nada (libera hueco, nunca lo invade).
    if (delta > 0) {
      const free = await isRangeFree(first.date, first.calendarId, currentEndISO, newEndISO, weeklyScheduleFor(first.employeeId), { ignoreClosingTime: true });
      if (!free) {
        return res.status(409).json({ error: 'No hay hueco libre justo después de esta visita para alargarla tanto tiempo.' });
      }
    }

    if (await isEventUsable(first.calendarId, first.eventId)) {
      await updateEvent(first.calendarId, first.eventId, { end: { dateTime: newEndISO } });
    } else {
      const event = await createBookingEvent(first.calendarId, {
        summary: bookings.map((b) => b.serviceName).join(' + '),
        description: `Cliente: ${first.name || ''} · ${first.phone || ''}`,
        startISO, endISO: newEndISO,
      });
      for (const b of bookings) {
        await updateBookingRow(b._sheetRow, b, { eventId: event.id });
      }
    }

    // El ajuste (positivo o negativo) se guarda sumado a la duración de la
    // PRIMERA línea — igual que el criterio de "un total para toda la
    // visita" en Cerrar cita — así, si más adelante se reprograma el
    // conjunto, la suma de las líneas sigue reflejando la duración real.
    const newFirstDuration = Math.max(1, (Number(first.durationMinutes) || 0) + delta);
    await updateBookingRow(first._sheetRow, first, { durationMinutes: newFirstDuration });

    res.json({ ok: true, durationMinutes: newTotal });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo ajustar la duración de la visita.' });
  }
});

// ── Cerrar cita: registrar importe total real y cómo se pagó el resto,
// sin tocar amountPaid (el pago online por Stripe queda como registro
// histórico intacto) — y acumular saldo de fidelización.
router.post('/panel/close', async (req, res) => {
  // remainderAmount2/paidHow2 son opcionales — para cuando el resto se paga
  // dividido entre dos formas de pago (p.ej. mitad tarjeta, mitad efectivo).
  // redeemAmount es opcional — saldo de fidelización que se aplica como
  // descuento directamente aquí, para no tener que restarlo a mano.
  // giftCode es opcional — bono regalo de importe que se aplica como
  // descuento igual que el saldo, y queda marcado como canjeado.
  // bonoPaydown es opcional — cuánto de este cobro corresponde a pagar el
  // pendiente de un bono (ver comentario junto a su uso más abajo).
  const {
    bookingId, finalAmount, paidHow, remainderAmount2, paidHow2, redeemAmount, giftCode, bonoPaydown,
  } = req.body || {};
  if (!bookingId) return res.status(400).json({ error: 'Falta el identificador de la cita.' });
  if (finalAmount !== undefined && finalAmount !== '' && !Number.isFinite(Number(finalAmount))) {
    return res.status(400).json({ error: 'El importe total no es un número válido.' });
  }
  try {
    // Doble clic en "Cerrar cita", o dos pestañas del panel a la vez,
    // podrían leer "alreadyClosed=false" ambas antes de que ninguna
    // escriba — el bloqueo serializa las peticiones sobre la misma cita.
    return await withLock(`booking:${bookingId}`, async () => {
    const booking = await findBookingById(bookingId);
    if (!booking) return res.status(404).json({ error: 'No se ha encontrado esa cita.' });
    if (booking.status !== 'confirmed') {
      return res.status(409).json({ error: 'Esta cita ya no está activa (cancelada o marcada como falta) — revisa su estado antes de cerrarla.' });
    }

    // Ya cerrada antes: no volver a acumular saldo por duplicado.
    const alreadyClosed = booking.finalAmount !== undefined && booking.finalAmount !== '';

    const onlinePaid = Number(booking.amountPaid) || 0;
    const total = finalAmount !== undefined && finalAmount !== '' ? Number(finalAmount) : onlinePaid;
    let remainder = Math.max(0, round2(total - onlinePaid));

    // Canjear un bono regalo de importe (tipo "amount") aquí mismo, igual
    // que el saldo de fidelización: se resta del resto y el bono regalo
    // queda marcado como canjeado — antes esto eran dos pasos sueltos sin
    // relación entre sí, así que canjear el código no bajaba nada de lo
    // que realmente se cobraba (el bono de tratamiento fijo sigue
    // canjeándose aparte en "🎁 Bono regalo", no aquí).
    let giftApplied = 0;
    let giftRow = null;
    if (!alreadyClosed && giftCode && String(giftCode).trim()) {
      const cleanCode = String(giftCode).trim().toUpperCase();
      const gifts = await getAllGifts();
      giftRow = gifts.find((g) => String(g.code || '').trim().toUpperCase() === cleanCode);
      if (!giftRow) return res.status(404).json({ error: 'No se ha encontrado ningún bono regalo con ese código.' });
      if (giftRow.status === 'redeemed') return res.status(409).json({ error: 'Este bono regalo ya se marcó como canjeado.' });
      if (giftRow.giftType !== 'amount') {
        return res.status(400).json({ error: 'Este bono regalo es de tratamiento fijo — márcalo como canjeado desde "🎁 Bono regalo", no reduce un importe aquí.' });
      }
      giftApplied = Math.max(0, Math.min(remainder, round2(Number(giftRow.amount) || 0)));
      remainder = round2(remainder - giftApplied);
    }

    // Calcular canje de saldo (si se pide): se resta del resto antes de
    // repartirlo en formas de pago, y nunca puede superar ni lo que queda
    // por pagar ni el saldo real disponible de la clienta. Vale tanto en
    // tratamientos sueltos como en sesiones de un bono, con un mínimo de
    // MIN_REDEEM_AMOUNT por canje. Solo se CALCULA aquí; el movimiento en
    // el libro de saldo se escribe más abajo, después de marcar la cita
    // como cerrada, para que un reintento tras un fallo a mitad de camino
    // no pueda duplicar el canje (ver nota junto a updateBookingRow).
    let redeemed = 0;
    let phoneN = '';
    if (!alreadyClosed && redeemAmount && Number(redeemAmount) >= MIN_REDEEM_AMOUNT) {
      phoneN = normalizePhone(booking.phone);
      const movements = await getLoyaltyMovementsForPhone(phoneN);
      const balance = computeLoyaltyBalance(movements);
      redeemed = Math.max(0, Math.min(remainder, balance, round2(Number(redeemAmount))));
      if (redeemed > 0) remainder = round2(remainder - redeemed);
    }

    const part2 = Math.max(0, Math.min(remainder, round2(Number(remainderAmount2) || 0)));
    const part1 = round2(remainder - part2);

    // remainingPaidHow del bono solo se rellena al cobrar el resto real
    // (sesión 1, cuando se hizo la seña) — en las sesiones siguientes
    // (amountPaid=0, ya cobradas) no hay nada nuevo que cobrar, y sobrescribir
    // aquí borraría el registro de cómo se cobró el resto en su momento.
    if (booking.bonoId && String(booking.sessionNumber) === '1') {
      const bono = await findSessionBonoById(booking.bonoId);
      if (bono) {
        await updateSessionBonoRow(bono._sheetRow, bono, { remainingPaidHow: paidHow || '' });
      }
    }

    // Escribimos primero la fila de la cita (lo que la marca como "cerrada"
    // para futuras llamadas) y solo después los movimientos de saldo — así,
    // si algo falla a mitad de camino y se reintenta, alreadyClosed ya será
    // true y no se puede duplicar ni el canje ni el ingreso de puntos.
    // Si ya estaba cerrada (se está corrigiendo un dato), no se toca
    // redeemedAmount para no borrar un canje ya aplicado la primera vez.
    await updateBookingRow(booking._sheetRow, booking, {
      finalAmount: total,
      remainderPaidHow: paidHow || '',
      remainderAmount2: part2 || '',
      remainderPaidHow2: part2 > 0 ? (paidHow2 || '') : '',
      ...(alreadyClosed ? {} : { redeemedAmount: redeemed || '' }),
    });

    if (!alreadyClosed) {
      if (redeemed > 0) {
        await appendLoyaltyMovement({
          date: new Date().toISOString().slice(0, 10),
          phoneNormalized: phoneN,
          emailNormalized: normalizeEmail(booking.email),
          name: booking.name,
          type: 'redeem',
          bookingId: booking.bookingId,
          serviceName: booking.serviceName,
          category: '',
          baseAmount: '',
          paidHow: '',
          rateApplied: '',
          amount: redeemed,
        });
      }

      if (giftRow && giftApplied > 0) {
        await updateGiftRow(giftRow._sheetRow, { status: 'redeemed', redeemedAt: new Date().toISOString() });
      }

      // bonoPaydown: cuánto de este cobro va a pagar el pendiente que aún
      // arrastraba el bono (bono.remainingAmount) — antes esa cifra se
      // fijaba al crear/convertir el bono y ya no se tocaba nunca más, así
      // que se quedaba desactualizada aunque la clienta fuese pagando poco
      // a poco en visitas siguientes. No depende de qué sesión sea (el
      // pendiente es del bono entero, no de una sesión concreta) — y se
      // escribe aquí, después de marcar la cita como cerrada, por la misma
      // razón que el canje de saldo: un reintento no puede duplicarlo.
      if (booking.bonoId && bonoPaydown && Number(bonoPaydown) > 0) {
        const bono = await findSessionBonoById(booking.bonoId);
        if (bono && Number(bono.remainingAmount) > 0) {
          const paydownApplied = Math.max(0, Math.min(round2(Number(bono.remainingAmount)), round2(Number(bonoPaydown))));
          if (paydownApplied > 0) {
            await updateSessionBonoRow(bono._sheetRow, bono, {
              remainingAmount: round2(Number(bono.remainingAmount) - paydownApplied),
              remainingPaidHow: bono.remainingPaidHow || paidHow || '',
            });
          }
        }
      }

      // El saldo se acumula sobre TODO lo pagado de verdad (seña online +
      // resto), con una sola tasa para el conjunto: si alguna parte del
      // resto se pagó en efectivo, se aplica la tasa de efectivo al total
      // (no solo a esa parte) — así la clienta no nota que "solo una parte"
      // llevaba la bonificación, que da pie a quejas y confusión.
      // OJO: "paidHow" viene de un desplegable que siempre tiene algo
      // seleccionado (por defecto "Efectivo"), aunque no quede nada por
      // cobrar en el centro (cita pagada 100% online) — remainderCollected
      // evita que ese valor por defecto, sin que nadie haya cobrado nada en
      // efectivo, dispare el plus del 2% sobre un pago que en realidad fue
      // con tarjeta/Klarna online.
      const remainderCollected = part1 > 0 || part2 > 0;
      const cashInvolved = remainderCollected && ((part1 > 0 && paidHow === 'efectivo') || (part2 > 0 && paidHow2 === 'efectivo'));
      const totalPaidReal = round2(onlinePaid + part1 + part2);
      const effectivePaidHow = remainderCollected ? (cashInvolved ? 'efectivo' : (paidHow || 'tarjeta')) : 'tarjeta';
      await earnLoyalty({ booking, portionAmount: totalPaidReal, paidHow: effectivePaidHow });

      // Las líneas "extra" añadidas a esta misma cita (ver /panel/product-sale)
      // por defecto no llevan forma de pago propia — se resuelven aquí con la
      // misma forma de pago que el resto de la visita, para no preguntarlo dos
      // veces en el caso normal. Pero si una línea SÍ trae su propia paidHow
      // (p.ej. el tratamiento se pagó con tarjeta y el extra en efectivo, en
      // el momento), se respeta esa y no se pisa con la del resto. Así también
      // se acumula su saldo de fidelización, que antes se quedaba sin acumular
      // hasta que esto se cerraba.
      const linkedExtras = (await getAllProductSales()).filter((s) => s.bookingId === booking.bookingId);
      for (const extra of linkedExtras) {
        const extraPaidHow = extra.paidHow || effectivePaidHow;
        if (!extra.paidHow) await updateProductSaleRow(extra._sheetRow, extra, { paidHow: extraPaidHow });
        await earnLoyalty({
          booking: { phone: booking.phone, email: booking.email, name: booking.name, bookingId: booking.bookingId, serviceName: extra.product },
          portionAmount: Number(extra.amount) || 0,
          paidHow: extraPaidHow,
          category: extra.category || 'venta',
        });
      }
    }

    res.json({ ok: true });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cerrar la cita.' });
  }
});

// ── Registrar venta de producto suelta (no ligada a ninguna cita) — si se
// identifica a la clienta (teléfono), también acumula saldo de fidelidad
// sobre el importe, igual que un tratamiento o un bono (pero ese saldo
// nunca se podrá gastar para pagar otro producto, solo tratamientos/bonos).
const EXTRA_CATEGORIES = ['facial', 'corporal', 'laser', 'cejas', 'venta'];

router.post('/panel/product-sale', async (req, res) => {
  const { date, product, amount, paidHow, notes, clientPhone, clientName, clientEmail, category, bookingId } = req.body || {};
  if (!date || !product || !amount) return res.status(400).json({ error: 'Faltan datos de la venta.' });
  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    return res.status(400).json({ error: 'El importe no es un número válido.' });
  }
  const cat = category && EXTRA_CATEGORIES.includes(category) ? category : 'venta';
  try {
    const saleId = crypto.randomUUID();
    await appendProductSale({
      saleId,
      createdAt: new Date().toISOString(),
      date,
      product,
      amount: Number(amount),
      paidHow: paidHow || '',
      notes: notes || '',
      category: cat,
      bookingId: bookingId || '',
      status: 'active',
      clientPhone: clientPhone || '',
      clientName: clientName || '',
      clientEmail: clientEmail || '',
    });

    // Si esta línea va enganchada a una cita, cómo se pagó se decide UNA
    // sola vez al cerrar toda la visita (junto con el tratamiento) — no
    // aquí, para no pedir la forma de pago dos veces en el mismo sitio.
    // El saldo de fidelización se acumula entonces, no ahora.
    if (!bookingId && clientPhone && clientPhone.trim()) {
      await earnLoyalty({
        booking: {
          phone: clientPhone.trim(), email: clientEmail || '', name: clientName || '',
          bookingId: saleId, serviceName: product,
        },
        portionAmount: Number(amount),
        paidHow: paidHow || 'tarjeta',
        category: cat,
      });
    }

    res.json({ ok: true, saleId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo registrar la venta.' });
  }
});

// ── Quitar (o corregir) una línea "extra"/venta de producto ya registrada —
// no se borra físicamente, se marca como inactiva para conservar el rastro
// contable, igual que se hace con las citas ──
router.post('/panel/product-sale-edit', async (req, res) => {
  const { saleId, product, amount, paidHow, category, deleted } = req.body || {};
  if (!saleId) return res.status(400).json({ error: 'Falta el identificador de la línea.' });
  if (amount !== undefined && amount !== '' && (!Number.isFinite(Number(amount)) || Number(amount) <= 0)) {
    return res.status(400).json({ error: 'El importe no es un número válido.' });
  }
  try {
    const all = await getAllProductSales();
    const sale = all.find((s) => s.saleId === saleId);
    if (!sale) return res.status(404).json({ error: 'No se ha encontrado esa línea.' });
    const updates = {};
    if (deleted) {
      updates.status = 'deleted';
    } else {
      if (product !== undefined && product !== '') updates.product = product;
      if (amount !== undefined && amount !== '') updates.amount = Number(amount);
      if (paidHow === 'auto') updates.paidHow = '';
      else if (paidHow !== undefined && paidHow !== '') updates.paidHow = paidHow;
      if (category && EXTRA_CATEGORIES.includes(category)) updates.category = category;
    }
    await updateProductSaleRow(sale._sheetRow, sale, updates);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar la línea.' });
  }
});

// ── Canjear saldo de fidelización (aplicado como descuento en el centro) ──
router.post('/panel/redeem', async (req, res) => {
  const { phone, amount, bookingId } = req.body || {};
  const redeemAmount = round2(Number(amount));
  if (!phone || !redeemAmount || redeemAmount <= 0) {
    return res.status(400).json({ error: 'Indica el teléfono de la clienta y el importe a canjear.' });
  }
  if (redeemAmount < MIN_REDEEM_AMOUNT) {
    return res.status(400).json({ error: `El canje mínimo es de ${MIN_REDEEM_AMOUNT} €.` });
  }
  try {
    const phoneN = normalizePhone(phone);
    // Dos canjes casi simultáneos para el mismo teléfono podrían leer el
    // mismo saldo antes de que ninguno escriba, y los dos pasar el chequeo
    // de saldo suficiente — el bloqueo serializa las peticiones.
    return await withLock(`loyalty:${phoneN}`, async () => {
    const movements = await getLoyaltyMovementsForPhone(phoneN);
    const balance = computeLoyaltyBalance(movements);
    if (redeemAmount > balance) {
      return res.status(409).json({ error: `Saldo insuficiente: dispone de ${balance.toFixed(2)} €.` });
    }

    let name = '';
    if (bookingId) {
      const booking = await findBookingById(bookingId);
      if (booking) name = booking.name;
    }
    if (!name && movements.length) name = movements[movements.length - 1].name;

    await appendLoyaltyMovement({
      date: new Date().toISOString().slice(0, 10),
      phoneNormalized: phoneN,
      emailNormalized: '',
      name,
      type: 'redeem',
      bookingId: bookingId || '',
      serviceName: '',
      category: '',
      baseAmount: '',
      paidHow: '',
      rateApplied: '',
      amount: redeemAmount,
    });

    res.json({ ok: true, newBalance: round2(balance - redeemAmount) });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo canjear el saldo.' });
  }
});

// ── Añadir saldo de fidelización a mano (p.ej. por un malentendido o
// como detalle puntual) — queda registrado con el motivo, para que se
// pueda distinguir del saldo ganado automáticamente en las citas.
router.post('/panel/loyalty-adjust', async (req, res) => {
  const { phone, amount, note } = req.body || {};
  const addAmount = round2(Number(amount));
  if (!phone || !addAmount || addAmount <= 0) {
    return res.status(400).json({ error: 'Indica el teléfono de la clienta y el importe a añadir.' });
  }
  if (!note || !note.trim()) {
    return res.status(400).json({ error: 'Indica el motivo del ajuste, para dejar constancia.' });
  }
  try {
    const phoneN = normalizePhone(phone);
    const movements = await getLoyaltyMovementsForPhone(phoneN);
    const name = movements.length ? movements[movements.length - 1].name : '';

    await appendLoyaltyMovement({
      date: new Date().toISOString().slice(0, 10),
      phoneNormalized: phoneN,
      emailNormalized: '',
      name,
      type: 'manual_adjustment',
      bookingId: '',
      serviceName: '',
      category: '',
      baseAmount: '',
      paidHow: '',
      rateApplied: '',
      amount: addAmount,
      note: note.trim(),
    });

    res.json({ ok: true, newBalance: computeLoyaltyBalance([...movements, { type: 'manual_adjustment', amount: addAmount, date: new Date().toISOString().slice(0, 10) }]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo añadir el saldo.' });
  }
});

// ── Corregir los datos de una clienta (nombre, teléfono o email mal
// escritos) en TODO su historial a la vez — reservas, bonos, avisos de
// ausencia y puntos de fidelidad — para que quede todo bajo una sola
// identidad y no se fragmenten los puntos ya ganados por un dato mal puesto.
router.post('/panel/edit-client', async (req, res) => {
  const { oldPhone, name, phone, email, birthdate } = req.body || {};
  if (!oldPhone || !name || !name.trim() || !phone || !phone.trim()) {
    return res.status(400).json({ error: 'Indica el teléfono original y el nombre y teléfono corregidos.' });
  }
  try {
    const oldPhoneN = normalizePhone(oldPhone);
    if (!oldPhoneN) return res.status(400).json({ error: 'El teléfono original no es válido.' });
    const cleanName = name.trim();
    const cleanPhone = phone.trim();
    const cleanEmail = (email || '').trim();
    // birthdate: si el campo no viene en la petición (llamadas antiguas),
    // no se toca; si viene, se escribe tal cual, incluso vacío — así se
    // puede corregir un cumpleaños mal escrito y no queda fijado para
    // siempre desde que se creó la primera reserva.
    const birthdateProvided = birthdate !== undefined;
    const cleanBirthdate = (birthdate || '').trim();
    const newPhoneN = normalizePhone(cleanPhone);
    const newEmailN = normalizeEmail(cleanEmail);

    const [allBookings, allBonos, allStrikes, allLoyalty] = await Promise.all([
      getAllBookings(), getAllSessionBonos(), getAllStrikeRecords(), getAllLoyaltyMovements(),
    ]);

    let bookingsUpdated = 0;
    for (const b of allBookings) {
      if (normalizePhone(b.phone) === oldPhoneN) {
        await updateBookingRow(b._sheetRow, b, {
          name: cleanName, phone: cleanPhone, email: cleanEmail || b.email,
          ...(birthdateProvided ? { birthdate: cleanBirthdate } : {}),
        });
        bookingsUpdated += 1;
      }
    }
    for (const bo of allBonos) {
      if (normalizePhone(bo.clientPhone) === oldPhoneN) {
        await updateSessionBonoRow(bo._sheetRow, bo, {
          clientName: cleanName, clientPhone: cleanPhone, clientEmail: cleanEmail || bo.clientEmail,
        });
      }
    }
    for (const s of allStrikes) {
      if (s.phoneNormalized === oldPhoneN) {
        await upsertStrikeRecord({ phoneNormalized: newPhoneN, emailNormalized: newEmailN || s.emailNormalized, name: cleanName }, s);
      }
    }
    for (const m of allLoyalty) {
      if (m.phoneNormalized === oldPhoneN) {
        await updateLoyaltyMovementRow(m._sheetRow, m, {
          phoneNormalized: newPhoneN, emailNormalized: newEmailN || m.emailNormalized, name: cleanName,
        });
      }
    }

    res.json({ ok: true, bookingsUpdated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron actualizar los datos de la clienta.' });
  }
});

// Aviso breve y general de la política de faltas — el mismo texto se usa
// aquí (email) y en el panel/Mis Reservas, para que nadie pueda decir luego
// que no lo sabía o que no lo leyó.
const NO_SHOW_POLICY_NOTE_ES = 'A partir de ahora te pedimos avisarnos con al menos 48h si necesitas cambiar o cancelar una cita: la próxima vez que faltes sin avisar (o cambies con menos de 48h), se descontará la sesión de tu bono, o el importe de la reserva si no tienes bono.';
const NO_SHOW_POLICY_NOTE_EN = 'From now on, please give us at least 48h notice if you need to change or cancel an appointment: next time you miss one without notice (or change it with less than 48h notice), the session from your package will be deducted, or the booking fee if you don\'t have one.';

function noShowEmailHtml({ isFirstTime, booking, bono, lang }) {
  const isEn = lang === 'en';
  if (isFirstTime) {
    return isEn
      ? `<div style="font-family:Arial,sans-serif;color:#2a2520;max-width:480px;margin:0 auto;">
          <h2 style="font-size:18px;">Update on your appointment — Osana</h2>
          <p><b>Treatment:</b> ${booking.serviceName}<br><b>Date:</b> ${booking.date}<br><b>Status:</b> No-show — this first time, nothing was charged or deducted.</p>
          <p><b>${NO_SHOW_POLICY_NOTE_EN}</b></p>
          <p>Want to reschedule? Go to My Bookings or message us on WhatsApp.</p>
        </div>`
      : `<div style="font-family:Arial,sans-serif;color:#2a2520;max-width:480px;margin:0 auto;">
          <h2 style="font-size:18px;">Actualización de tu cita — Osana</h2>
          <p><b>Cita:</b> ${booking.serviceName}<br><b>Fecha:</b> ${booking.date}<br><b>Estado:</b> Falta sin penalización — esta primera vez no se te ha cobrado ni descontado nada.</p>
          <p><b>${NO_SHOW_POLICY_NOTE_ES}</b></p>
          <p>¿Quieres reprogramar? Entra en Mis Reservas o escríbenos por WhatsApp.</p>
        </div>`;
  }
  const remainingLine = bono ? `<p><b>Sesiones restantes en tu bono: ${bono.sessionsRemaining} de ${bono.totalSessions}</b></p>` : '';
  const remainingLineEn = bono ? `<p><b>Sessions remaining in your package: ${bono.sessionsRemaining} of ${bono.totalSessions}</b></p>` : '';
  return isEn
    ? `<div style="font-family:Arial,sans-serif;color:#2a2520;max-width:480px;margin:0 auto;">
        <h2 style="font-size:18px;">Update on your appointment — Osana</h2>
        <p><b>Treatment:</b> ${booking.serviceName}<br><b>Date:</b> ${booking.date}<br><b>Status:</b> No-show</p>
        <p><b>Session deducted: Yes (1 session)</b></p>
        ${remainingLineEn}
        <p>Your free first-time pass was already used on a previous no-show, so this one counts. Please give us at least 48h notice next time if you need to change or cancel an appointment.</p>
        <p>Want to reschedule? Go to My Bookings or message us on WhatsApp.</p>
      </div>`
    : `<div style="font-family:Arial,sans-serif;color:#2a2520;max-width:480px;margin:0 auto;">
        <h2 style="font-size:18px;">Actualización de tu cita — Osana</h2>
        <p><b>Cita:</b> ${booking.serviceName}<br><b>Fecha:</b> ${booking.date}<br><b>Estado:</b> Ausencia sin preaviso</p>
        <p><b>Sesión descontada: Sí (1 sesión)</b></p>
        ${remainingLine}
        <p>Ya usaste tu comodín de la primera falta en una ausencia anterior, así que esta sí cuenta. Te pedimos avisarnos con al menos 48h la próxima vez que necesites cambiar o cancelar una cita.</p>
        <p>¿Quieres reprogramar? Entra en Mis Reservas o escríbenos por WhatsApp.</p>
      </div>`;
}

// Aviso a la clienta cuando el equipo cambia la fecha/hora de su cita desde
// el panel (a diferencia de cuando reprograma ella misma desde "Mis
// Reservas", donde ya lo ve confirmado en pantalla al momento).
function rescheduleEmailHtml({ booking, oldDate, oldTime, newDate, newTime }) {
  const isEn = booking.lang === 'en';
  return isEn
    ? `<div style="font-family:Arial,sans-serif;color:#2a2520;max-width:480px;margin:0 auto;">
        <h2 style="font-size:18px;">Your appointment was rescheduled</h2>
        <p>Hi ${escapeHtml(booking.name || '')},</p>
        <p>Our team has moved your appointment for <b>${escapeHtml(booking.serviceName || '')}</b>:</p>
        <p>Was: ${oldDate} at ${oldTime}<br>Now: <b>${newDate} at ${newTime}</b></p>
        <p>If this doesn't work for you, message us on WhatsApp and we'll find another time.</p>
        <p>See you soon!<br>Osana</p>
      </div>`
    : `<div style="font-family:Arial,sans-serif;color:#2a2520;max-width:480px;margin:0 auto;">
        <h2 style="font-size:18px;">Tu cita ha sido reprogramada</h2>
        <p>Hola ${escapeHtml(booking.name || '')},</p>
        <p>Nuestro equipo ha movido tu cita de <b>${escapeHtml(booking.serviceName || '')}</b>:</p>
        <p>Antes: ${oldDate} a las ${oldTime}<br>Ahora: <b>${newDate} a las ${newTime}</b></p>
        <p>Si no te viene bien, escríbenos por WhatsApp y buscamos otro hueco.</p>
        <p>¡Te esperamos!<br>Osana</p>
      </div>`;
}

// ── Marcar como no-show: perdona la 1ª vez (y restaura la sesión si había
// bono), descuenta a partir de la 2ª — y avisa siempre por email ──
router.post('/panel/no-show', async (req, res) => {
  const { bookingId } = req.body || {};
  if (!bookingId) return res.status(400).json({ error: 'Falta el identificador de la cita.' });
  try {
    // El aviso de "1ª falta" implica varias lecturas y escrituras seguidas
    // (bono, contador de faltas, estado de la cita) — sin bloqueo, un doble
    // clic o dos pestañas podrían leer status="confirmed" las dos antes de
    // que ninguna escriba, y contar la misma ausencia dos veces (doble
    // restauración de sesión de bono, o strikeCount subiendo de más).
    return await withLock(`booking:${bookingId}`, async () => {
    const booking = await findBookingById(bookingId);
    if (!booking) return res.status(404).json({ error: 'No se ha encontrado esa cita.' });
    // Evita que un doble clic o un reintento cuente la misma ausencia dos
    // veces (segundo strike / segunda restauración de sesión de bono).
    if (booking.status === 'no_show' || booking.status === 'no_show_forgiven') {
      return res.json({ ok: true, alreadyMarked: true });
    }
    if (booking.status !== 'confirmed') {
      return res.status(409).json({ error: 'Esta cita ya está cancelada — no tiene sentido marcarla como falta.' });
    }

    // Una "visita conjunta" (varios tratamientos en el mismo hueco) está
    // repartida en varias filas de reserva que comparten el mismo evento de
    // calendario — es UNA sola ausencia, no una por tratamiento. Se marcan
    // todas juntas, con un solo strike y una sola restauración por bono
    // (si no, marcar cada línea por separado sumaba una falta de más por
    // cada tratamiento de una misma cita, aunque la clienta solo faltó una
    // vez).
    const allBookings = await getAllBookings();
    const group = (booking.calendarId && booking.eventId)
      ? allBookings.filter((b) => b.calendarId === booking.calendarId && b.eventId === booking.eventId && b.status === 'confirmed')
      : [booking];

    const phoneN = normalizePhone(booking.phone);
    const emailN = normalizeEmail(booking.email);
    const allStrikes = await getAllStrikeRecords();
    const existing = allStrikes.find((s) => s.phoneNormalized === phoneN || (emailN && s.emailNormalized === emailN));
    const isFirstTime = effectiveStrikeCount(existing) === 0;

    const bonosRestored = [];
    for (const line of group) {
      if (isFirstTime) {
        // Se perdona: si esta línea tenía bono, se restaura la sesión para
        // que se pueda volver a agendar sin coste. Si NO tenía bono, no hay
        // ninguna sesión que restaurar — en su lugar queda "perdonada" y
        // reprogramable ella misma desde "Mis reservas" sin coste.
        if (line.bonoId) {
          const bono = await findSessionBonoById(line.bonoId);
          if (bono) {
            const sessionsUsed = Math.max(0, (Number(bono.sessionsUsed) || 0) - 1);
            const sessionsRemaining = (Number(bono.sessionsRemaining) || 0) + 1;
            await updateSessionBonoRow(bono._sheetRow, bono, { sessionsUsed, sessionsRemaining, status: 'active' });
            bonosRestored.push({ ...bono, sessionsUsed, sessionsRemaining });
          }
          await updateBookingRow(line._sheetRow, line, { status: 'no_show', noShowForgiven: '1' });
        } else {
          await updateBookingRow(line._sheetRow, line, { status: 'no_show_forgiven', noShowForgiven: '1' });
        }
      } else {
        // No se restaura nada — la sesión (si había) queda gastada
        await updateBookingRow(line._sheetRow, line, { status: 'no_show', noShowForgiven: '' });
      }
    }

    if (isFirstTime) {
      await upsertStrikeRecord({
        phoneNormalized: phoneN, emailNormalized: emailN, name: booking.name,
        strikeCount: 1, lastStrikeDate: new Date().toISOString().slice(0, 10),
      }, existing);
    } else {
      await upsertStrikeRecord({
        phoneNormalized: phoneN, emailNormalized: emailN, name: booking.name,
        strikeCount: effectiveStrikeCount(existing) + 1, lastStrikeDate: new Date().toISOString().slice(0, 10),
      }, existing);
    }

    if (booking.email) {
      try {
        await sendEmail({
          to: booking.email,
          subject: booking.lang === 'en' ? 'Update on your appointment — Osana' : 'Actualización de tu cita — Osana',
          html: noShowEmailHtml({ isFirstTime, booking, bono: bonosRestored[0] || null, lang: booking.lang }),
        });
      } catch (emailErr) {
        console.error('No se pudo enviar el email de no-show:', emailErr);
      }
    }

    res.json({ ok: true, isFirstTime, affectedBookingIds: group.map((b) => b.bookingId), sessionsRemaining: bonosRestored[0] ? bonosRestored[0].sessionsRemaining : null });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo marcar la ausencia.' });
  }
});

// ── Eliminar una cita por error (duplicada, mal introducida...): libera el
// hueco del calendario y la marca como anulada — no la borra físicamente de
// la Sheet (para conservar el rastro), pero deja de contar como facturación
// y desaparece de las acciones normales. OJO: esto NO tramita ningún
// reembolso en Stripe si la cita se había pagado de verdad online — eso
// sigue haciéndose a mano desde el Dashboard de Stripe si hace falta.
router.post('/panel/delete-booking', async (req, res) => {
  const { bookingId, asMistake } = req.body || {};
  if (!bookingId) return res.status(400).json({ error: 'Falta el identificador de la cita.' });
  try {
    const booking = await findBookingById(bookingId);
    if (!booking) return res.status(404).json({ error: 'No se ha encontrado esa cita.' });
    if (booking.status === 'cancelled_refunded') {
      return res.json({ ok: true, alreadyDeleted: true });
    }

    if (booking.calendarId && booking.eventId) {
      const allBookings = await getAllBookings();
      // Otros tratamientos de la misma cita comparten el mismo evento de
      // Calendar — si alguno sigue activo, no lo borramos, o desaparecería
      // también su cita aunque su fila siga diciendo "confirmed".
      if (!hasOtherActiveBookingsOnSameEvent(booking, allBookings)) {
        try {
          await deleteEvent(booking.calendarId, booking.eventId);
        } catch (calErr) {
          console.error('No se pudo borrar el evento del calendario al eliminar la cita:', calErr.message);
        }
      }
    }

    const deletedNote = asMistake
      ? `Eliminada del todo desde el panel el ${new Date().toISOString().slice(0, 10)} — se registró por error.`
      : `Eliminada manualmente desde el panel el ${new Date().toISOString().slice(0, 10)}.`;
    // Si ya estaba "cancelled_no_refund" (la clienta canceló tarde y se
    // quedó el importe), no lo reetiquetamos como "reembolsada" — eso
    // borraría ese ingreso real del informe trimestral, que solo excluye
    // las citas marcadas como reembolsadas de verdad.
    const newStatus = booking.status === 'cancelled_no_refund' ? booking.status : 'cancelled_refunded';
    await updateBookingRow(booking._sheetRow, booking, {
      status: newStatus,
      notes: booking.notes ? `${booking.notes}\n${deletedNote}` : deletedNote,
      // "Fue un error al registrarla" — se oculta por completo de la ficha
      // de la clienta en vez de quedarse ahí como "Cancelada" (ver
      // /panel/search, que filtra por esto).
      ...(asMistake ? { deletedAsMistake: '1' } : {}),
    });

    // Si era la sesión de un bono (p.ej. una de varias tratamientos de una
    // cita combinada donde ese día no dio tiempo a esta zona en concreto),
    // se le devuelve la sesión — no se ha llegado a hacer de verdad, así
    // que no debería contar como usada. Las demás citas de la misma visita
    // (si comparten el mismo hueco de calendario) no se tocan para nada.
    let restoredBono = null;
    if (booking.bonoId) {
      const bono = await findSessionBonoById(booking.bonoId);
      if (bono) {
        const sessionsUsed = Math.max(0, (Number(bono.sessionsUsed) || 0) - 1);
        const sessionsRemaining = (Number(bono.sessionsRemaining) || 0) + 1;
        await updateSessionBonoRow(bono._sheetRow, bono, { sessionsUsed, sessionsRemaining, status: 'active' });
        restoredBono = { bonoId: bono.bonoId, sessionsRemaining };
      }
    }

    res.json({ ok: true, restoredBono: restoredBono || undefined });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo eliminar la cita.' });
  }
});

// ── Informe trimestral en Excel, con la misma estructura que la plantilla
// de contabilidad real, listo para entregar al asesor cada 3 meses ──
router.get('/panel/report', async (req, res) => {
  const year = Number(req.query.year);
  const quarter = Number(req.query.quarter);
  if (!year || !quarter || quarter < 1 || quarter > 4) {
    return res.status(400).json({ error: 'Indica un año y un trimestre (1-4) válidos.' });
  }
  try {
    const [bookings, productSales, customQuotes] = await Promise.all([
      getAllBookings(), getAllProductSales(), getAllCustomQuotes(),
    ]);
    const workbook = await buildQuarterlyReportWorkbook({ year, quarter, bookings, productSales, customQuotes });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Osana_Informe_Q${quarter}_${year}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo generar el informe.' });
  }
});

// ── Presupuesto personalizado: genera un link de pago de Stripe para un
// importe fuera de catálogo (con Klarna, ya que siempre es pago 100% online) ──
router.post('/panel/custom-quote', async (req, res) => {
  const { clientName, clientPhone, clientEmail, description, amount, category, lang } = req.body || {};
  const amountNum = Number(amount);
  if (!clientName || !description || !amountNum || amountNum <= 0) {
    return res.status(400).json({ error: 'Indica al menos el nombre, la descripción y el importe.' });
  }
  if (!QUOTE_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'Elige una categoría contable válida.' });
  }
  try {
    const quoteId = crypto.randomUUID();
    const origin = resolveOrigin(req);
    const thanksPath = lang === 'en' ? '/en/reserva.html' : '/reserva.html';
    const session = await createCheckoutSession({
      amountEuros: amountNum,
      description: `${description} — Osana`,
      successUrl: `${origin}${thanksPath}?estado=ok`,
      cancelUrl: `${origin}${thanksPath}?estado=cancelado`,
      allowKlarna: true, // siempre pago 100% online, tiene sentido ofrecer financiación
      metadata: {
        type: 'custom_quote',
        quoteId,
        clientName,
        clientPhone: clientPhone || '',
        clientEmail: clientEmail || '',
        description,
        category,
        amount: String(amountNum),
        lang: lang === 'en' ? 'en' : 'es',
      },
    });

    await appendCustomQuote({
      quoteId,
      createdAt: new Date().toISOString(),
      clientName,
      clientPhone: clientPhone || '',
      clientEmail: clientEmail || '',
      description,
      category,
      amount: amountNum,
      status: 'pending',
      paidDate: '',
      paymentIntentId: '',
      lang: lang === 'en' ? 'en' : 'es',
    });

    res.json({ ok: true, url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo generar el link de pago.' });
  }
});

// ── Bonos regalo: búsqueda por código y canje ──
router.get('/panel/gift', async (req, res) => {
  const code = String(req.query.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Indica el código del bono regalo.' });
  try {
    const all = await getAllGifts();
    const gift = all.find((g) => String(g.code || '').trim().toUpperCase() === code);
    if (!gift) return res.status(404).json({ error: 'No se ha encontrado ningún bono regalo con ese código.' });
    res.json({ gift });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo buscar el bono regalo.' });
  }
});

router.post('/panel/gift-redeem', async (req, res) => {
  const code = String((req.body || {}).code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Indica el código del bono regalo.' });
  try {
    const all = await getAllGifts();
    const gift = all.find((g) => String(g.code || '').trim().toUpperCase() === code);
    if (!gift) return res.status(404).json({ error: 'No se ha encontrado ningún bono regalo con ese código.' });
    if (gift.status === 'redeemed') {
      return res.status(409).json({ error: 'Este bono regalo ya se marcó como canjeado.' });
    }
    await updateGiftRow(gift._sheetRow, { status: 'redeemed', redeemedAt: new Date().toISOString() });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo marcar el bono como canjeado.' });
  }
});

// ── Códigos de descuento: crear, listar, desactivar y avisar por email a
// las clientas ya registradas (p.ej. una promo de lanzamiento restringida
// a ciertos tratamientos y a un rango de fechas concreto). El código lo
// reparte el propio centro (Instagram, email...) — no aparece en la web.
router.post('/panel/discount', async (req, res) => {
  const { code, serviceIds, discountType, discountValue, validFrom, validUntil, note } = req.body || {};
  const ids = Array.isArray(serviceIds) ? serviceIds.filter(Boolean) : [];
  const value = Number(discountValue);
  if (!code || !code.trim()) return res.status(400).json({ error: 'Indica el código.' });
  if (!ids.length) return res.status(400).json({ error: 'Elige al menos un tratamiento al que aplique.' });
  if (!['percent', 'amount'].includes(discountType)) return res.status(400).json({ error: 'Indica si es % o € de descuento.' });
  if (!value || value <= 0) return res.status(400).json({ error: 'Indica el importe o porcentaje de descuento.' });
  if (!validFrom || !validUntil) return res.status(400).json({ error: 'Indica la fecha de inicio y de fin.' });
  if (validUntil < validFrom) return res.status(400).json({ error: 'La fecha de fin no puede ser anterior a la de inicio.' });

  try {
    const existing = await getAllDiscounts();
    if (existing.some((d) => String(d.code).trim().toUpperCase() === code.trim().toUpperCase())) {
      return res.status(409).json({ error: 'Ya existe un código de descuento con ese nombre.' });
    }
    const serviceNames = ids.map((id) => (services.find((s) => s.id === id) || {}).name || id).join(', ');
    await appendDiscount({
      discountId: crypto.randomUUID(),
      code: code.trim().toUpperCase(),
      serviceIds: ids.join(','),
      serviceNames,
      discountType,
      discountValue: value,
      validFrom,
      validUntil,
      active: 'true',
      createdAt: new Date().toISOString(),
      note: note || '',
      emailSentAt: '',
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo crear el descuento.' });
  }
});

router.get('/panel/discounts', async (req, res) => {
  try {
    const all = await getAllDiscounts();
    const list = all
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((d) => ({
        discountId: d.discountId, code: d.code, serviceNames: d.serviceNames,
        discountType: d.discountType, discountValue: d.discountValue,
        validFrom: d.validFrom, validUntil: d.validUntil, note: d.note,
        active: d.active !== 'false', live: isDiscountLive(d), emailSentAt: d.emailSentAt || '',
      }));
    res.json({ discounts: list });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron cargar los descuentos.' });
  }
});

router.post('/panel/discount-deactivate', async (req, res) => {
  const { discountId } = req.body || {};
  if (!discountId) return res.status(400).json({ error: 'Falta el identificador del descuento.' });
  try {
    const all = await getAllDiscounts();
    const discount = all.find((d) => d.discountId === discountId);
    if (!discount) return res.status(404).json({ error: 'No se ha encontrado ese descuento.' });
    await updateDiscountRow(discount._sheetRow, { active: 'false' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo desactivar el descuento.' });
  }
});

function discountEmailHtml(discount) {
  const valueLabel = discount.discountType === 'percent' ? `${discount.discountValue}%` : `${discount.discountValue} €`;
  const untilLabel = new Date(`${discount.validUntil}T12:00:00`).toLocaleDateString('es-ES', { day: '2-digit', month: 'long' });
  return `
    <p>Hola,</p>
    <p>Tenemos un descuento especial para ti: <strong>${valueLabel} de descuento</strong> en ${discount.serviceNames}.</p>
    <p>Solo tienes que introducir este código al reservar y pagar:</p>
    <p style="font-size:20px;font-weight:700;letter-spacing:2px;margin:16px 0;">${discount.code}</p>
    <p>Válido hasta el ${untilLabel}.</p>
    <p><a href="https://osana.es/reserva.html">Reserva tu cita aquí</a>.</p>
    <p>¡Te esperamos!<br>Osana</p>
  `;
}

// No se espera a que terminen todos los envíos antes de responder (podrían
// ser muchas clientas) — se lanza en segundo plano y el panel avisa de
// cuántas se van a avisar; los fallos puntuales quedan en el log del servidor.
router.post('/panel/discount-email-blast', async (req, res) => {
  const { discountId } = req.body || {};
  if (!discountId) return res.status(400).json({ error: 'Falta el identificador del descuento.' });
  try {
    const all = await getAllDiscounts();
    const discount = all.find((d) => d.discountId === discountId);
    if (!discount) return res.status(404).json({ error: 'No se ha encontrado ese descuento.' });

    const uniqueEmails = await getUniqueClientEmails();

    res.json({ ok: true, recipients: uniqueEmails.size });

    (async () => {
      const html = discountEmailHtml(discount);
      for (const { email } of uniqueEmails.values()) {
        try {
          await sendEmail({ to: email, subject: `Un descuento especial de Osana para ti`, html });
        } catch (err) {
          console.error(`Error enviando email de descuento a ${email}:`, err.message);
        }
      }
      await updateDiscountRow(discount._sheetRow, { emailSentAt: new Date().toISOString() }).catch(() => {});
    })();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo enviar la campaña.' });
  }
});

// ── Campaña de email libre: para fechas especiales, artículos, avisos de
// formaciones... cualquier comunicado que no sea un código de descuento
// (para eso está el blast de arriba). Se envía a las mismas destinatarias
// (todas las clientas con email registrado) con el asunto y texto que
// escriba el equipo en el momento — sin plantilla fija.
// El "{nombre}" en asunto/mensaje se sustituye por el nombre (de pila) de
// cada clienta antes de enviar, usando el nombre de su reserva más reciente.
const HEADER_IMAGE_RE = /^data:image\/(png|jpe?g|gif|webp);base64,/;

router.post('/panel/campaign-email', async (req, res) => {
  const { subject, body, headerImageDataUrl, ctaText, ctaUrl } = req.body || {};
  if (!subject || !subject.trim() || !body || !body.trim()) {
    return res.status(400).json({ error: 'Indica el asunto y el mensaje.' });
  }
  if (headerImageDataUrl && (!HEADER_IMAGE_RE.test(headerImageDataUrl) || headerImageDataUrl.length > 6_000_000)) {
    return res.status(400).json({ error: 'La imagen no es válida o pesa demasiado (máx. ~4 MB).' });
  }
  if ((ctaText && ctaText.trim() && !(ctaUrl && ctaUrl.trim())) || (ctaUrl && ctaUrl.trim() && !(ctaText && ctaText.trim()))) {
    return res.status(400).json({ error: 'Si añades un botón, indica el texto y el enlace.' });
  }
  try {
    const uniqueClients = await getUniqueClientEmails();

    res.json({ ok: true, recipients: uniqueClients.size });

    (async () => {
      // Mismo estilo de marca que el email de confirmación de reserva:
      // cabecera oscura (con el logo, o la imagen que suba el equipo),
      // cuerpo en crema, botón dorado, pie oscuro con enlaces de contacto.
      const headerHtml = headerImageDataUrl
        ? `<img src="${headerImageDataUrl}" alt="" style="width:100%;display:block;">`
        : `<div style="background:#1a1612;padding:26px 24px;text-align:center;"><img src="https://osana.es/images/logo-full-blanco.png" alt="Osana" style="height:32px;width:auto;"></div>`;
      const showCta = ctaText && ctaText.trim() && ctaUrl && ctaUrl.trim();
      const ctaHtml = showCta
        ? `<div style="text-align:center;margin:26px 0 4px;"><a href="${escapeHtml(ctaUrl.trim())}" style="display:inline-block;background:#ac977e;color:#1a1612;text-decoration:none;padding:13px 32px;font-size:12px;letter-spacing:1px;text-transform:uppercase;font-weight:600;">${escapeHtml(ctaText.trim())}</a></div>`
        : '';
      const footerHtml = `
        <div style="background:#1a1612;padding:22px 24px;text-align:center;">
          <p style="margin:0 0 6px;color:#ac977e;font-size:12px;letter-spacing:1px;text-transform:uppercase;">Osana Tenerife</p>
          <p style="margin:0;color:#cbbfae;font-size:11.5px;">
            <a href="https://osana.es" style="color:#cbbfae;text-decoration:underline;">osana.es</a>
            · <a href="https://instagram.com/osana_tenerife" style="color:#cbbfae;text-decoration:underline;">Instagram</a>
            · <a href="https://wa.me/34623725551" style="color:#cbbfae;text-decoration:underline;">WhatsApp</a>
          </p>
        </div>`;
      for (const { email, name } of uniqueClients.values()) {
        try {
          const firstName = (name || '').trim().split(' ')[0] || 'clienta';
          const subjectPersonal = subject.trim().replaceAll('{nombre}', firstName);
          const bodyPersonal = body.trim().replaceAll('{nombre}', firstName);
          const bodyHtml = bodyPersonal.split(/\n{2,}/)
            .map((para) => `<p style="margin:0 0 14px;color:#1a1612;font-size:14.5px;">${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
            .join('');
          const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;background:#f6eeda;">
            ${headerHtml}
            <div style="padding:28px 24px 8px;">${bodyHtml}${ctaHtml}</div>
            <div style="height:22px;"></div>
            ${footerHtml}
          </div>`;
          await sendEmail({ to: email, subject: subjectPersonal, html });
        } catch (err) {
          console.error(`Error enviando campaña de email a ${email}:`, err.message);
        }
      }
    })();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo enviar la campaña.' });
  }
});

// ── Seguimientos de clientas ──
const FOLLOWUP_DAYS_BY_TIMEFRAME = {
  '3dias': 3, '1semana': 7, '1mes': 30, '3meses': 90,
};

router.post('/panel/followup', async (req, res) => {
  const { clientName, clientPhone, clientEmail, note, timeframe } = req.body || {};
  const days = FOLLOWUP_DAYS_BY_TIMEFRAME[timeframe];
  if (!clientName || !days) {
    return res.status(400).json({ error: 'Indica al menos el nombre de la clienta y el plazo.' });
  }
  try {
    const due = new Date();
    due.setDate(due.getDate() + days);
    await appendFollowup({
      followupId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      clientName, clientPhone: clientPhone || '', clientEmail: clientEmail || '',
      note: note || '',
      dueDate: due.toISOString().slice(0, 10),
      status: 'pending',
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo guardar el seguimiento.' });
  }
});

router.post('/panel/followup-done', async (req, res) => {
  const { followupId } = req.body || {};
  if (!followupId) return res.status(400).json({ error: 'Falta el identificador del seguimiento.' });
  try {
    const all = await getAllFollowups();
    const followup = all.find((f) => f.followupId === followupId);
    if (!followup) return res.status(404).json({ error: 'No se ha encontrado ese seguimiento.' });
    await updateFollowupRow(followup._sheetRow, { status: 'done' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo marcar como hecho.' });
  }
});

// ── Agenda / panel de control: todo lo que necesita atención de un
// vistazo — citas sin cerrar, agenda de los próximos días, seguimientos
// pendientes, bonos con sesión por agendar, bonos cerca de caducar y
// presupuestos sin pagar.
router.get('/panel/agenda', async (req, res) => {
  const days = Math.max(1, Number(req.query.days) || 7);
  try {
    const [bookings, sessionBonos, customQuotes, followups, productSales] = await Promise.all([
      getAllBookings(), getAllSessionBonos(), getAllCustomQuotes(), getAllFollowups(), getAllProductSales(),
    ]);
    const now = Date.now();
    const rangeEndMs = now + days * 24 * 60 * 60 * 1000;
    const expiringWindowMs = now + 30 * 24 * 60 * 60 * 1000;

    const unclosedBookings = bookings
      .filter((b) => b.status === 'confirmed' && (b.finalAmount === undefined || b.finalAmount === '')
        && appointmentDateTime(b).getTime() < now)
      .sort((a, b) => appointmentDateTime(a) - appointmentDateTime(b));

    const upcomingBookings = bookings
      .filter((b) => b.status === 'confirmed' && appointmentDateTime(b).getTime() >= now
        && appointmentDateTime(b).getTime() <= rangeEndMs)
      .sort((a, b) => appointmentDateTime(a) - appointmentDateTime(b));

    const pendingBonoSessions = sessionBonos
      .filter((bono) => bono.status === 'active' && Number(bono.sessionsRemaining) > 0
        && !bookings.some((b) => b.bonoId === bono.bonoId && b.status === 'confirmed'
          && appointmentDateTime(b).getTime() >= now));

    const expiringBonos = sessionBonos
      .filter((bono) => bono.status === 'active' && bono.expiryDate
        && new Date(bono.expiryDate).getTime() >= now && new Date(bono.expiryDate).getTime() <= expiringWindowMs)
      .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));

    const unpaidQuotes = customQuotes
      .filter((q) => q.status === 'pending')
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    const dueFollowups = followups
      .filter((f) => f.status !== 'done' && new Date(`${f.dueDate}T12:00:00`).getTime() <= rangeEndMs)
      .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

    // Bonos con el tratamiento roto/desenlazado: mismo chequeo que ya usa
    // /panel/book-combined-sessions para no bloquear la reserva (nombre
    // como respaldo del id) — aquí se reutiliza como DETECTOR, no como
    // respaldo silencioso, para poder arreglarlo antes de que falle al
    // intentar agendar la siguiente sesión.
    const brokenServiceBonos = sessionBonos
      .filter((bono) => bono.status === 'active' && !services.find((s) => s.id === bono.serviceId));

    // Cobros de los últimos 14 días con la forma de pago sin asignar — el
    // mismo chequeo "⚠️ sin asignar" que ya usa el frontend en Comprobar
    // cobros (js/panel.js), pero calculado aquí para poder avisar antes
    // de que alguien tenga que ir a buscarlo a mano.
    const recentCutoffMs = now - 14 * 24 * 60 * 60 * 1000;
    const unassignedPayments = [];
    bookings.forEach((b) => {
      if (b.finalAmount === undefined || b.finalAmount === '') return;
      if (appointmentDateTime(b).getTime() < recentCutoffMs) return;
      const onlinePaid = Number(b.amountPaid) || 0;
      const finalAmount = Number(b.finalAmount) || 0;
      const redeemed = Number(b.redeemedAmount) || 0;
      const remainder = Math.max(0, round2(finalAmount - onlinePaid - redeemed));
      const part2 = Number(b.remainderAmount2) || 0;
      const part1 = round2(remainder - part2);
      if (part1 > 0 && !b.remainderPaidHow) {
        unassignedPayments.push({ bookingId: b.bookingId, name: b.name, phone: b.phone, serviceName: b.serviceName, date: b.date });
      } else if (part2 > 0 && !b.remainderPaidHow2) {
        unassignedPayments.push({ bookingId: b.bookingId, name: b.name, phone: b.phone, serviceName: b.serviceName, date: b.date });
      }
    });
    productSales.forEach((s) => {
      if (!s.bookingId || s.paidHow || s.status === 'deleted') return;
      if (new Date(s.createdAt || s.date).getTime() < recentCutoffMs) return;
      unassignedPayments.push({ bookingId: s.bookingId, name: '', phone: '', serviceName: s.product, date: s.date, isExtra: true });
    });

    res.json({
      unclosedBookings: unclosedBookings.map((b) => ({
        bookingId: b.bookingId, name: b.name, phone: b.phone, serviceName: b.serviceName,
        date: b.date, time: b.time, employeeName: b.employeeName,
      })),
      upcomingBookings: upcomingBookings.map((b) => ({
        bookingId: b.bookingId, name: b.name, phone: b.phone, serviceName: b.serviceName,
        date: b.date, time: b.time, employeeName: b.employeeName,
        finalAmount: b.finalAmount !== undefined && b.finalAmount !== '' ? Number(b.finalAmount) : null,
        amountPaid: Number(b.amountPaid) || 0,
      })),
      pendingBonoSessions: pendingBonoSessions.map((bono) => ({
        bonoId: bono.bonoId, clientName: bono.clientName, clientPhone: bono.clientPhone,
        serviceName: bono.serviceName, sessionsUsed: bono.sessionsUsed, totalSessions: bono.totalSessions,
      })),
      expiringBonos: expiringBonos.map((bono) => ({
        bonoId: bono.bonoId, clientName: bono.clientName, clientPhone: bono.clientPhone,
        serviceName: bono.serviceName, sessionsRemaining: bono.sessionsRemaining, expiryDate: bono.expiryDate,
      })),
      unpaidQuotes: unpaidQuotes.map((q) => ({
        quoteId: q.quoteId, clientName: q.clientName, clientPhone: q.clientPhone,
        description: q.description, amount: q.amount, createdAt: q.createdAt,
      })),
      dueFollowups: dueFollowups.map((f) => ({
        followupId: f.followupId, clientName: f.clientName, clientPhone: f.clientPhone,
        note: f.note, dueDate: f.dueDate,
      })),
      brokenServiceBonos: brokenServiceBonos.map((bono) => ({
        bonoId: bono.bonoId, clientName: bono.clientName, clientPhone: bono.clientPhone, serviceName: bono.serviceName,
      })),
      unassignedPayments,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar la agenda.' });
  }
});

// ── Igual que /panel/agenda pero solo cuenta lo urgente — para el número
// del botón de la barra de arriba, sin tener que traer/renderizar todo. ──
router.get('/panel/agenda-summary', async (req, res) => {
  try {
    const [bookings, sessionBonos, productSales] = await Promise.all([
      getAllBookings(), getAllSessionBonos(), getAllProductSales(),
    ]);
    const now = Date.now();
    const unclosedCount = bookings.filter((b) => b.status === 'confirmed'
      && (b.finalAmount === undefined || b.finalAmount === '') && appointmentDateTime(b).getTime() < now).length;
    const brokenCount = sessionBonos.filter((bono) => bono.status === 'active' && !services.find((s) => s.id === bono.serviceId)).length;
    const recentCutoffMs = now - 14 * 24 * 60 * 60 * 1000;
    let unassignedCount = 0;
    bookings.forEach((b) => {
      if (b.finalAmount === undefined || b.finalAmount === '') return;
      if (appointmentDateTime(b).getTime() < recentCutoffMs) return;
      const onlinePaid = Number(b.amountPaid) || 0;
      const finalAmount = Number(b.finalAmount) || 0;
      const redeemed = Number(b.redeemedAmount) || 0;
      const remainder = Math.max(0, round2(finalAmount - onlinePaid - redeemed));
      const part2 = Number(b.remainderAmount2) || 0;
      const part1 = round2(remainder - part2);
      if ((part1 > 0 && !b.remainderPaidHow) || (part2 > 0 && !b.remainderPaidHow2)) unassignedCount += 1;
    });
    productSales.forEach((s) => {
      if (!s.bookingId || s.paidHow || s.status === 'deleted') return;
      if (new Date(s.createdAt || s.date).getTime() < recentCutoffMs) return;
      unassignedCount += 1;
    });
    res.json({ attentionCount: unclosedCount + brokenCount + unassignedCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar el resumen de la agenda.' });
  }
});

// ── Registro de cobros: para un rango de fechas, todo lo cerrado (citas +
// extras) con su forma de pago, más un total por forma de pago — para poder
// cuadrar caja/Bizum/tarjeta a mano antes de la facturación, sin tener que
// abrir clienta por clienta. La seña pagada online (Stripe) SÍ se cuenta en
// los totales por forma de pago (siempre como tarjeta, en el día de la
// cita) aunque nunca haya pasado por caja física — así el total del día
// refleja el importe completo del tratamiento, no solo lo cobrado en persona.
router.get('/panel/payments-log', async (req, res) => {
  const from = req.query.from || new Date().toISOString().slice(0, 10);
  const to = req.query.to || from;
  try {
    const [bookings, sales] = await Promise.all([getAllBookings(), getAllProductSales()]);
    const inRange = (d) => d >= from && d <= to;

    const closedBookings = bookings
      .filter((b) => inRange(b.date) && b.finalAmount !== undefined && b.finalAmount !== '')
      .map((b) => {
        const onlinePaid = Number(b.amountPaid) || 0;
        const finalAmount = Number(b.finalAmount) || 0;
        const redeemed = Number(b.redeemedAmount) || 0;
        const remainder = Math.max(0, round2(finalAmount - onlinePaid - redeemed));
        return {
          bookingId: b.bookingId, date: b.date, time: b.time, name: b.name, phone: b.phone,
          serviceName: b.serviceName, finalAmount, onlinePaid, redeemed, remainder,
          // Si "onlinePaid" en realidad se cobró en persona (reserva manual
          // con pago por adelantado), depositPaidHow dice cómo — si viene
          // vacío es un pago online real por Stripe. Ese pago de verdad no
          // pasa nunca por la caja física (no hay que cuadrarlo con
          // efectivo/datáfono), pero SÍ forma parte del importe real del
          // tratamiento del día de la cita, así que se suma a los totales
          // como tarjeta (ver más abajo) para que el total del día cuadre
          // con lo que se le pasa al asesor.
          depositPaidHow: b.depositPaidHow || '',
          remainderPaidHow: b.remainderPaidHow || '',
          remainderAmount2: Number(b.remainderAmount2) || 0,
          remainderPaidHow2: b.remainderPaidHow2 || '',
        };
      })
      .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));

    // Señas/pagos por adelantado cobrados EN PERSONA (efectivo/tarjeta/bizum
    // al dar de alta la cita, no un pago online por Stripe): se cuentan por
    // el día en que se cobraron de verdad — normalmente el de creación de la
    // fila (createdAt), para que un pago de hoy de una cita dentro de tres
    // semanas no aparezca en caja hasta esa fecha futura.
    //
    // Pero si la cita ya era del pasado en el momento de darla de alta (se
    // está registrando a mano una visita antigua, con "Ya pasó — solo
    // registrar"), createdAt es solo el momento en que alguien se puso a
    // teclearla, no un cobro real de ese día — en ese caso se usa la fecha
    // de la propia cita, igual que el resto de su importe.
    const advanceDeposits = bookings
      .filter((b) => b.depositPaidHow && Number(b.amountPaid) > 0 && b.createdAt)
      .map((b) => {
        const createdDate = String(b.createdAt).slice(0, 10);
        const loggedAfterTheFact = b.date && b.date < createdDate;
        return {
          bookingId: b.bookingId, date: loggedAfterTheFact ? b.date : createdDate, name: b.name, phone: b.phone,
          serviceName: b.serviceName, amount: Number(b.amountPaid) || 0, paidHow: b.depositPaidHow,
          apptDate: b.date, apptTime: b.time,
        };
      })
      .filter((d) => inRange(d.date))
      .sort((a, b) => a.date.localeCompare(b.date));

    const extraLines = sales
      .filter((s) => inRange(s.date))
      .map((s) => ({
        saleId: s.saleId, date: s.date, product: s.product, amount: Number(s.amount) || 0,
        paidHow: s.paidHow || '', category: s.category || 'venta', bookingId: s.bookingId || '',
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const totals = {};
    const addTotal = (paidHow, amount) => {
      if (!(amount > 0)) return;
      const key = paidHow || 'sin asignar';
      totals[key] = round2((totals[key] || 0) + amount);
    };
    closedBookings.forEach((b) => {
      // El pago online (Stripe) es siempre tarjeta/Klarna — se suma aquí,
      // en el día de la cita, junto con el resto pagado en el centro, para
      // que el total del día refleje el importe completo del tratamiento
      // tal y como se pagó de verdad (y no solo la parte cobrada en persona).
      if (!b.depositPaidHow && b.onlinePaid > 0) addTotal('tarjeta', b.onlinePaid);
      const part1 = round2(b.remainder - b.remainderAmount2);
      addTotal(b.remainderPaidHow, part1);
      addTotal(b.remainderPaidHow2, b.remainderAmount2);
    });
    advanceDeposits.forEach((d) => addTotal(d.paidHow, d.amount));
    extraLines.forEach((e) => addTotal(e.paidHow, e.amount));

    res.json({ from, to, closedBookings, advanceDeposits, extraLines, totals });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar el registro de cobros.' });
  }
});

// ── Corregir a mano el nº de sesiones de un bono (p.ej. se dio de alta con
// un número equivocado, o se marcó una sesión de más por error) — sin tener
// que entrar a la Google Sheet. sessionsRemaining y status se recalculan
// solos a partir de total/usadas, igual que en el resto del código.
router.post('/panel/edit-bono', async (req, res) => {
  const { bonoId, totalSessions, sessionsUsed } = req.body || {};
  if (!bonoId) return res.status(400).json({ error: 'Falta el identificador del bono.' });
  try {
    const bono = await findSessionBonoById(bonoId);
    if (!bono) return res.status(404).json({ error: 'No se ha encontrado ese bono.' });

    const total = totalSessions !== undefined && totalSessions !== '' ? Number(totalSessions) : Number(bono.totalSessions);
    let used = sessionsUsed !== undefined && sessionsUsed !== '' ? Number(sessionsUsed) : Number(bono.sessionsUsed);
    if (!Number.isFinite(total) || total < 1) return res.status(400).json({ error: 'El total de sesiones no es válido.' });
    if (!Number.isFinite(used) || used < 0) return res.status(400).json({ error: 'Las sesiones usadas no son válidas.' });
    used = Math.min(used, total);
    const sessionsRemaining = Math.max(0, total - used);

    await updateSessionBonoRow(bono._sheetRow, bono, {
      totalSessions: total,
      sessionsUsed: used,
      sessionsRemaining,
      status: sessionsRemaining <= 0 ? 'completed' : 'active',
    });

    res.json({ ok: true, sessionsRemaining });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo corregir el bono.' });
  }
});

// ── Corregir a mano el nº de faltas registradas de una clienta (p.ej. una
// visita con varios tratamientos se marcó línea a línea por error y contó
// de más, o simplemente el equipo decide perdonar una falta ya puesta) ──
router.post('/panel/edit-strikes', async (req, res) => {
  const { phone, strikeCount } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'Falta el teléfono de la clienta.' });
  const count = Number(strikeCount);
  if (!Number.isFinite(count) || count < 0) return res.status(400).json({ error: 'El nº de faltas no es válido.' });
  try {
    const phoneN = normalizePhone(phone);
    const allStrikes = await getAllStrikeRecords();
    const existing = allStrikes.find((s) => s.phoneNormalized === phoneN);
    if (!existing && count === 0) return res.json({ ok: true, strikeCount: 0 }); // nada que corregir
    await upsertStrikeRecord({
      phoneNormalized: phoneN,
      emailNormalized: existing ? existing.emailNormalized : '',
      name: existing ? existing.name : '',
      strikeCount: count,
      lastStrikeDate: existing ? existing.lastStrikeDate : new Date().toISOString().slice(0, 10),
    }, existing);
    res.json({ ok: true, strikeCount: count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo corregir el nº de faltas.' });
  }
});

// ── Agendar de golpe la siguiente sesión de VARIOS bonos de la misma
// clienta en un único hueco de calendario (p.ej. pierna + axila + íntimo a
// la vez) — antes había que abrir cada bono por separado, agendar, guardar
// y cerrar, tres veces seguidas para la misma visita. Un único evento de
// Calendar, una fila de reserva por bono (cada uno descuenta su propia
// sesión), todas enganchadas al mismo evento — así luego se pueden marcar
// como "no hizo falta" una por una sin tocar las demás (ver /panel/no-show).
router.post('/panel/book-combined-sessions', async (req, res) => {
  const { bonoIds, employeeId, date, time, notes, extraMinutes, treatmentOverrides } = req.body || {};
  if (!Array.isArray(bonoIds) || bonoIds.length === 0 || !employeeId || !date || !time) {
    return res.status(400).json({ error: 'Elige al menos un bono, profesional, fecha y hora.' });
  }
  const uniqueBonoIds = [...new Set(bonoIds)];
  // Puede ser negativo — ver /panel/book-session para el mismo criterio.
  const extra = Math.round(Number(extraMinutes) || 0);
  const overrides = treatmentOverrides && typeof treatmentOverrides === 'object' ? treatmentOverrides : {};
  try {
    const employee = employees.find((e) => e.id === employeeId);
    if (!employee) return res.status(404).json({ error: 'Empleada no encontrada.' });

    return await withLock(`slot:${employeeId}:${date}`, async () => {
    // Bloqueados en orden fijo (alfabético) para que dos peticiones que
    // compartan solo ALGUNOS bonos no puedan interbloquearse entre sí.
    return await withLocks(uniqueBonoIds.slice().sort(), async () => {
      const bonos = [];
      for (const bonoId of uniqueBonoIds) {
        const bono = await findSessionBonoById(bonoId);
        if (!bono) return res.status(404).json({ error: 'Uno de los bonos elegidos ya no existe.' });
        if ((Number(bono.sessionsRemaining) || 0) <= 0) {
          return res.status(409).json({ error: `El bono de ${bono.serviceName} no tiene sesiones restantes.` });
        }
        bonos.push(bono);
      }
      const phoneN = normalizePhone(bonos[0].clientPhone);
      if (!bonos.every((b) => normalizePhone(b.clientPhone) === phoneN)) {
        return res.status(400).json({ error: 'Los bonos elegidos no son de la misma clienta.' });
      }
      // bono.serviceId puede estar vacío o ya no corresponder a ningún
      // tratamiento real en algún bono antiguo — si pasa, se localiza por
      // su nombre (bono.serviceName) en vez de bloquear la reserva por un
      // dato que la clienta no puede arreglar (mismo caso que en
      // /panel/book-session).
      const bonoServices = bonos.map((b) => services.find((s) => s.id === b.serviceId) || services.find((s) => s.name === b.serviceName));
      const missingIdx = bonoServices.findIndex((s) => !s);
      if (missingIdx !== -1) {
        return res.status(404).json({ error: `El tratamiento del bono de ${bonos[missingIdx].serviceName} ya no existe en el catálogo.` });
      }
      // Igual que en /panel/book-session: si esta visita en concreto usa
      // un bono para otra zona/tratamiento (mismo precio, distinto
      // nombre), la sesión se sigue descontando del MISMO bono — solo
      // cambia qué se muestra/registra para esa línea.
      const displayServices = bonos.map((b, i) => {
        const overrideId = overrides[b.bonoId];
        return overrideId ? (services.find((s) => s.id === overrideId) || bonoServices[i]) : bonoServices[i];
      });

      const durationMinutes = Math.max(5, displayServices.reduce((sum, s) => sum + s.durationMinutes, 0) + extra);
      const startISO = localToISO(date, time.length === 5 ? time : `${time}:00`, hours.timezone);
      const endISO = addMinutes(startISO, durationMinutes);

      // skipGapHeuristic: ver el mismo comentario en /panel/book-session.
      const freeSlots = await getAvailableSlots(date, employee.calendarId, durationMinutes, employee.weekly, { ignoreClosingTime: true, skipGapHeuristic: true });
      if (!freeSlots.includes(time)) {
        return res.status(409).json({ error: 'Ese hueco ya no está disponible. Elige otra hora.' });
      }

      const sessionLabels = bonos.map((b) => `${(Number(b.sessionsUsed) || 0) + 1}/${b.totalSessions}`);
      const combinedLabel = displayServices.map((s, i) => `${s.name} (${sessionLabels[i]})`).join(' + ');
      const description = [
        `Cliente: ${bonos[0].clientName}`,
        `Teléfono: ${bonos[0].clientPhone}`,
        ...bonos.map((b, i) => `Bono: ${b.serviceName} — sesión ${sessionLabels[i]}${displayServices[i] !== bonoServices[i] ? ` · Tratamiento de hoy: ${displayServices[i].name}` : ''}`),
        'Ya pagada como parte del bono.',
        notes ? `\n📝 Notas internas (solo equipo):\n${notes}` : '',
      ].filter(Boolean).join('\n');

      const event = await createBookingEvent(employee.calendarId, {
        summary: `✅ ${combinedLabel} — ${bonos[0].clientName}`,
        description,
        startISO, endISO,
        clientEmail: bonos[0].clientEmail,
        clientName: bonos[0].clientName,
      });

      const bookingIds = [];
      for (let i = 0; i < bonos.length; i++) {
        const bono = bonos[i];
        const service = displayServices[i];
        const fromSession = (Number(bono.sessionsUsed) || 0) + 1;
        const bookingId = crypto.randomUUID();
        await appendBooking({
          bookingId,
          createdAt: new Date().toISOString(),
          status: 'confirmed',
          name: bono.clientName,
          phone: bono.clientPhone,
          email: bono.clientEmail,
          serviceId: bono.serviceId || service.id,
          serviceName: `${service.name} (${sessionLabels[i]})`,
          employeeId,
          employeeName: employee.name,
          calendarId: employee.calendarId,
          eventId: event.id,
          date, time,
          durationMinutes: service.durationMinutes,
          price: '',
          amountPaid: 0,
          paymentType: 'bono',
          paymentIntentId: '',
          lang: bono.lang || 'es',
          reminderSent: '',
          birthdate: '',
          bonoId: bono.bonoId,
          sessionNumber: fromSession,
          notes: notes || '',
        });
        bookingIds.push(bookingId);

        const sessionsRemaining = Math.max(0, (Number(bono.sessionsRemaining) || 0) - 1);
        await updateSessionBonoRow(bono._sheetRow, bono, {
          sessionsUsed: fromSession,
          sessionsRemaining,
          status: sessionsRemaining <= 0 ? 'completed' : 'active',
        });
      }

      res.json({ ok: true, bookingIds });
    });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo agendar la cita combinada.' });
  }
});

module.exports = router;
