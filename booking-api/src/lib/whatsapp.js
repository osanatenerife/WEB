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
  const missing = [
    !sid && 'TWILIO_ACCOUNT_SID', !token && 'TWILIO_AUTH_TOKEN',
    !from && 'TWILIO_WHATSAPP_FROM', !contentSid && 'TWILIO_REMINDER_TEMPLATE_SID',
  ].filter(Boolean);
  if (missing.length) {
    // Antes esto devolvía null en silencio (para no bloquear el resto de
    // recordatorios mientras Twilio no estaba configurado todavía). Ahora
    // que Twilio SÍ debería estar activo, lanzamos un error descriptivo:
    // reminders.js ya trata los fallos de WhatsApp como no bloqueantes, así
    // que esto no rompe nada y hace visible el problema real en el JSON de
    // respuesta en vez de fallar callado.
    throw new Error(`Faltan variables de Twilio en Render: ${missing.join(', ')}`);
  }

  const phone = toE164Spain(to);
  if (!phone) throw new Error(`No se pudo convertir el teléfono "${to}" a formato internacional`);

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

// Manda un SMS normal (no WhatsApp) de aviso interno a Osana — se usa para
// reenviar al móvil de la empresa las respuestas que las clientas mandan al
// número automático de recordatorios, ya que ese número no es el mismo con
// el que Osana usa la app de WhatsApp a diario (ver whatsappIncoming.js).
// No hace falta plantilla aprobada porque no va dirigido a una clienta.
async function sendOwnerSms(body) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  const ownerPhone = process.env.OWNER_PHONE || '+34623725551';
  if (!sid || !token || !from) return null;

  const fromPlain = from.replace('whatsapp:', '');
  const params = new URLSearchParams({ To: ownerPhone, From: fromPlain, Body: body.slice(0, 1500) });

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || 'Error mandando SMS con Twilio');
  }
  return data;
}

module.exports = { sendWhatsAppTemplate, toE164Spain, sendOwnerSms };
