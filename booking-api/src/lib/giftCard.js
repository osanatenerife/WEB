const path = require('path');
const sharp = require('sharp');

// ============================================================
// Genera la tarjeta del bono regalo como imagen (PNG), horizontal,
// pensada para imprimir: foto a sangre completa + panel translúcido
// tipo "cristal esmerilado" con los datos, y el logo abajo — mismo
// estilo que la plantilla de referencia que nos pasó la clienta.
// ============================================================

const CARD_W = 1600;
const CARD_H = 1140;
const PAD_X = 96;

const PANEL = { left: 128, top: 319, right: 1472, bottom: 912 };
const PANEL_W = PANEL.right - PANEL.left;
const PANEL_CENTER_X = (PANEL.left + PANEL.right) / 2;

const TXT = '#1a1612';
const TXT_MID = '#3a342c';
const LOGO_W = 300;

function escapeXml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Reparto simple de texto en líneas según un nº aproximado de caracteres
// por línea (no es medición real de píxeles, pero es suficiente para
// nombres/mensajes cortos con estas fuentes y tamaños fijos). Primero
// reparte TODO el texto en tantas líneas naturales como haga falta, y solo
// si sobran líneas por encima de maxLines se recorta la última con "...".
function wrapText(text, maxCharsPerLine, maxLines) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const allLines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      allLines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) allLines.push(current);

  if (allLines.length <= maxLines) return allLines;

  const lines = allLines.slice(0, maxLines);
  lines[maxLines - 1] = lines[maxLines - 1].replace(/.{3}$/, '...');
  return lines;
}

function tspanLines(lines, x, startY, lineHeight) {
  return lines.map((line, i) => `<tspan x="${x}" y="${startY + i * lineHeight}">${escapeXml(line)}</tspan>`).join('');
}

