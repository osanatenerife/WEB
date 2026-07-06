// Resuelve la URL base del frontend para construir success_url/cancel_url de Stripe.
// Prioriza la cabecera Origin de la petición (llega del navegador del cliente) y usa
// FRONTEND_URL como respaldo. Si ninguna es una URL completa con esquema (https://),
// Stripe rechaza la sesión con "Invalid URL" — así que lo validamos aquí con un
// mensaje claro en vez de dejar que falle de forma críptica en el pago.
function resolveOrigin(req) {
  const candidate = req.headers.origin || process.env.FRONTEND_URL;
  if (!candidate || !/^https?:\/\//i.test(candidate)) {
    throw new Error(
      'Falta configurar FRONTEND_URL en el servidor (debe ser una URL completa, p.ej. https://osana.es).'
    );
  }
  return candidate;
}

module.exports = { resolveOrigin };
