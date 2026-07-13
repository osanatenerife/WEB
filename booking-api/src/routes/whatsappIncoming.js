const express = require('express');
const crypto = require('crypto');
const { sendOwnerSms } = require('../lib/whatsapp');

const router = express.Router();

// Comprueba que la petición viene realmente de Twilio (firma HMAC-SHA1 con
// el Auth Token, según su documentación). No es bloqueante: si algo no
// cuadra (por ejemplo la URL pública configurada en Twilio no coincide
// exactamente con la que ve el servidor detrás de un proxy), preferimos
// igualmente reenviar el mensaje — perder un mensaje real de una clienta
// sin que nadie se entere es peor que reenviar alguno sin poder verificar
// la firma al 100%. Se marca igualmente en el aviso.
function isValidTwilioSignature(req) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  const signature = req.headers['x-twilio-signature'];
  if (!token || !signature) return false;
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  const params = req.body || {};
  const data = Object.keys(params).sort()
    .reduce((acc, key) => acc + key + params[key], url);
  const expected = crypto.createHmac('sha1', token).update(Buffer.from(data, 'utf-8')).digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature)));
  } catch (e) {
    return false;
  }
}

// Twilio manda los mensajes entrantes de WhatsApp como
// application/x-www-form-urlencoded — el resto de la API usa express.json(),
// que no lee este formato, así que este endpoint necesita su propio parser.
router.post('/whatsapp/incoming', express.urlencoded({ extended: false }), async (req, res) => {
  const valid = isValidTwilioSignature(req);
  const from = String(req.body.From || '').replace('whatsapp:', '');
  const body = req.body.Body || '(mensaje vacío o multimedia)';
  const profileName = req.body.ProfileName || '';

  const text = [
    `WhatsApp de ${profileName || from} (${from}):`,
    `"${body}"`,
    valid ? '' : '(sin verificar del todo — revisa antes de actuar)',
  ].filter(Boolean).join('\n');

  try {
    // Se manda como SMS al móvil real de Osana (no por el número de Twilio
    // de los recordatorios), para que llegue como notificación al momento,
    // ya que ese número no está conectado a la app de WhatsApp del negocio.
    await sendOwnerSms(text);
  } catch (e) {
    console.error('No se pudo reenviar por SMS el WhatsApp entrante:', e);
  }

  // Respuesta TwiML vacía: no contestamos nada automático a la clienta.
  res.set('Content-Type', 'text/xml');
  res.send('<Response></Response>');
});

module.exports = router;
