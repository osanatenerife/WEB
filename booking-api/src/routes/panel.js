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
const { withLock } = require('../lib/asyncLock');
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
      return {
        name: latest.name,
        phone: latest.phone,
        email: latest.email,
        strikeCount: strike ? Number(strike.strikeCount) || 0 : 0,
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
    bookingId, serviceId, removeServiceId, addServiceId, addWithoutTimeExtend, swapServiceId, employeeId, price, amountPaid, sessionNumber,
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
        if (booking.calendarId && booking.date && booking.time) {
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
      if (durationDelta > 0 && booking.calendarId && booking.date && booking.time) {
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

    // Si cambia la duración total (por cambiar el tratamiento, quitar uno de
    // varios combinados o añadir uno nuevo), ajustamos también el bloqueo
    // real en Google Calendar — SIEMPRE que sea posible, no solo "si es
    // fácil": antes, cuando el evento no era usable (p.ej. quedó cancelado
    // tras un borrado anterior), este bloque no hacía nada en absoluto,
    // dejando la Sheet con una duración mayor de la que el calendario
    // realmente bloqueaba — eso hacía que, al buscar hueco para otra cosa
    // más tarde, el sistema pensara que esta cita ocupaba más tiempo del
    // que de verdad bloqueaba en Google, y escondiera huecos libres de
    // verdad. Ahora, si no se puede parchear el evento, se crea uno nuevo
    // que cubra la duración correcta (igual que ya hace "Ampliar tiempo").
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
  const extra = Math.max(0, Math.round(Number(extraMinutes) || 0));
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

    const durationMinutes = (displayService || baseService).durationMinutes + extra;
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
        const freeSlots = await getAvailableSlots(date, employee.calendarId, durationMinutes, employee.weekly, { ignoreClosingTime: true });
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
    name, phone, email, birthdate, serviceId, employeeId, date, time,
    price, amountPaid, notes, extraServiceIds, paidHow,
    // Campos solo para sesiones de un bono ya vendido (isBono=true):
    isBono, totalSessions, sessionNumber, bonoTotalPrice, bonoAmountPaid, bonoPurchaseDate,
  } = req.body || {};
  if (!name || !phone || !email || !serviceId || !employeeId || !date || !time) {
    return res.status(400).json({ error: 'Faltan datos obligatorios (nombre, teléfono, email, tratamiento, profesional, fecha y hora).' });
  }
  if (isBono && (!totalSessions || !sessionNumber)) {
    return res.status(400).json({ error: 'Indica el número de sesión de esta cita y el total de sesiones del bono.' });
  }
  for (const [label, val] of [
    ['El precio', price], ['El importe pagado', amountPaid],
    ['El precio del bono', bonoTotalPrice], ['El importe pagado del bono', bonoAmountPaid],
  ]) {
    if (val !== undefined && val !== '' && (!Number.isFinite(Number(val)) || Number(val) < 0)) {
      return res.status(400).json({ error: `${label} no es un número válido.` });
    }
  }
  try {
    const service = services.find((s) => s.id === serviceId);
    const employee = employees.find((e) => e.id === employeeId);
    if (!service) return res.status(404).json({ error: 'Tratamiento no encontrado.' });
    if (!employee) return res.status(404).json({ error: 'Empleada no encontrada.' });

    // Otros tratamientos añadidos a la misma cita (p.ej. uno ya pagado y otro
    // pendiente) — también puede haberlos junto a una sesión de bono (el
    // bono en sí tiene su propio precio aparte, ver más abajo).
    const additionalServices = Array.isArray(extraServiceIds)
      ? extraServiceIds.map((id) => services.find((s) => s.id === id)).filter(Boolean)
      : [];
    const combinedServiceId = [serviceId, ...additionalServices.map((s) => s.id)].join(',');
    const combinedServiceName = [service.name, ...additionalServices.map((s) => s.name)].join(' + ');

    const timeNorm = time.length === 5 ? time : `${time}:00`;
    const startISO = localToISO(date, timeNorm, hours.timezone);
    const durationMinutes = service.durationMinutes + additionalServices.reduce((sum, s) => sum + s.durationMinutes, 0);

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
    let eventId;
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
    let bonoId = '';
    let sessionNumberOut = '';
    let serviceIdOut = combinedServiceId;
    let serviceName = combinedServiceName;
    let paidOnlineForLoyalty = 0; // el importe del bono en sí, si lo hay — ver más abajo
    const defaultPrice = service.price + additionalServices.reduce((sum, s) => sum + s.price, 0);
    let bookingPrice = price !== undefined && price !== '' ? Number(price) : defaultPrice;
    let bookingAmountPaid = amountPaid !== undefined && amountPaid !== '' ? Number(amountPaid) : 0;
    let paymentType = '';

    if (isBono) {
      const total = Number(totalSessions);
      const current = Number(sessionNumber);
      // Esta misma cita YA es la sesión "current" (se está dando de alta
      // confirmada, con su hora y calendario) — cuenta como usada desde ya,
      // así que sessionsUsed es "current", no "current - 1" (eso dejaba un
      // bono de 1 sesión ya hecha mostrando "0 de 1 usadas" en vez de
      // "completado", y ofreciendo agendar una sesión que ya no existe).
      const sessionsUsed = Math.min(total, current);
      const sessionsRemaining = Math.max(0, total - sessionsUsed);
      const bonoPrice = bonoTotalPrice !== undefined && bonoTotalPrice !== '' ? Number(bonoTotalPrice) : round2(service.price * total);
      const paidOnline = bonoAmountPaid !== undefined && bonoAmountPaid !== '' ? Number(bonoAmountPaid) : bonoPrice;
      const remainingAmount = Math.max(0, round2(bonoPrice - paidOnline));
      paidOnlineForLoyalty = paidOnline;

      bonoId = crypto.randomUUID();
      await appendSessionBono({
        bonoId,
        createdAt: new Date().toISOString(),
        clientName: name, clientPhone: phone, clientEmail: email,
        serviceId, serviceName: service.name,
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

      sessionNumberOut = current;
      // El precio del bono en sí ya queda registrado arriba (en su propia
      // fila de SessionBono) — lo que se guarda aquí, en la reserva, es
      // solo el precio de los tratamientos EXTRA añadidos a esta sesión
      // (si los hay), para no duplicar el importe del bono.
      const bonoLabel = `${service.name} (${current}/${total})`;
      serviceName = [bonoLabel, ...additionalServices.map((s) => s.name)].join(' + ');
      const extrasDefaultPrice = additionalServices.reduce((sum, s) => sum + s.price, 0);
      bookingPrice = price !== undefined && price !== '' ? Number(price) : (extrasDefaultPrice || '');
      bookingAmountPaid = amountPaid !== undefined && amountPaid !== '' ? Number(amountPaid) : 0;
      paymentType = 'bono';
    }

    const bookingId = crypto.randomUUID();
    await appendBooking({
      bookingId,
      createdAt: new Date().toISOString(),
      status: 'confirmed',
      name, phone, email,
      serviceId: serviceIdOut, serviceName,
      employeeId, employeeName: employee.name,
      calendarId: employee.calendarId,
      eventId,
      date, time: timeNorm,
      durationMinutes,
      price: bookingPrice,
      amountPaid: bookingAmountPaid,
      paymentType,
      paymentIntentId: '',
      lang: 'es',
      reminderSent: '',
      birthdate: birthdate || '',
      bonoId,
      sessionNumber: sessionNumberOut,
      notes: notes || 'Alta manual de cita ya existente.',
    });

    // Si se ha cobrado algo en el momento (tratamiento suelto, extras, o el
    // propio bono) y se ha dicho cómo — acumula saldo de fidelización igual
    // que un pago online, para que no se quede sin acumular solo por
    // haberse cobrado en persona en vez de por la web.
    const totalCollectedNow = round2((Number(bookingAmountPaid) || 0) + paidOnlineForLoyalty);
    if (paidHow && totalCollectedNow > 0) {
      await earnLoyalty({
        booking: { serviceId: serviceIdOut, phone, email, name, bookingId },
        portionAmount: totalCollectedNow,
        paidHow,
      });
    }

    res.json({ ok: true, bookingId, bonoId: bonoId || undefined });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo dar de alta la reserva.' });
  }
});

// ── Huecos libres para reprogramar una cita concreta ──
router.get('/panel/reschedule-slots', async (req, res) => {
  const { bookingId, date } = req.query;
  if (!bookingId || !date) return res.status(400).json({ error: 'Faltan datos para consultar huecos.' });
  try {
    const booking = await findBookingById(bookingId);
    if (!booking) return res.status(404).json({ error: 'No se ha encontrado esa cita.' });
    const duration = Number(booking.durationMinutes) || 60;
    const slots = await getAvailableSlots(date, booking.calendarId, duration, weeklyScheduleFor(booking.employeeId), { skipGapHeuristic: true, ignoreClosingTime: true });
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

// ── Cerrar cita: registrar importe total real y cómo se pagó el resto,
// sin tocar amountPaid (el pago online por Stripe queda como registro
// histórico intacto) — y acumular saldo de fidelización.
router.post('/panel/close', async (req, res) => {
  // remainderAmount2/paidHow2 son opcionales — para cuando el resto se paga
  // dividido entre dos formas de pago (p.ej. mitad tarjeta, mitad efectivo).
  // redeemAmount es opcional — saldo de fidelización que se aplica como
  // descuento directamente aquí, para no tener que restarlo a mano.
  const { bookingId, finalAmount, paidHow, remainderAmount2, paidHow2, redeemAmount } = req.body || {};
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
      // no piden forma de pago propia al crearlas — se resuelven aquí, con la
      // misma forma de pago que el resto de la visita, para no preguntarlo dos
      // veces. Así también se acumula su saldo de fidelización, que antes se
      // quedaba sin acumular hasta que esto se cerraba.
      const linkedExtras = (await getAllProductSales()).filter((s) => s.bookingId === booking.bookingId && !s.paidHow);
      for (const extra of linkedExtras) {
        await updateProductSaleRow(extra._sheetRow, extra, { paidHow: effectivePaidHow });
        await earnLoyalty({
          booking: { phone: booking.phone, email: booking.email, name: booking.name, bookingId: booking.bookingId, serviceName: extra.product },
          portionAmount: Number(extra.amount) || 0,
          paidHow: effectivePaidHow,
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
      if (paidHow !== undefined && paidHow !== '') updates.paidHow = paidHow;
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
  const { oldPhone, name, phone, email } = req.body || {};
  if (!oldPhone || !name || !name.trim() || !phone || !phone.trim()) {
    return res.status(400).json({ error: 'Indica el teléfono original y el nombre y teléfono corregidos.' });
  }
  try {
    const oldPhoneN = normalizePhone(oldPhone);
    if (!oldPhoneN) return res.status(400).json({ error: 'El teléfono original no es válido.' });
    const cleanName = name.trim();
    const cleanPhone = phone.trim();
    const cleanEmail = (email || '').trim();
    const newPhoneN = normalizePhone(cleanPhone);
    const newEmailN = normalizeEmail(cleanEmail);

    const [allBookings, allBonos, allStrikes, allLoyalty] = await Promise.all([
      getAllBookings(), getAllSessionBonos(), getAllStrikeRecords(), getAllLoyaltyMovements(),
    ]);

    let bookingsUpdated = 0;
    for (const b of allBookings) {
      if (normalizePhone(b.phone) === oldPhoneN) {
        await updateBookingRow(b._sheetRow, b, { name: cleanName, phone: cleanPhone, email: cleanEmail || b.email });
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

function noShowEmailHtml({ isFirstTime, booking, bono, lang }) {
  const isEn = lang === 'en';
  if (isFirstTime) {
    return isEn
      ? `<div style="font-family:Arial,sans-serif;color:#2a2520;max-width:480px;margin:0 auto;">
          <h2 style="font-size:18px;">Update on your appointment — Osana</h2>
          <p><b>Treatment:</b> ${booking.serviceName}<br><b>Date:</b> ${booking.date}<br><b>Status:</b> No-show (not deducted this time)</p>
          <p><b>Session deducted: No</b></p>
          <p>From now on, any no-show or cancellation with less than 48h notice will deduct a session from your package.</p>
          <p>Want to reschedule? Go to My Bookings or message us on WhatsApp.</p>
        </div>`
      : `<div style="font-family:Arial,sans-serif;color:#2a2520;max-width:480px;margin:0 auto;">
          <h2 style="font-size:18px;">Actualización de tu cita — Osana</h2>
          <p><b>Cita:</b> ${booking.serviceName}<br><b>Fecha:</b> ${booking.date}<br><b>Estado:</b> Ausencia sin preaviso (no descontable esta vez)</p>
          <p><b>Sesión descontada: No</b></p>
          <p>A partir de ahora, cualquier ausencia sin preaviso o cancelación con menos de 48h descontará una sesión de tu bono.</p>
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
        <p>Your no-show allowance was already used previously.</p>
        <p>Want to reschedule? Go to My Bookings or message us on WhatsApp.</p>
      </div>`
    : `<div style="font-family:Arial,sans-serif;color:#2a2520;max-width:480px;margin:0 auto;">
        <h2 style="font-size:18px;">Actualización de tu cita — Osana</h2>
        <p><b>Cita:</b> ${booking.serviceName}<br><b>Fecha:</b> ${booking.date}<br><b>Estado:</b> Ausencia sin preaviso</p>
        <p><b>Sesión descontada: Sí (1 sesión)</b></p>
        ${remainingLine}
        <p>Tu comodín de falta ya fue utilizado anteriormente.</p>
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
    const booking = await findBookingById(bookingId);
    if (!booking) return res.status(404).json({ error: 'No se ha encontrado esa cita.' });
    // Evita que un doble clic o un reintento cuente la misma ausencia dos
    // veces (segundo strike / segunda restauración de sesión de bono).
    if (booking.status === 'no_show') {
      return res.json({ ok: true, alreadyMarked: true });
    }
    if (booking.status !== 'confirmed') {
      return res.status(409).json({ error: 'Esta cita ya está cancelada — no tiene sentido marcarla como falta.' });
    }

    await updateBookingRow(booking._sheetRow, booking, { status: 'no_show' });

    const phoneN = normalizePhone(booking.phone);
    const emailN = normalizeEmail(booking.email);
    const allStrikes = await getAllStrikeRecords();
    const existing = allStrikes.find((s) => s.phoneNormalized === phoneN || (emailN && s.emailNormalized === emailN));
    const isFirstTime = !existing || Number(existing.strikeCount) === 0;

    let bono = null;
    if (booking.bonoId) {
      bono = await findSessionBonoById(booking.bonoId);
    }

    if (isFirstTime) {
      // Se perdona: si había bono, se restaura la sesión para que se pueda volver a agendar sin coste
      if (bono) {
        const sessionsUsed = Math.max(0, (Number(bono.sessionsUsed) || 0) - 1);
        const sessionsRemaining = (Number(bono.sessionsRemaining) || 0) + 1;
        await updateSessionBonoRow(bono._sheetRow, bono, { sessionsUsed, sessionsRemaining, status: 'active' });
        bono = { ...bono, sessionsUsed, sessionsRemaining };
      }
      await upsertStrikeRecord({
        phoneNormalized: phoneN, emailNormalized: emailN, name: booking.name,
        strikeCount: 1, lastStrikeDate: new Date().toISOString().slice(0, 10),
      }, existing);
    } else {
      // No se restaura nada — la sesión queda gastada
      await upsertStrikeRecord({
        phoneNormalized: phoneN, emailNormalized: emailN, name: booking.name,
        strikeCount: (Number(existing.strikeCount) || 0) + 1, lastStrikeDate: new Date().toISOString().slice(0, 10),
      }, existing);
    }

    if (booking.email) {
      try {
        await sendEmail({
          to: booking.email,
          subject: booking.lang === 'en' ? 'Update on your appointment — Osana' : 'Actualización de tu cita — Osana',
          html: noShowEmailHtml({ isFirstTime, booking, bono, lang: booking.lang }),
        });
      } catch (emailErr) {
        console.error('No se pudo enviar el email de no-show:', emailErr);
      }
    }

    res.json({ ok: true, isFirstTime, sessionsRemaining: bono ? bono.sessionsRemaining : null });
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
  const { bookingId } = req.body || {};
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

    const deletedNote = `Eliminada manualmente desde el panel el ${new Date().toISOString().slice(0, 10)}.`;
    // Si ya estaba "cancelled_no_refund" (la clienta canceló tarde y se
    // quedó el importe), no lo reetiquetamos como "reembolsada" — eso
    // borraría ese ingreso real del informe trimestral, que solo excluye
    // las citas marcadas como reembolsadas de verdad.
    const newStatus = booking.status === 'cancelled_no_refund' ? booking.status : 'cancelled_refunded';
    await updateBookingRow(booking._sheetRow, booking, {
      status: newStatus,
      notes: booking.notes ? `${booking.notes}\n${deletedNote}` : deletedNote,
    });

    res.json({ ok: true });
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
    const [bookings, sessionBonos, customQuotes, followups] = await Promise.all([
      getAllBookings(), getAllSessionBonos(), getAllCustomQuotes(), getAllFollowups(),
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

    res.json({
      unclosedBookings: unclosedBookings.map((b) => ({
        bookingId: b.bookingId, name: b.name, phone: b.phone, serviceName: b.serviceName,
        date: b.date, time: b.time, employeeName: b.employeeName,
      })),
      upcomingBookings: upcomingBookings.map((b) => ({
        bookingId: b.bookingId, name: b.name, phone: b.phone, serviceName: b.serviceName,
        date: b.date, time: b.time, employeeName: b.employeeName,
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
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar la agenda.' });
  }
});

module.exports = router;