function buildSvgOverlay({ fromName, toName, itemLabel, message, expiryLabel, code, lang }) {
  const isEn = lang === 'en';
  const strings = isEn
    ? {
        title: 'GIFT VOUCHER', tagline: 'a gift to treat yourself',
        to: 'TO:', from: 'FROM:', validUntil: 'VALID UNTIL:', giftIntro: 'COME AND TREAT YOURSELF WITH:',
        redemption: 'PRIOR BOOKING REQUIRED TO REDEEM THIS VOUCHER.',
        code: 'CODE',
      }
    : {
        title: 'BONO REGALO', tagline: 'un regalo para que te mimes',
        to: 'PARA:', from: 'DE:', validUntil: 'VALIDEZ:', giftIntro: 'VEN Y MÍMATE CON:',
        redemption: 'SE REQUIERE PREVIA RESERVA PARA CANJEAR EL BONO.',
        code: 'CÓDIGO',
      };

  const itemLines = wrapText(itemLabel, 30, 2);
  const messageLines = message ? wrapText(message, 60, 2) : [];

  const row1Y = PANEL.top + 84;
  const row1LineY = row1Y + 30;
  const row2Y = row1Y + 96;
  const row2LineY = row2Y + 30;

  const giftLabelY = row2Y + 130;
  const giftValueY = giftLabelY + 66;
  const giftLineY = giftValueY + (itemLines.length > 1 ? 46 : 16);
  const messageY = giftLineY + 46;

  return `
  <svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${PANEL.left}" y="${PANEL.top}" width="${PANEL_W}" height="${PANEL.bottom - PANEL.top}" fill="#f6eeda" fill-opacity="0.58"/>

    <text x="${CARD_W / 2}" y="230" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" font-size="72" letter-spacing="10" fill="${TXT}">${strings.title}</text>
    <text x="${CARD_W / 2}" y="288" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="32" fill="${TXT_MID}">${strings.tagline}</text>

    <text x="${PANEL.left + PAD_X}" y="${row1Y}" font-family="Arial, sans-serif" font-weight="700" font-size="17" letter-spacing="2" fill="${TXT}">${strings.to}</text>
    <text x="${PANEL.left + PAD_X}" y="${row1Y + 44}" font-family="Georgia, serif" font-size="26" fill="${TXT}">${escapeXml(toName)}</text>
    <line x1="${PANEL.left + PAD_X}" y1="${row1LineY + 44}" x2="${PANEL_CENTER_X + 60}" y2="${row1LineY + 44}" stroke="${TXT}" stroke-width="1.4"/>

    <text x="${PANEL_CENTER_X + 140}" y="${row1Y}" font-family="Arial, sans-serif" font-weight="700" font-size="17" letter-spacing="2" fill="${TXT}">${strings.validUntil}</text>
    <text x="${PANEL_CENTER_X + 140}" y="${row1Y + 44}" font-family="Georgia, serif" font-size="26" fill="${TXT}">${escapeXml(expiryLabel)}</text>
    <line x1="${PANEL_CENTER_X + 140}" y1="${row1LineY + 44}" x2="${PANEL.right - PAD_X}" y2="${row1LineY + 44}" stroke="${TXT}" stroke-width="1.4"/>

    <text x="${PANEL.left + PAD_X}" y="${row2Y + 44}" font-family="Arial, sans-serif" font-weight="700" font-size="17" letter-spacing="2" fill="${TXT}">${strings.from}</text>
    <text x="${PANEL.left + PAD_X + 90}" y="${row2Y + 44}" font-family="Georgia, serif" font-size="26" fill="${TXT}">${escapeXml(fromName)}</text>
    <line x1="${PANEL.left + PAD_X}" y1="${row2LineY + 60}" x2="${PANEL_CENTER_X + 60}" y2="${row2LineY + 60}" stroke="${TXT}" stroke-width="1.4"/>

    <text x="${CARD_W / 2}" y="${giftLabelY}" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="17" letter-spacing="2" fill="${TXT}">${strings.giftIntro}</text>
    <text text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="40" fill="${TXT}">
      ${tspanLines(itemLines, CARD_W / 2, giftValueY, 48)}
    </text>
    <line x1="${PANEL_CENTER_X - 260}" y1="${giftLineY}" x2="${PANEL_CENTER_X + 260}" y2="${giftLineY}" stroke="${TXT}" stroke-width="1.4"/>

    ${messageLines.length ? `<text text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="17" fill="${TXT_MID}">
      ${tspanLines(messageLines, CARD_W / 2, messageY, 24)}
    </text>` : ''}

    <text x="${CARD_W / 2}" y="${PANEL.bottom - 54}" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" letter-spacing="1.5" fill="${TXT_MID}">${strings.redemption}</text>
    <text x="${CARD_W / 2}" y="${PANEL.bottom - 28}" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" letter-spacing="1.5" fill="${TXT_MID}">${strings.code}: <tspan font-weight="700">${code}</tspan> · CONTACTO: +34 623 725 551 · @osana_tenerife · www.osana.es</text>
  </svg>`;
}

async function generateGiftCardBuffer({ fromName, toName, itemLabel, message, expiryLabel, code, lang }) {
  const photoBuffer = await sharp(path.join(__dirname, '../../assets/gift-photo.jpg'))
    .resize(CARD_W, CARD_H, { fit: 'cover', position: 'attention' })
    .toBuffer();

  const logoBuffer = await sharp(path.join(__dirname, '../../assets/logo-negro.png'))
    .resize({ width: LOGO_W })
    .toBuffer();
  const logoMeta = await sharp(logoBuffer).metadata();
  const logoTop = PANEL.bottom + 30;
  const logoLeft = Math.round((CARD_W - LOGO_W) / 2);

  const svg = buildSvgOverlay({ fromName, toName, itemLabel, message, expiryLabel, code, lang });

  return sharp(photoBuffer)
    .composite([
      { input: Buffer.from(svg), left: 0, top: 0 },
      { input: logoBuffer, left: logoLeft, top: logoTop },
    ])
    .png()
    .toBuffer();
}

module.exports = { generateGiftCardBuffer };
