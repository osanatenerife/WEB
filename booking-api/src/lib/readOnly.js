// ============================================================
// Modo "solo lectura" (DATA_READONLY=1) — para la ventana del cambio de
// Google Sheet a Supabase (docs/FASE2-PLAN.md, paso 5). Con él la web y
// el panel se pueden consultar, pero nada se escribe.
//
// Se corta en la PUERTA (este middleware, en server.js), antes de que
// ninguna ruta llegue a mandar un email, tocar el calendario o cobrar: si
// se cortara solo al escribir en la base, una ruta podría mandar el
// recordatorio y luego no poder marcarlo como enviado (y repetirlo a la
// hora siguiente).
//
// - Toda petición que no sea GET/HEAD/OPTIONS → 503. El webhook de Stripe
//   también: con un 503 Stripe reintenta solo durante horas, así que no se
//   pierde ningún pago (con el webhook dentro, en cambio, un error se
//   responde 200 a propósito y Stripe no reintentaría).
// - Los GET que escriben o mandan mensajes → 503 también (las tareas
//   automáticas lo vuelven a intentar en su próxima ejecución).
// - Además, sheets.js rechaza cualquier escritura (segunda red).
// ============================================================

// GET que tienen efectos (escriben en la base o mandan emails/WhatsApp).
const WRITING_GETS = ['/api/send-reminders', '/api/send-birthday-emails', '/api/unsubscribe', '/api/test-whatsapp'];

function isReadOnly() {
  return String(process.env.DATA_READONLY || '').trim() === '1';
}

function readOnlyGate(req, res, next) {
  if (!isReadOnly()) return next();
  const safeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  const writingGet = WRITING_GETS.includes(req.path.replace(/\/+$/, ''));
  if (safeMethod && !writingGet) return next();
  res.set('Retry-After', '900');
  return res.status(503).json({
    error: 'Estamos haciendo una tarea de mantenimiento. Vuelve a intentarlo en unos minutos.',
    maintenance: true,
  });
}

module.exports = { isReadOnly, readOnlyGate, WRITING_GETS };
