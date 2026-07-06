const express = require('express');
const crypto = require('crypto');
const { constructWebhookEvent } = require('../lib/stripeClient');
const { getEvent, updateEvent, deleteEvent } = require('../lib/googleCalendar');
const { appendBooking, appendGift } = require('../lib/sheets');
const { sendEmail } = require('../lib/email');
const { generateGiftCardBuffer } = require('../lib/giftCard');
const services = require('../config/services');
const employees = require('../config/employees');

const router = express.Router();

const GIFT_VALIDITY_MONTHS = 6;
const SALON_EMAIL = process.env.GIFT_NOTIFY_EMAIL || 'osanatenerife@gmail.com';

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function randomVoucherCode() {
  return 'OSANA-' + crypto.randomBytes(4).toString('hex').toUpperCase();
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
  if (bookingId) {
    try {
      const service = services.find((s) => s.id === serviceId);
      const employee = employees.find((e) => e.id === employeeId);
      const additionalServiceIds = (extraServiceIds || '').split(',').filter(Boolean);
      const additionalServices = additionalServiceIds.map((id) => services.find((s) => s.id === id)).filter(Boolean);
      const combinedServiceId = [serviceId, ...additionalServiceIds].filter(Boolean).join(',');
      const combinedServiceName = [service ? service.name : null, ...additionalServices.map((s) => s.name)].filter(Boolean).join(' + ');
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
      if ((session.metadata || {}).type === 'gift') {
        await handleGiftPayment(session);
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
