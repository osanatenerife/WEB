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
  // La cuenta de Stripe tiene varias "configuraciones de métodos de pago"
  // (la propia + un par heredadas de WooCommerce/WooPayments de la web
  // antigua) — sin especificar cuál usar, Stripe puede coger una de las de
  // WooCommerce (donde no controlamos si Klarna está activo), y el pago
  // sale con la marca "WooPayments" en vez de la nuestra. Si hay una
  // configuración propia guardada en STRIPE_PAYMENT_METHOD_CONFIGURATION_ID,
  // la usamos explícitamente cuando se permite Klarna, para evitar la
  // ambigüedad. payment_method_types y payment_method_configuration son
  // excluyentes en la API de Stripe, por eso es uno u otro.
  const pmcId = process.env.STRIPE_PAYMENT_METHOD_CONFIGURATION_ID;
  const paymentMethodParams = (allowKlarna && pmcId)
    ? { payment_method_configuration: pmcId }
    // Klarna solo se ofrece cuando se paga el 100% online (p.ej. bonos de
    // sesiones con pago completo) — no tiene sentido financiar solo una
    // seña, así que el resto de flujos (seña, bono regalo...) solo usan tarjeta.
    : { payment_method_types: allowKlarna ? ['card', 'klarna'] : ['card'] };
  const session = await stripeClient.checkout.sessions.create({
    mode: 'payment',
    ...paymentMethodParams,
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
 * Reembolsa un pago ya cobrado (usado al cancelar con antelación suficiente).
 * amountEuros es opcional: si no se indica, reembolsa el 100% del pago. Hace
 * falta indicarlo cuando el payment_intent cubre VARIOS tratamientos pagados
 * juntos en una sola compra (p.ej. un bono + un tratamiento suelto) y solo se
 * está cancelando uno de ellos — reembolsar sin importe devolvería el total
 * de la compra entera, no solo la parte de este tratamiento.
 */
async function refundPayment(paymentIntentId, amountEuros) {
  const stripeClient = getStripe();
  const params = { payment_intent: paymentIntentId };
  if (amountEuros !== undefined && amountEuros !== null) {
    params.amount = Math.round(amountEuros * 100);
  }
  return stripeClient.refunds.create(params);
}

module.exports = { getStripe, createCheckoutSession, constructWebhookEvent, refundPayment };
