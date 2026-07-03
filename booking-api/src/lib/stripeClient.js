const Stripe = require('stripe');

let stripe = null;
function getStripe() {
  if (!stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('Falta la variable de entorno STRIPE_SECRET_KEY');
    }
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripe;
}

/**
 * Crea una sesión de Stripe Checkout para cobrar la seña o el total.
 * amountEuros puede tener decimales (p.ej. seña del 20%).
 */
async function createCheckoutSession({ amountEuros, description, successUrl, cancelUrl, metadata }) {
  const stripeClient = getStripe();
  const amountCents = Math.round(amountEuros * 100);
  const session = await stripeClient.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'eur',
          product_data: { name: description },
          unit_amount: amountCents,
        },
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata,
    // Solo 30 minutos para pagar (el mínimo que permite Stripe): si no se
    // completa el pago, el webhook "checkout.session.expired" libera el
    // hueco que habíamos bloqueado en el calendario.
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
  });
  return session;
}

function constructWebhookEvent(rawBody, signature) {
  const stripeClient = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error('Falta la variable de entorno STRIPE_WEBHOOK_SECRET');
  }
  return stripeClient.webhooks.constructEvent(rawBody, signature, webhookSecret);
}

module.exports = { getStripe, createCheckoutSession, constructWebhookEvent };
