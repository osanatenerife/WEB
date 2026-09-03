// ============================================================
// Envío de emails transaccionales vía Resend (API REST, sin
// dependencias nuevas — usa el fetch nativo de Node).
// ============================================================

// Un email que solo lleva versión HTML (sin alternativa de texto plano) es
// una señal clásica de spam para filtros como el de Yahoo/Gmail — generamos
// automáticamente una versión de texto a partir del HTML si quien llama no
// manda una explícita, para no tener que tocar cada sitio donde se manda un
// email.
function htmlToPlainText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/div>|<\/h[1-6]>|<\/tr>|<\/li>/gi, '\n')
    .replace(/<\/td>|<\/th>/gi, '  ')
    .replace(/<li>/gi, '- ')
    .replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

async function sendEmail({ to, subject, html, text, attachments }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('Falta la variable de entorno RESEND_API_KEY');
  const from = process.env.RESEND_FROM_EMAIL || 'Osana <onboarding@resend.dev>';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    // attachments: [{ filename, content }] — content en base64 (ver docs de Resend)
    body: JSON.stringify({
      from, to, subject, html,
      text: text || htmlToPlainText(html),
      ...(attachments ? { attachments } : {}),
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || 'Error enviando email con Resend');
  }
  return data;
}

module.exports = { sendEmail };
