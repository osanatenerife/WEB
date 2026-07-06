const path = require('path');
const sharp = require('sharp');

// ============================================================
// Genera la tarjeta del bono regalo como imagen (PNG), horizontal,
// pensada para imprimir: foto a la izquierda + panel de texto a la
// derecha con el mismo lenguaje visual que el resto de la web
// (crema/marrón, serif elegante). Se adjunta al email de confirmación.
// ============================================================

const CARD_W = 1600;
const CARD_H = 900;
const PHOTO_W = 560;
const PANEL_X = PHOTO_W; // el panel de texto empieza justo después de la foto
const PANEL_W = CARD_W - PHOTO_W;
const PANEL_CENTER_X = PANEL_X + PANEL_W / 2;
const PAD_X = 72;

const CREAM = '#f6eeda';
const LINE = '#e3d9c4';
const TXT = '#2a2520';
const TXT_MID = '#5a5248';
const BROWN = '#8a7350';

function escapeXml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Reparto simple de texto en líneas según un nº aproximado de caracteres
// por línea (no es medición real de píxeles, pero es suficiente para
// nombres/mensajes cortos con estas fuentes y tamaños fijos).
function wrapText(text, maxCharsPerLine, maxLines) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
    if (lines.length === maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines) {
    const last = lines[maxLines - 1];
    const consumed = lines.slice(0, -1).join(' ').length + last.length;
    if (consumed < String(text || '').trim().length) {
      lines[maxLines - 1] = last.replace(/.{3}$/, '...');
    }
  }
  return lines;
}

function tspanLines(lines, x, startY, lineHeight, extraAttrs = '') {
  return lines.map((line, i) => `<tspan x="${x}" y="${startY + i * lineHeight}" ${extraAttrs}>${escapeXml(line)}</tspan>`).join('');
}

function buildSvgOverlay({ fromName, toName, itemLabel, message, expiryLabel, code, lang }) {
  const isEn = lang === 'en';
  const strings = isEn
    ? {
        subtitle: 'HAIR REMOVAL & BEAUTY CENTER',
        from: 'From', to: 'To', validUntil: 'Valid until',
        intro: 'For someone special, a special gift.',
        redemption: 'Prior booking required to redeem this voucher.',
        code: 'Code', contact: 'Contact',
      }
    : {
        subtitle: 'CENTRO DE DEPILACIÓN Y ESTÉTICA',
        from: 'De', to: 'Para', validUntil: 'Válido hasta',
        intro: 'Para una persona especial, un regalo especial.',
        redemption: 'Se requiere reserva previa para canjear este bono.',
        code: 'Código', contact: 'Contacto',
      };

  const itemLines = wrapText(itemLabel, 28, 2);
  const messageLines = message ? wrapText(message, 46, 3) : [];

  const rowsY = 210;
  const rowGap = 56;

  return `
  <svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${PANEL_X}" y="0" width="${PANEL_W}" height="${CARD_H}" fill="${CREAM}"/>

    <text x="${PANEL_CENTER_X}" y="108" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="34" letter-spacing="6" fill="${TXT}">OSANA</text>
    <text x="${PANEL_CENTER_X}" y="138" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" letter-spacing="3" fill="${BROWN}">${strings.subtitle}</text>

    <line x1="${PANEL_X + PAD_X}" y1="${rowsY - 34}" x2="${CARD_W - PAD_X}" y2="${rowsY - 34}" stroke="${LINE}" stroke-width="1"/>
    <text x="${PANEL_X + PAD_X}" y="${rowsY}" xml:space="preserve" font-family="Arial, sans-serif" font-size="19" fill="${TXT}"><tspan font-weight="700">${strings.from}: </tspan>${escapeXml(fromName)}</text>
    <line x1="${PANEL_X + PAD_X}" y1="${rowsY + 20}" x2="${CARD_W - PAD_X}" y2="${rowsY + 20}" stroke="${LINE}" stroke-width="1"/>
    <text x="${PANEL_X + PAD_X}" y="${rowsY + rowGap}" xml:space="preserve" font-family="Arial, sans-serif" font-size="19" fill="${TXT}"><tspan font-weight="700">${strings.to}: </tspan>${escapeXml(toName)}</text>
    <line x1="${PANEL_X + PAD_X}" y1="${rowsY + rowGap + 20}" x2="${CARD_W - PAD_X}" y2="${rowsY + rowGap + 20}" stroke="${LINE}" stroke-width="1"/>
    <text x="${PANEL_X + PAD_X}" y="${rowsY + rowGap * 2}" xml:space="preserve" font-family="Arial, sans-serif" font-size="19" fill="${TXT}"><tspan font-weight="700">${strings.validUntil}: </tspan>${escapeXml(expiryLabel)}</text>

    <text x="${PANEL_CENTER_X}" y="${rowsY + rowGap * 2 + 56}" text-anchor="middle" font-family="Arial, sans-serif" font-size="17" fill="${TXT_MID}">${strings.intro}</text>

    <line x1="${PANEL_X + PAD_X}" y1="${rowsY + rowGap * 2 + 92}" x2="${CARD_W - PAD_X}" y2="${rowsY + rowGap * 2 + 92}" stroke="${TXT}" stroke-width="1"/>
    <text text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="34" fill="${BROWN}">
      ${tspanLines(itemLines, PANEL_CENTER_X, rowsY + rowGap * 2 + 92 + 54, 42)}
    </text>
    <line x1="${PANEL_X + PAD_X}" y1="${rowsY + rowGap * 2 + 92 + (itemLines.length * 42) + 34}" x2="${CARD_W - PAD_X}" y2="${rowsY + rowGap * 2 + 92 + (itemLines.length * 42) + 34}" stroke="${TXT}" stroke-width="1"/>

    ${messageLines.length ? `<text text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="17" fill="${TXT}">
      ${tspanLines(messageLines, PANEL_CENTER_X, rowsY + rowGap * 2 + 92 + (itemLines.length * 42) + 76, 26)}
    </text>` : ''}

    <text x="${PANEL_CENTER_X}" y="${CARD_H - 118}" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" fill="${BROWN}">✦</text>

    <text x="${PANEL_CENTER_X}" y="${CARD_H - 82}" text-anchor="middle" font-family="Arial, sans-serif" font-size="12.5" fill="${TXT_MID}">${strings.redemption}</text>
    <text x="${PANEL_CENTER_X}" y="${CARD_H - 58}" text-anchor="middle" font-family="Arial, sans-serif" font-size="12.5" fill="${TXT_MID}"><tspan font-weight="700">${strings.code}: ${code}</tspan></text>
    <text x="${PANEL_CENTER_X}" y="${CARD_H - 34}" text-anchor="middle" font-family="Arial, sans-serif" font-size="12.5" fill="${TXT_MID}">${strings.contact}: +34 623 725 551 · @osana_tenerife · www.osana.es</text>
  </svg>`;
}

async function generateGiftCardBuffer({ fromName, toName, itemLabel, message, expiryLabel, code, lang }) {
  const photoBuffer = await sharp(path.join(__dirname, '../../assets/gift-photo.jpg'))
    .resize(PHOTO_W, CARD_H, { fit: 'cover', position: 'attention' })
    .toBuffer();

  const svg = buildSvgOverlay({ fromName, toName, itemLabel, message, expiryLabel, code, lang });

  return sharp({
    create: { width: CARD_W, height: CARD_H, channels: 3, background: CREAM },
  })
    .composite([
      { input: photoBuffer, left: 0, top: 0 },
      { input: Buffer.from(svg), left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
}

module.exports = { generateGiftCardBuffer };
