const express = require('express');
const crypto = require('crypto');
const { constructWebhookEvent } = require('../lib/stripeClient');
const { getEvent, updateEvent, deleteEvent } = require('../lib/googleCalendar');
const { appendBooking, appendGift, appendSessionBono, getAllCustomQuotes, updateQuoteRow, appendLoyaltyMovement, getLoyaltyMovementsForPhone } = require('../lib/sheets');
const { earnRateFor, computeLoyaltyBalance, currentExpiryDate } = require('../config/loyalty');
const { accountingCategoryFor } = require('../config/accountingCategories');
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
    const expiryLabel = currentExpiryDate().toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
    return lang === 'en'
      ? `<p>💶 <strong>Your loyalty balance: ${balance.toFixed(2)} €</strong> — usable as a discount on your next single treatment paid at the centre (min. €10, max. €50 per redemption). Expires ${expiryLabel}.</p>`
      : `<p>💶 <strong>Tu saldo acumulado: ${balance.toFixed(2)} €</strong> — puedes usarlo como descuento en tu próximo tratamiento suelto pagado en el centro (canje mínimo 10 €, máximo 50 €). Caduca el ${expiryLabel}.</p>`;
  } catch (e) {
    console.error('No se pudo calcular el saldo para el email de confirmación:', e);
    return '';
  }
}

function formatDateLabel(dateStr, lang) {
  try {
    const d = new Date(`${dateStr}T12:00:00`);
    return d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  } catch (e) {
    return dateStr;
  }
}

// Puntos ganados por la parte ya pagada online (siempre "tarjeta") — es una
// estimación en el momento de la reserva, no la cifra final: el resto que
// se pague en el centro se calcula aparte al cerrar la cita (y puede ganar
// más si se paga en efectivo).
function estimatedEarnLine(primaryServiceId, paidOnline, lang) {
  if (!primaryServiceId || paidOnline <= 0) return '';
  const category = accountingCategoryFor(primaryServiceId);
  if (!category) return '';
  const earned = round2(paidOnline * earnRateFor(category, 'tarjeta'));
  if (earned <= 0) return '';
  return lang === 'en'
    ? `<p style="margin:0 0 4px;color:#f6eeda;font-size:14px;font-weight:600;">+${earned.toFixed(2)} € earned from this booking</p>`
    : `<p style="margin:0 0 4px;color:#f6eeda;font-size:14px;font-weight:600;">+${earned.toFixed(2)} € ganados con esta reserva</p>`;
}

