const Stripe = require('stripe');

let stripe = null;
function getStripe() {
  if (!stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('Falta la variable de entorno STRIPE_SECRET_KEY');
    }
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      // Reintenta automáticamente ante fallos de red puntuales (p.ej. el
      // servidor de Render "despertando" de estar inactivo), en vez de
      // fallar el pago a la primera.
      maxNetworkRetries: 3,
      timeout: 20000,
    });
  }
  return stripe;
}

/**
 * Crea una sesión de Stripe Checkout para cobrar la seña o el total.
 * amountEuros puede tener decimales (p.ej. seña del 20%).
 */
async function createCheckoutSession({ amountEuros, description, successUrl, cancelUrl, metadata, allowKlarna }) {
  const stripeClient = getStripe();
  const amountCents = Math.round(amountEuros * 100);
  const session = await stripeClient.checkout.sessions.create({
    mode: 'payment',
    // Klarna solo se ofrece cuando se paga el 100% online (p.ej. bonos de
    // sesiones con pago completo) — no tiene sentido financiar solo una
    // seña, así que el resto de flujos (seña, bono regalo...) solo usan tarjeta.
    payment_method_types: allowKlarna ? ['card', 'klarna'] : ['card'],
    // Permite que el cliente introduzca un código de cupón en la propia
    // pantalla de pago de Stripe. Los cupones se crean y activan/desactivan
    // desde el Dashboard de Stripe (Productos > Cupones y códigos promocionales),
    // sin tocar código — sirve para esta oferta de lanzamiento y para cualquier
    // promoción futura.
    allow_promotion_codes: true,
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

/**
 * Reembolsa el 100% de un pago ya cobrado (usado al cancelar con ≥24h de antelación).
 */
async function refundPayment(paymentIntentId) {
  const stripeClient = getStripe();
  return stripeClient.refunds.create({ payment_intent: paymentIntentId });
}

module.exports = { getStripe, createCheckoutSession, constructWebhookEvent, refundPayment };
