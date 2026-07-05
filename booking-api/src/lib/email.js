// ============================================================
// Envío de emails transaccionales vía Resend (API REST, sin
// dependencias nuevas — usa el fetch nativo de Node).
// ============================================================

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('Falta la variable de entorno RESEND_API_KEY');
  const from = process.env.RESEND_FROM_EMAIL || 'Osana <onboarding@resend.dev>';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || 'Error enviando email con Resend');
  }
  return data;
}

module.exports = { sendEmail };
