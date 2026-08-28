const express = require('express');
const crypto = require('crypto');
const services = require('../config/services');
const { createCheckoutSession } = require('../lib/stripeClient');
const { resolveOrigin } = require('../lib/origin');

const router = express.Router();

const MIN_GIFT_AMOUNT = 20;

router.post('/gift-checkout', async (req, res) => {
  const { giftType, serviceId, amount, fromName, toName, message, buyerEmail, buyerPhone, lang } = req.body || {};
  const pagePath = lang === 'en' ? '/en/bono-regalo.html' : lang === 'it' ? '/it/bono-regalo.html' : '/bono-regalo.html';

  if (!fromName || !toName || !buyerEmail) {
    return res.status(400).json({ error: 'Faltan datos del bono (de, para o email).' });
  }

  let price;
  let itemName;
  let itemNameEn;
  let itemNameIt;
  if (giftType === 'service') {
    const service = services.find((s) => s.id === serviceId);
    if (!service) return res.status(404).json({ error: 'Tratamiento no encontrado.' });
    price = service.price;
    itemName = service.name;
    itemNameEn = service.nameEn || service.name;
    itemNameIt = service.nameIt || service.name;
  } else if (giftType === 'amount') {
    price = Number(amount);
    if (!price || price < MIN_GIFT_AMOUNT) {
      return res.status(400).json({ error: `El importe mínimo del bono es ${MIN_GIFT_AMOUNT} €.` });
    }
    itemName = `${price} € para gastar en cualquier tratamiento`;
    itemNameEn = `€${price} to spend on any treatment`;
    itemNameIt = `${price} € da spendere su qualsiasi trattamento`;
  } else {
    return res.status(400).json({ error: 'Tipo de bono no válido.' });
  }

  const giftId = crypto.randomUUID();

  try {
    const origin = resolveOrigin(req);
    const session = await createCheckoutSession({
      amountEuros: price,
      description: lang === 'en'
        ? `Osana gift voucher — ${itemNameEn}`
        : lang === 'it'
          ? `Buono regalo Osana — ${itemNameIt}`
          : `Bono regalo Osana — ${itemName}`,
      successUrl: `${origin}${pagePath}?estado=ok`,
      cancelUrl: `${origin}${pagePath}?estado=cancelado`,
      metadata: {
        type: 'gift',
        giftId,
        giftType,
        serviceId: giftType === 'service' ? serviceId : '',
        amount: String(price),
        fromName,
        toName,
        message: (message || '').slice(0, 400),
        buyerEmail,
        buyerPhone: buyerPhone || '',
        lang: lang === 'en' ? 'en' : lang === 'it' ? 'it' : 'es',
      },
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'No se pudo iniciar el pago del bono regalo.' });
  }
});

module.exports = router;