async function sendBookingConfirmationEmail({ clientEmail, clientName, clientPhone, serviceName, primaryServiceId, date, time, employeeName, amountPaid, price, lang }) {
  if (!clientEmail) return;
  const isEn = lang === 'en';
  const total = Number(price) || 0;
  const paid = Number(amountPaid) || 0;
  const pending = Math.max(0, round2(total - paid));
  const dateLabel = formatDateLabel(date, lang);
  const manageUrl = isEn ? 'https://osana.es/en/mis-reservas.html' : 'https://osana.es/mis-reservas.html';

  const rows = [
    [isEn ? 'Reason for booking' : 'Motivo de reserva', escapeHtml(serviceName || '')],
    [isEn ? 'Date' : 'Fecha', escapeHtml(dateLabel)],
    [isEn ? 'Time' : 'Hora', escapeHtml(time || '')],
    [isEn ? 'Specialist' : 'Esteticista', escapeHtml(employeeName || '')],
    [isEn ? 'Paid online' : 'Pagado online', `${paid.toFixed(2)} €`],
    ...(pending > 0 ? [[isEn ? 'Remaining at the centre' : 'Resto a pagar en el centro', `${pending.toFixed(2)} €`]] : []),
  ];
  const rowsHtml = rows.map(([label, value], i) => `
    <tr>
      <td style="padding:10px 0;${i < rows.length - 1 ? 'border-bottom:1px solid #e8e2d8;' : ''}color:#8a8178;font-size:13px;">${label}</td>
      <td style="padding:10px 0;${i < rows.length - 1 ? 'border-bottom:1px solid #e8e2d8;' : ''}text-align:right;font-weight:600;color:#1a1612;font-size:14px;">${value}</td>
    </tr>`).join('');

  const earnedLine = estimatedEarnLine(primaryServiceId, paid, lang);
  const loyaltyLine = await loyaltyBalanceLine(clientPhone, lang);
  const loyaltyConditions = isEn
    ? [
        'Redeemable only on single treatments paid at the centre (not on session packages or gift vouchers).',
        'Minimum redemption of €10, maximum of €50 per treatment.',
        'Balance earned expires every December 31st — the count starts fresh each January 1st.',
        'Not transferable between clients or redeemable for cash — only as a discount on a treatment.',
      ]
    : [
        'Se canjea solo en tratamientos sueltos pagados en el centro (no en bonos de sesiones ni bonos regalo).',
        'Canje mínimo de 10 € y máximo de 50 € por tratamiento.',
        'El saldo generado caduca cada 31 de diciembre — la cuenta empieza de cero cada 1 de enero.',
        'No es transferible entre clientas ni canjeable por dinero en efectivo — solo como descuento en un tratamiento.',
      ];
  const loyaltyConditionsHtml = `<ul style="margin:10px 0 0;padding:0 0 0 16px;text-align:left;color:#cbbfae;font-size:11px;line-height:1.7;">${loyaltyConditions.map((c) => `<li>${c}</li>`).join('')}</ul>`;

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;background:#f6eeda;">
    <div style="background:#1a1612;padding:30px 24px 26px;text-align:center;">
      <img src="https://osana.es/images/logo-full-blanco.png" alt="Osana" style="height:36px;width:auto;display:inline-block;margin:0 0 16px;border:0;">
      <h1 style="margin:0;color:#f6eeda;font-size:20px;font-weight:600;">${isEn ? 'Booking confirmed' : 'Reserva confirmada'} ✓</h1>
    </div>
    <div style="padding:28px 24px;">
      <p style="margin:0 0 20px;color:#1a1612;font-size:15px;">${isEn ? 'Hi' : 'Hola'} ${escapeHtml(clientName || '')}, ${isEn ? 'thank you for booking with us. Here are your appointment details:' : 'gracias por confiar en nosotras. Aquí tienes los detalles de tu cita:'}</p>
      <table style="width:100%;border-collapse:collapse;">${rowsHtml}</table>
      <div style="text-align:center;margin:28px 0 8px;">
        <a href="${manageUrl}" style="display:inline-block;background:#ac977e;color:#1a1612;text-decoration:none;padding:13px 32px;font-size:12px;letter-spacing:1px;text-transform:uppercase;font-weight:600;">${isEn ? 'Manage my booking' : 'Gestionar mi reserva'}</a>
      </div>
      <p style="text-align:center;color:#8a8178;font-size:12px;margin:0;">${isEn ? 'Free cancellation or rescheduling up to 48h before.' : 'Puedes cancelar o reprogramar hasta 48h antes sin coste.'}</p>
    </div>
    <div style="background:#1a1612;padding:24px;text-align:center;">
      <p style="margin:0 0 10px;color:#ac977e;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;">${isEn ? 'Loyalty program' : 'Programa de fidelidad'}</p>
      ${earnedLine}
      ${loyaltyLine.replace(/<p>/, '<p style="margin:0 0 8px;color:#f6eeda;font-size:13px;">').replace('💶 ', '')}
      ${loyaltyConditionsHtml}
    </div>
  </div>`;

  try {
    await sendEmail({ to: clientEmail, subject: isEn ? 'Booking confirmed — Osana' : 'Reserva confirmada — Osana', html });
  } catch (emailErr) {
    console.error('No se pudo enviar el email de confirmación de reserva:', emailErr);
  }
}

// Aviso interno a Osana cada vez que se confirma una reserva/pago — antes
// solo se veía en Google Calendar, así que si no se está mirando el
// calendario en ese momento, una reserva nueva podía pasar desapercibida.
async function notifySalonNewBooking({ clientName, clientPhone, clientEmail, serviceName, date, time, employeeName, amountPaid, price }) {
  const total = Number(price) || 0;
  const paid = Number(amountPaid) || 0;
  const pending = Math.max(0, round2(total - paid));
  try {
    await sendEmail({
      to: SALON_EMAIL,
      subject: `📅 Nueva reserva: ${serviceName || ''} — ${date} ${time}`,
      html: `
        <p><strong>${escapeHtml(serviceName || '')}</strong></p>
        <p>${date} a las ${time} · con ${escapeHtml(employeeName || '')}</p>
        <p>Clienta: ${escapeHtml(clientName || '')} · ${escapeHtml(clientPhone || '')}${clientEmail ? ` · ${escapeHtml(clientEmail)}` : ''}</p>
        <p>Pagado online: <strong>${paid.toFixed(2)} €</strong>${pending > 0 ? ` · Pendiente en el centro: <strong>${pending.toFixed(2)} €</strong>` : ' (pago completo)'}</p>
      `,
    });
  } catch (e) {
    console.error('No se pudo mandar el aviso de nueva reserva al salón:', e);
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
    serviceName: combinedServiceName, primaryServiceId: serviceId, date, time,
    employeeName: employee ? employee.name : '',
    amountPaid: realAmountPaid, price, lang,
  });

  await notifySalonNewBooking({
    clientName, clientPhone, clientEmail,
    serviceName: combinedServiceName, date, time,
    employeeName: employee ? employee.name : '',
    amountPaid: realAmountPaid, price,
  });
}

function addMonthsISO(months) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

async function handleBonoSessionPayment(session) {
  const {
    bonoItems, singleItems, calendarId, eventId, employeeId, date, time,
    clientName, clientPhone, clientEmail, clientBirthdate,
    totalPrice, amount, paymentType, lang,
  } = session.metadata || {};

  // Combinación libre en la misma cita: uno o varios bonos (cada uno con su
  // propio bonoId/sesiones/precio) y, opcionalmente, tratamientos sueltos
  // añadidos junto a ellos (p.ej. bono pierna + masaje suelto).
  let bonoList = [];
  let singleList = [];
  try {
    bonoList = JSON.parse(bonoItems || '[]');
  } catch (e) {
    console.error('No se pudo leer bonoItems del metadata:', e);
  }
  try {
    singleList = JSON.parse(singleItems || '[]');
  } catch (e) {
    console.error('No se pudo leer singleItems del metadata:', e);
  }
  if (!bonoList.length) {
    // Este webhook solo se dispara para compras de tipo bono_session, que
    // bonoCheckout.js nunca crea sin al menos un bonoItem — si llegamos aquí
    // vacíos es que el metadata no se pudo leer (JSON corrupto/truncado), y
    // la clienta YA ha pagado. Avisamos a la salón por email para que no se
    // pierda el registro de un pago real sin cita/bono asociados.
    try {
      await sendEmail({
        to: SALON_EMAIL,
        subject: '⚠️ Pago de bono recibido sin poder registrarlo — revisar manualmente',
        html: `<p>Se ha recibido un pago (sesión de Stripe: ${session.id}) de tipo bono_session pero no se pudo leer el detalle de los tratamientos del metadata. Revisa el pago en el panel de Stripe y registra la reserva a mano.</p>
               <p>Cliente: ${clientName || 'desconocido'} · Teléfono: ${clientPhone || '-'} · Email: ${clientEmail || '-'}</p>`,
      });
    } catch (e) {
      console.error('No se pudo enviar el email de alerta de bono sin registrar:', e);
    }
    return;
  }

  const discountCents = (session.total_details && session.total_details.amount_discount) || 0;
  const realAmountPaid = typeof session.amount_total === 'number'
    ? Math.round(session.amount_total) / 100
    : Number(amount) || 0;
  const couponNote = discountCents > 0 ? ` (cupón aplicado: -${(discountCents / 100).toFixed(2)} €)` : '';

  const allRaw = [
    ...bonoList.map((it) => ({ ...it, isBono: true })),
    ...singleList.map((it) => ({ ...it, isBono: false })),
  ];
  const combinedTotal = Number(totalPrice) || allRaw.reduce((sum, it) => sum + Number(it.price || 0), 0);
  const employee = employees.find((e) => e.id === employeeId);

  // Repartimos el pago online proporcionalmente al precio de cada tratamiento
  // (bono o suelto); el último se lleva el resto de céntimos para que la
  // suma cuadre exacta.
  let assigned = 0;
  const itemsWithShare = allRaw.map((it, i) => {
    const itemService = services.find((s) => s.id === it.serviceId);
    let share;
    if (i === allRaw.length - 1) {
      share = round2(realAmountPaid - assigned);
    } else {
      share = round2(realAmountPaid * (Number(it.price) / combinedTotal || 0));
      assigned = round2(assigned + share);
    }
    return { ...it, service: itemService, amountPaidOnline: Math.max(0, share) };
  });

  const allNames = itemsWithShare.map((it) => (it.service ? it.service.name : it.serviceId)).join(' + ');

  if (calendarId && eventId) {
    const current = await getEvent(calendarId, eventId).catch(() => null);
    const newDescription = current
      ? (current.description || '').replace(
          '⏳ PENDIENTE DE PAGO — se confirma automáticamente al completar el pago.',
          `✅ PAGADO — ${realAmountPaid.toFixed(2)} € (${paymentType}) recibido correctamente por Stripe.${couponNote}`
        )
      : undefined;
    await updateEvent(calendarId, eventId, {
      summary: `✅ Confirmada — ${allNames} — ${clientName || ''}`.trim(),
      colorId: '10',
      ...(newDescription ? { description: newDescription } : {}),
    });
  }

  for (const it of itemsWithShare) {
    if (it.isBono) {
      const totalSessions = Number(it.sessions) || 1;
      const bonoPrice = Number(it.price) || 0;
      const remainingAmount = Math.max(0, round2(bonoPrice - it.amountPaidOnline));

      // 1) Registramos el bono en su propia pestaña, con la 1ª sesión ya usada
      try {
        await appendSessionBono({
          bonoId: it.bonoId,
          createdAt: new Date().toISOString(),
          clientName: clientName || '',
          clientPhone: clientPhone || '',
          clientEmail: clientEmail || '',
          serviceId: it.serviceId || '',
          serviceName: it.service ? it.service.name : '',
          employeeId: employeeId || '',
          totalSessions,
          sessionsUsed: 1,
          sessionsRemaining: totalSessions - 1,
          totalPrice: bonoPrice,
          amountPaidOnline: it.amountPaidOnline,
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
      // — comparte la misma cita/hueco de calendario que el resto de
      // tratamientos combinados en esta compra.
      try {
        await appendBooking({
          bookingId: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          status: 'confirmed',
          name: clientName || '',
          phone: clientPhone || '',
          email: clientEmail || '',
          serviceId: it.serviceId || '',
          serviceName: it.service ? `${it.service.name} (1/${totalSessions})` : '',
          employeeId: employeeId || '',
          employeeName: employee ? employee.name : '',
          calendarId: calendarId || '',
          eventId: eventId || '',
          date: date || '',
          time: time || '',
          durationMinutes: it.service ? it.service.durationMinutes : '',
          price: bonoPrice,
          amountPaid: it.amountPaidOnline,
          paymentType: paymentType || '',
          paymentIntentId: session.payment_intent || '',
          lang: lang === 'en' ? 'en' : 'es',
          reminderSent: '',
          birthdate: clientBirthdate || '',
          bonoId: it.bonoId || '',
          sessionNumber: 1,
        });
      } catch (sheetErr) {
        console.error('No se pudo guardar la sesión del bono en la Sheet:', sheetErr);
      }
    } else {
      // Tratamiento suelto añadido junto a uno o más bonos — reserva normal,
      // sin bonoId, compartiendo la misma cita/hueco de calendario.
      try {
        await appendBooking({
          bookingId: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          status: 'confirmed',
          name: clientName || '',
          phone: clientPhone || '',
          email: clientEmail || '',
          serviceId: it.serviceId || '',
          serviceName: it.service ? it.service.name : '',
          employeeId: employeeId || '',
          employeeName: employee ? employee.name : '',
          calendarId: calendarId || '',
          eventId: eventId || '',
          date: date || '',
          time: time || '',
          durationMinutes: it.service ? it.service.durationMinutes : '',
          price: Number(it.price) || 0,
          amountPaid: it.amountPaidOnline,
          paymentType: paymentType || '',
          paymentIntentId: session.payment_intent || '',
          lang: lang === 'en' ? 'en' : 'es',
          reminderSent: '',
          birthdate: clientBirthdate || '',
        });
      } catch (sheetErr) {
        console.error('No se pudo guardar el tratamiento suelto en la Sheet:', sheetErr);
      }
    }
  }

  const combinedServiceName = itemsWithShare
    .map((it) => {
      const name = it.service ? it.service.name : it.serviceId;
      return it.isBono ? `${name} — bono de ${it.sessions} sesiones (1/${it.sessions})` : name;
    })
    .join(' + ');

  await sendBookingConfirmationEmail({
    clientEmail, clientName, clientPhone,
    serviceName: combinedServiceName,
    primaryServiceId: itemsWithShare[0] ? itemsWithShare[0].serviceId : '',
    date, time,
    employeeName: employee ? employee.name : '',
    amountPaid: realAmountPaid, price: combinedTotal, lang,
  });

  await notifySalonNewBooking({
    clientName, clientPhone, clientEmail,
    serviceName: combinedServiceName, date, time,
    employeeName: employee ? employee.name : '',
    amountPaid: realAmountPaid, price: combinedTotal,
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
