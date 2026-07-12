const express = require('express');
const crypto = require('crypto');
const { constructWebhookEvent } = require('../lib/stripeClient');
const { getEvent, updateEvent, deleteEvent } = require('../lib/googleCalendar');
const { appendBooking, appendGift, appendSessionBono, getAllCustomQuotes, updateQuoteRow, appendLoyaltyMovement, getLoyaltyMovementsForPhone } = require('../lib/sheets');
const { earnRateFor, computeLoyaltyBalance } = require('../config/loyalty');
const { normalizePhone, normalizeEmail } = require('../lib/clientId');
const { sendEmail } = require('../lib/email');
const { generateGiftCardBuffer } = require('../lib/giftCard');
const services = require('../config/services');
const employees = require('../config/employees');
const bonos = require('../config/bonos');

const router = express.Router();

const GIFT_VALIDITY_MONTHS = 6;
const BONO_VALIDITY_MONTHS = 12;
const SALON_EMAIL = process.env.GIFT_NOTIFY_EMAIL || 'osanatenerife@gmail.com';

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function randomVoucherCode() {
  return 'OSANA-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

// Línea con el saldo de fidelización, para incluir en la confirmación de
// reserva (así la clienta se entera de cuánto tiene sin tener que entrar
// a "Mis reservas").
async function loyaltyBalanceLine(clientPhone, lang) {
  if (!clientPhone) return '';
  try {
    const movements = await getLoyaltyMovementsForPhone(normalizePhone(clientPhone));
    const balance = computeLoyaltyBalance(movements);
    if (balance <= 0) return '';
    return lang === 'en'
      ? `<p>💶 <strong>Your loyalty balance: ${balance.toFixed(2)} €</strong> — usable as a discount on your next single treatment paid at the centre (min. €10 per redemption).</p>`
      : `<p>💶 <strong>Tu saldo acumulado: ${balance.toFixed(2)} €</strong> — puedes usarlo como descuento en tu próximo tratamiento suelto pagado en el centro (canje mínimo de 10 €).</p>`;
  } catch (e) {
    console.error('No se pudo calcular el saldo para el email de confirmación:', e);
    return '';
  }
}

async function sendBookingConfirmationEmail({ clientEmail, clientName, clientPhone, serviceName, date, time, employeeName, amountPaid, price, lang }) {
  if (!clientEmail) return;
  const isEn = lang === 'en';
  const total = Number(price) || 0;
  const paid = Number(amountPaid) || 0;
  const pending = Math.max(0, round2(total - paid));
  const pendingLine = pending > 0
    ? (isEn ? `<p>Remaining to pay at the centre: <strong>${pending.toFixed(2)} €</strong></p>` : `<p>Resto a pagar en el centro: <strong>${pending.toFixed(2)} €</strong></p>`)
    : '';
  const loyaltyLine = await loyaltyBalanceLine(clientPhone, lang);
  const html = isEn
    ? `<div style="font-family:Arial,sans-serif;color:#2a2520;max-width:480px;margin:0 auto;">
        <h2 style="font-size:18px;">Booking confirmed ✓</h2>
        <p>Hi ${escapeHtml(clientName || '')},</p>
        <p><b>${escapeHtml(serviceName)}</b><br>${date} at ${time}<br>With ${escapeHtml(employeeName || '')}</p>
        <p>Paid online: <strong>${paid.toFixed(2)} €</strong></p>
        ${pendingLine}
        ${loyaltyLine}
        <p>Need to cancel or reschedule? Go to <a href="https://osana.es/en/mis-reservas.html">osana.es/en/mis-reservas.html</a>.</p>
        <p>See you soon!<br>Osana</p>
      </div>`
    : `<div style="font-family:Arial,sans-serif;color:#2a2520;max-width:480px;margin:0 auto;">
        <h2 style="font-size:18px;">Reserva confirmada ✓</h2>
        <p>Hola ${escapeHtml(clientName || '')},</p>
        <p><b>${escapeHtml(serviceName)}</b><br>${date} a las ${time}<br>Con ${escapeHtml(employeeName || '')}</p>
        <p>Pagado online: <strong>${paid.toFixed(2)} €</strong></p>
        ${pendingLine}
        ${loyaltyLine}
        <p>¿Necesitas cancelar o reprogramar? Entra en <a href="https://osana.es/mis-reservas.html">osana.es/mis-reservas.html</a>.</p>
        <p>¡Te esperamos!<br>Osana</p>
      </div>`;
  try {
    await sendEmail({ to: clientEmail, subject: isEn ? 'Booking confirmed — Osana' : 'Reserva confirmada — Osana', html });
  } catch (emailErr) {
    console.error('No se pudo enviar el email de confirmación de reserva:', emailErr);
  }
}

async function handleBookingPayment(session) {
  const {
    bookingId, calendarId, eventId, serviceId, employeeId, date, time,
    durationMinutes, clientName, clientPhone, clientEmail, clientBirthdate, price, amount, paymentType, lang,
    extraServiceIds,
  } = session.metadata || {};

  // Si el cliente aplicó un cupón en Stripe, lo realmente cobrado
  // (session.amount_total) puede ser menor que el "amount" que calculamos
  // antes de pagar — usamos el importe real para no descuadrar las cuentas.
  const discountCents = (session.total_details && session.total_details.amount_discount) || 0;
  const realAmountPaid = typeof session.amount_total === 'number'
    ? Math.round(session.amount_total) / 100
    : Number(amount) || 0;
  const couponNote = discountCents > 0 ? ` (cupón aplicado: -${(discountCents / 100).toFixed(2)} €)` : '';

  if (calendarId && eventId) {
    const current = await getEvent(calendarId, eventId).catch(() => null);
    const newDescription = current
      ? (current.description || '').replace(
          '⏳ PENDIENTE DE PAGO — se confirma automáticamente al completar el pago.',
          `✅ PAGADO — ${realAmountPaid.toFixed(2)} € (${paymentType}) recibido correctamente por Stripe.${couponNote}`
        )
      : undefined;

    await updateEvent(calendarId, eventId, {
      summary: `✅ Confirmada — ${clientName || ''}`.trim(),
      colorId: '10', // verde en Google Calendar
      ...(newDescription ? { description: newDescription } : {}),
    });
  }

  // Guardamos la reserva confirmada en la Sheet para que "Mis reservas" pueda encontrarla
  const service = services.find((s) => s.id === serviceId);
  const employee = employees.find((e) => e.id === employeeId);
  const additionalServiceIds = (extraServiceIds || '').split(',').filter(Boolean);
  const additionalServices = additionalServiceIds.map((id) => services.find((s) => s.id === id)).filter(Boolean);
  const combinedServiceId = [serviceId, ...additionalServiceIds].filter(Boolean).join(',');
  const combinedServiceName = [service ? service.name : null, ...additionalServices.map((s) => s.name)].filter(Boolean).join(' + ');

  if (bookingId) {
    try {
      await appendBooking({
        bookingId,
        createdAt: new Date().toISOString(),
        status: 'confirmed',
        name: clientName || '',
        phone: clientPhone || '',
        email: clientEmail || '',
        serviceId: combinedServiceId,
        serviceName: combinedServiceName,
        employeeId: employeeId || '',
        employeeName: employee ? employee.name : '',
        calendarId: calendarId || '',
        eventId: eventId || '',
        date: date || '',
        time: time || '',
        durationMinutes: durationMinutes || '',
        price: price || '',
        amountPaid: realAmountPaid,
        paymentType: paymentType || '',
        paymentIntentId: session.payment_intent || '',
        lang: lang === 'en' ? 'en' : 'es',
        reminderSent: '',
        birthdate: clientBirthdate || '',
      });
    } catch (sheetErr) {
      // No bloqueamos la confirmación de la cita si falla el registro en la Sheet
      console.error('No se pudo guardar la reserva en la Sheet:', sheetErr);
    }
  }

  await sendBookingConfirmationEmail({
    clientEmail, clientName, clientPhone,
    serviceName: combinedServiceName, date, time,
    employeeName: employee ? employee.name : '',
    amountPaid: realAmountPaid, price, lang,
  });
}

function addMonthsISO(months) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

async function handleBonoSessionPayment(session) {
  const {
    bonoId, calendarId, eventId, serviceId, employeeId, date, time,
    durationMinutes, clientName, clientPhone, clientEmail, clientBirthdate,
    sessions, totalPrice, amount, paymentType, lang,
  } = session.metadata || {};

  const discountCents = (session.total_details && session.total_details.amount_discount) || 0;
  const realAmountPaid = typeof session.amount_total === 'number'
    ? Math.round(session.amount_total) / 100
    : Number(amount) || 0;
  const couponNote = discountCents > 0 ? ` (cupón aplicado: -${(discountCents / 100).toFixed(2)} €)` : '';

  const totalSessions = Number(sessions) || 1;
  const bonoPrice = Number(totalPrice) || 0;
  const remainingAmount = Math.max(0, round2(bonoPrice - realAmountPaid));

  if (calendarId && eventId) {
    const current = await getEvent(calendarId, eventId).catch(() => null);
    const newDescription = current
      ? (current.description || '').replace(
          '⏳ PENDIENTE DE PAGO — se confirma automáticamente al completar el pago.',
          `✅ PAGADO — ${realAmountPaid.toFixed(2)} € (${paymentType}) recibido correctamente por Stripe.${couponNote}`
        )
      : undefined;
    await updateEvent(calendarId, eventId, {
      summary: `✅ Confirmada — Bono (1/${totalSessions}) — ${clientName || ''}`.trim(),
      colorId: '10',
      ...(newDescription ? { description: newDescription } : {}),
    });
  }

  const service = services.find((s) => s.id === serviceId);
  const employee = employees.find((e) => e.id === employeeId);

  // 1) Registramos el bono en su propia pestaña, con la 1ª sesión ya usada
  try {
    await appendSessionBono({
      bonoId,
      createdAt: new Date().toISOString(),
      clientName: clientName || '',
      clientPhone: clientPhone || '',
      clientEmail: clientEmail || '',
      serviceId: serviceId || '',
      serviceName: service ? service.name : '',
      employeeId: employeeId || '',
      totalSessions,
      sessionsUsed: 1,
      sessionsRemaining: totalSessions - 1,
      totalPrice: bonoPrice,
      amountPaidOnline: realAmountPaid,
      paymentType: paymentType || '',
      remainingAmount,
      remainingPaidHow: '', // se rellena desde el panel interno al cobrar el resto en el centro
      status: 'active',
      expiryDate: addMonthsISO(BONO_VALIDITY_MONTHS),
      paymentIntentId: session.payment_intent || '',
      lang: lang === 'en' ? 'en' : 'es',
    });
  } catch (sheetErr) {
    console.error('No se pudo guardar el bono en la Sheet:', sheetErr);
  }

  // 2) Registramos la 1ª sesión como una reserva normal, enlazada al bono
  try {
    await appendBooking({
      bookingId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      status: 'confirmed',
      name: clientName || '',
      phone: clientPhone || '',
      email: clientEmail || '',
      serviceId: serviceId || '',
      serviceName: service ? `${service.name} (1/${totalSessions})` : '',
      employeeId: employeeId || '',
      employeeName: employee ? employee.name : '',
      calendarId: calendarId || '',
      eventId: eventId || '',
      date: date || '',
      time: time || '',
      durationMinutes: durationMinutes || '',
      price: totalPrice || '',
      amountPaid: realAmountPaid,
      paymentType: paymentType || '',
      paymentIntentId: session.payment_intent || '',
      lang: lang === 'en' ? 'en' : 'es',
      reminderSent: '',
      birthdate: clientBirthdate || '',
      bonoId: bonoId || '',
      sessionNumber: 1,
    });
  } catch (sheetErr) {
    console.error('No se pudo guardar la sesión del bono en la Sheet:', sheetErr);
  }

  await sendBookingConfirmationEmail({
    clientEmail, clientName, clientPhone,
    serviceName: service ? `${service.name} — bono de ${totalSessions} sesiones (1/${totalSessions})` : `Bono de ${totalSessions} sesiones`,
    date, time,
    employeeName: employee ? employee.name : '',
    amountPaid: realAmountPaid, price: bonoPrice, lang,
  });
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

async function handleCustomQuotePayment(session) {
  const { quoteId, clientName, clientPhone, clientEmail, description, category, amount, lang } = session.metadata || {};
  const realAmountPaid = typeof session.amount_total === 'number'
    ? Math.round(session.amount_total) / 100
    : Number(amount) || 0;

  try {
    const quotes = await getAllCustomQuotes();
    const quote = quotes.find((q) => q.quoteId === quoteId);
    if (quote) {
      await updateQuoteRow(quote._sheetRow, {
        status: 'paid',
        paidDate: new Date().toISOString().slice(0, 10),
        paymentIntentId: session.payment_intent || '',
      });
    }
  } catch (sheetErr) {
    console.error('No se pudo marcar el presupuesto como pagado:', sheetErr);
  }

  // Siempre se considera pagado online (tarjeta o Klarna, ambos liquidan igual)
  try {
    const rate = earnRateFor(category, 'tarjeta');
    const earned = round2(realAmountPaid * rate);
    if (earned > 0) {
      await appendLoyaltyMovement({
        date: new Date().toISOString().slice(0, 10),
        phoneNormalized: normalizePhone(clientPhone),
        emailNormalized: normalizeEmail(clientEmail),
        name: clientName || '',
        type: 'earn',
        bookingId: quoteId || '',
        serviceName: description || '',
        category,
        baseAmount: realAmountPaid,
        paidHow: 'tarjeta',
        rateApplied: rate,
        amount: earned,
      });
    }
  } catch (loyaltyErr) {
    console.error('No se pudo acumular saldo del presupuesto:', loyaltyErr);
  }

  if (clientEmail) {
    try {
      const isEn = lang === 'en';
      await sendEmail({
        to: clientEmail,
        subject: isEn ? 'Payment confirmation — Osana' : 'Confirmación de pago — Osana',
        html: isEn
          ? `<div style="font-family:Arial,sans-serif;color:#2a2520;max-width:480px;margin:0 auto;"><h2 style="font-size:18px;">Payment received</h2><p><b>${escapeHtml(description)}</b></p><p>Amount paid: ${realAmountPaid.toFixed(2)} €</p><p>Thank you!<br>Osana</p></div>`
          : `<div style="font-family:Arial,sans-serif;color:#2a2520;max-width:480px;margin:0 auto;"><h2 style="font-size:18px;">Pago recibido</h2><p><b>${escapeHtml(description)}</b></p><p>Importe pagado: ${realAmountPaid.toFixed(2)} €</p><p>¡Gracias!<br>Osana</p></div>`,
      });
    } catch (emailErr) {
      console.error('No se pudo enviar la confirmación del presupuesto:', emailErr);
    }
  }
}

function buildGiftEmailHtml({ lang }) {
  const strings = lang === 'en'
    ? {
        title: 'Your gift voucher is ready 🎁',
        body: "Thank you for your purchase! Your Osana gift voucher is attached to this email as an image, ready to print or forward to whoever you're gifting it to.",
        sign: 'See you soon,<br>Osana',
      }
    : {
        title: 'Tu bono regalo ya está listo 🎁',
        body: '¡Gracias por tu compra! Tu bono regalo de Osana va adjunto a este email en forma de imagen, lista para imprimir o reenviar a quien se lo regales.',
        sign: 'Te esperamos,<br>Osana',
      };
  return `
  <div style="max-width:480px;margin:0 auto;font-family:Arial,sans-serif;color:#2a2520;">
    <h2 style="font-size:20px;">${strings.title}</h2>
    <p style="font-size:14px;line-height:1.7;">${strings.body}</p>
    <p style="font-size:14px;line-height:1.7;">${strings.sign}</p>
  </div>`;
}

async function handleGiftPayment(session) {
  const { giftId, giftType, serviceId, amount, fromName, toName, message, buyerEmail, buyerPhone, lang } = session.metadata || {};
  const isEn = lang === 'en';
  const service = giftType === 'service' ? services.find((s) => s.id === serviceId) : null;
  const itemLabel = giftType === 'service'
    ? ((isEn ? (service && service.nameEn) : service && service.name) || (service && service.name) || '')
    : (isEn ? `€${amount} to spend on any treatment` : `${amount} € para gastar en cualquier tratamiento`);

  const code = randomVoucherCode();
  const purchaseDate = new Date();
  const expiryDate = new Date(purchaseDate);
  expiryDate.setMonth(expiryDate.getMonth() + GIFT_VALIDITY_MONTHS);
  const expiryLabel = expiryDate.toLocaleDateString(isEn ? 'en-GB' : 'es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });

  try {
    await appendGift({
      bonoId: giftId || '',
      code,
      createdAt: purchaseDate.toISOString(),
      status: 'purchased',
      buyerName: fromName || '',
      buyerEmail: buyerEmail || '',
      buyerPhone: buyerPhone || '',
      recipientName: toName || '',
      giftType: giftType || '',
      serviceId: serviceId || '',
      serviceName: service ? service.name : '',
      amount: amount || '',
      message: message || '',
      expiryDate: expiryDate.toISOString().slice(0, 10),
      paymentIntentId: session.payment_intent || '',
      lang: isEn ? 'en' : 'es',
    });
  } catch (sheetErr) {
    console.error('No se pudo guardar el bono regalo en la Sheet:', sheetErr);
  }

  if (buyerEmail) {
    try {
      const cardBuffer = await generateGiftCardBuffer({ fromName, toName, itemLabel, message, expiryLabel, code, lang });
      const html = buildGiftEmailHtml({ lang });
      await sendEmail({
        to: buyerEmail,
        subject: isEn ? 'Your Osana gift voucher' : 'Tu bono regalo de Osana',
        html,
        attachments: [{ filename: 'bono-regalo-osana.png', content: cardBuffer.toString('base64') }],
      });
    } catch (emailErr) {
      console.error('No se pudo enviar el email del bono regalo:', emailErr);
    }
  }

  // Aviso interno para que el centro sepa que se ha vendido un bono y pueda controlarlo
  try {
    await sendEmail({
      to: SALON_EMAIL,
      subject: `Nuevo bono regalo vendido — ${code}`,
      html: `<p>Se ha comprado un bono regalo.</p><p>De: ${escapeHtml(fromName)}<br>Para: ${escapeHtml(toName)}<br>Regalo: ${escapeHtml(itemLabel)}<br>Código: <strong>${code}</strong><br>Válido hasta: ${expiryLabel}<br>Comprador: ${escapeHtml(buyerEmail)}${buyerPhone ? ' · ' + escapeHtml(buyerPhone) : ''}</p>`,
    });
  } catch (notifyErr) {
    console.error('No se pudo enviar el aviso interno del bono:', notifyErr);
  }
}

// OJO: esta ruta necesita el body en crudo (raw), no en JSON.
// Se monta con express.raw() en server.js antes del parser JSON global.
router.post('/webhook/stripe', async (req, res) => {
  let event;
  try {
    event = constructWebhookEvent(req.body, req.headers['stripe-signature']);
  } catch (err) {
    console.error('Firma de webhook inválida:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const sessionType = (session.metadata || {}).type;
      if (sessionType === 'gift') {
        await handleGiftPayment(session);
      } else if (sessionType === 'bono_session') {
        await handleBonoSessionPayment(session);
      } else if (sessionType === 'custom_quote') {
        await handleCustomQuotePayment(session);
      } else {
        await handleBookingPayment(session);
      }
    }

    if (event.type === 'checkout.session.expired') {
      const session = event.data.object;
      const { calendarId, eventId } = session.metadata || {};
      if (calendarId && eventId) {
        // No se pagó a tiempo: liberamos el hueco bloqueado
        await deleteEvent(calendarId, eventId);
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Error procesando webhook:', err);
    // Devolvemos 200 igualmente para que Stripe no reintente indefinidamente
    // errores que no se van a resolver solos; queda registrado en los logs.
    res.status(200).json({ received: true, warning: err.message });
  }
});

module.exports = router;
