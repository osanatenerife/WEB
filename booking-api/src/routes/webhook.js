const express = require('express');
const { constructWebhookEvent } = require('../lib/stripeClient');
const { getEvent, updateEvent, deleteEvent } = require('../lib/googleCalendar');

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
      const { calendarId, eventId, clientName, amount, paymentType } = session.metadata || {};
      if (calendarId && eventId) {
        const current = await getEvent(calendarId, eventId).catch(() => null);
        const newDescription = current
          ? (current.description || '').replace(
              '⏳ PENDIENTE DE PAGO — se confirma automáticamente al completar el pago.',
              `✅ PAGADO — ${amount} € (${paymentType}) recibido correctamente por Stripe.`
            )
          : undefined;

        await updateEvent(calendarId, eventId, {
          summary: `✅ Confirmada — ${clientName || ''}`.trim(),
          colorId: '10', // verde en Google Calendar
          ...(newDescription ? { description: newDescription } : {}),
        });
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
