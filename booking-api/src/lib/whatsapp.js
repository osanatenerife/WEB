// ============================================================
// Envío de recordatorios por WhatsApp vía Twilio (API REST con
// fetch nativo, sin SDK — mismo patrón que lib/email.js con Resend).
//
// IMPORTANTE: un recordatorio de cita se manda 24h antes, fuera de
// la "ventana de servicio" de 24h desde el último mensaje del
// cliente — así que WhatsApp/Meta EXIGE usar una plantilla ya
// aprobada (no se puede mandar texto libre). Por eso esta función
// no recibe un texto cualquiera, sino el ContentSid de la plantilla
// aprobada en Twilio + sus variables. Ver SETUP.md para cómo crear
// y aprobar esa plantilla.
//
// Si las variables de entorno no están configuradas todavía, la
// función no hace nada (no rompe el resto de recordatorios) — así
// se puede desplegar el código antes de tener la cuenta de Twilio
// lista, igual que se hizo con el resto de integraciones.
// ============================================================

function toE164Spain(raw) {
  const trimmed = String(raw || '').trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;
  if (trimmed.startsWith('+')) return `+${digits}`;
  if (digits.length === 9) return `+34${digits}`; // móvil español sin prefijo
  if (digits.startsWith('34') && digits.length === 11) return `+${digits}`;
  return `+${digits}`;
}

async function sendWhatsAppTemplate({ to, variables }) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  const contentSid = process.env.TWILIO_REMINDER_TEMPLATE_SID;
  if (!sid || !token || !from || !contentSid) return null; // WhatsApp aún no configurado: se omite en silencio

  const phone = toE164Spain(to);
  if (!phone) return null;

  const body = new URLSearchParams({
    To: `whatsapp:${phone}`,
    From: from.startsWith('whatsapp:') ? from : `whatsapp:${from}`,
    ContentSid: contentSid,
    ContentVariables: JSON.stringify(variables),
  });

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || 'Error enviando WhatsApp con Twilio');
  }
  return data;
}

module.exports = { sendWhatsAppTemplate, toE164Spain };
