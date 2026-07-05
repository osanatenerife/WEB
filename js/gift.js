// ============================================================
// OSANA — Lógica del bono regalo (bono-regalo.html / en/bono-regalo.html)
// ============================================================
(function () {
  const LANG = (typeof window !== 'undefined' && window.BOOKING_LANG === 'en') ? 'en' : 'es';

  const STR = {
    loadingServices: { es: 'Cargando tratamientos…', en: 'Loading treatments…' },
    loadServicesError: { es: 'No se pudieron cargar los tratamientos.', en: 'Could not load treatments.' },
    chooseTreatment: { es: 'Elige un tratamiento', en: 'Choose a treatment' },
    fillRequired: { es: 'Rellena de, para y tu email para continuar.', en: 'Fill in from, to and your email to continue.' },
    chooseTreatmentError: { es: 'Elige un tratamiento del listado.', en: 'Choose a treatment from the list.' },
    minAmountError: { es: 'El importe mínimo es 20 €.', en: 'The minimum amount is €20.' },
    connecting: { es: 'Conectando con el pago seguro…', en: 'Connecting to secure payment…' },
    submitLabel: { es: 'Pagar y enviar bono', en: 'Pay and send voucher' },
    checkoutError: { es: 'No se pudo iniciar el pago.', en: 'Could not start the payment.' },
    confirmedTitle: { es: '¡Bono comprado! ✓', en: 'Voucher purchased! ✓' },
    confirmedText: { es: 'Te hemos enviado el bono regalo por email. Revisa también la carpeta de spam por si acaso.', en: "We've sent the gift voucher to your email. Check your spam folder too, just in case." },
    backHome: { es: 'Volver al inicio', en: 'Back to home' },
    cancelledPayment: { es: 'Has cancelado el pago. Puedes intentarlo de nuevo cuando quieras.', en: 'You cancelled the payment. You can try again whenever you like.' },
  };
  function t(key) { return (STR[key] && STR[key][LANG]) || (STR[key] && STR[key].es) || key; }

  const els = {
    shell: document.querySelector('.booking-shell'),
    form: document.getElementById('gift-form'),
    error: document.getElementById('gift-error'),
    typeService: document.getElementById('gift-type-service'),
    typeAmount: document.getElementById('gift-type-amount'),
    serviceField: document.getElementById('gift-service-field'),
    serviceSelect: document.getElementById('gift-service-select'),
    amountField: document.getElementById('gift-amount-field'),
    amountInput: document.getElementById('gift-amount-input'),
    from: document.getElementById('gift-from'),
    to: document.getElementById('gift-to'),
    message: document.getElementById('gift-message'),
    email: document.getElementById('gift-email'),
    phone: document.getElementById('gift-phone'),
    submit: document.getElementById('gift-submit'),
  };

  let giftType = 'service';

  function showError(msg) {
    els.error.textContent = msg;
    els.error.style.display = 'block';
    els.error.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function clearError() {
    els.error.style.display = 'none';
  }

  function setGiftType(type) {
    giftType = type;
    els.typeService.classList.toggle('active', type === 'service');
    els.typeAmount.classList.toggle('active', type === 'amount');
    els.serviceField.style.display = type === 'service' ? 'block' : 'none';
    els.amountField.style.display = type === 'amount' ? 'block' : 'none';
  }
  els.typeService.addEventListener('click', () => setGiftType('service'));
  els.typeAmount.addEventListener('click', () => setGiftType('amount'));

  async function loadServices() {
    try {
      const res = await fetch(`${BOOKING_API_BASE}/services?lang=${LANG}`);
      const data = await res.json();
      const byCategory = {};
      data.services.forEach((s) => {
        byCategory[s.category] = byCategory[s.category] || [];
        byCategory[s.category].push(s);
      });
      els.serviceSelect.innerHTML = `<option value="">${t('chooseTreatment')}</option>`;
      Object.keys(byCategory).forEach((cat) => {
        const group = document.createElement('optgroup');
        group.label = cat;
        byCategory[cat].forEach((s) => {
          const opt = document.createElement('option');
          opt.value = s.id;
          opt.textContent = `${s.name} — ${s.price} €`;
          group.appendChild(opt);
        });
        els.serviceSelect.appendChild(group);
      });
    } catch (e) {
      showError(t('loadServicesError'));
    }
  }

  els.submit.addEventListener('click', async () => {
    clearError();
    const fromName = els.from.value.trim();
    const toName = els.to.value.trim();
    const buyerEmail = els.email.value.trim();

    if (!fromName || !toName || !buyerEmail) {
      showError(t('fillRequired'));
      return;
    }

    const body = {
      giftType,
      fromName,
      toName,
      message: els.message.value.trim(),
      buyerEmail,
      buyerPhone: els.phone.value.trim(),
      lang: LANG,
    };

    if (giftType === 'service') {
      if (!els.serviceSelect.value) {
        showError(t('chooseTreatmentError'));
        return;
      }
      body.serviceId = els.serviceSelect.value;
    } else {
      const amount = Number(els.amountInput.value);
      if (!amount || amount < 20) {
        showError(t('minAmountError'));
        return;
      }
      body.amount = amount;
    }

    els.submit.disabled = true;
    els.submit.textContent = t('connecting');

    try {
      const res = await fetch(`${BOOKING_API_BASE}/gift-checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('checkoutError'));
      window.location.href = data.url;
    } catch (e) {
      showError(e.message);
      els.submit.disabled = false;
      els.submit.textContent = t('submitLabel');
    }
  });

  // Mensaje si venimos de vuelta de Stripe
  const params = new URLSearchParams(window.location.search);
  if (params.get('estado') === 'ok') {
    els.shell.innerHTML = `
      <div class="booking-confirm">
        <h2>${t('confirmedTitle')}</h2>
        <p>${t('confirmedText')}</p>
        <a href="index.html" class="btn-primary">${t('backHome')}</a>
      </div>`;
  } else if (params.get('estado') === 'cancelado') {
    showError(t('cancelledPayment'));
    loadServices();
  } else {
    loadServices();
  }
})();
