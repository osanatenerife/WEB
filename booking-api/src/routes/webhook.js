const express = require('express');
const { constructWebhookEvent } = require('../lib/stripeClient');
const { getEvent, updateEvent, deleteEvent } = require('../lib/googleCalendar');
const { appendBooking } = require('../lib/sheets');
const services = require('../config/services');
const employees = require('../config/employees');

const router = express.Router();

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
      const {
        bookingId, calendarId, eventId, serviceId, employeeId, date, time,
        durationMinutes, clientName, clientPhone, clientEmail, price, amount, paymentType, lang,
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
          });
        } catch (sheetErr) {
          // No bloqueamos la confirmación de la cita si falla el registro en la Sheet
          console.error('No se pudo guardar la reserva en la Sheet:', sheetErr);
        }
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
