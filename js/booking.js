// ============================================================
// OSANA — Lógica del flujo de reserva (reserva.html / en/reserva.html)
// ============================================================
(function () {
  const LANG = (typeof window !== 'undefined' && (window.BOOKING_LANG === 'en' || window.BOOKING_LANG === 'it')) ? window.BOOKING_LANG : 'es';
  const DATE_LOCALE = LANG === 'en' ? 'en-GB' : LANG === 'it' ? 'it-IT' : 'es-ES';

  const STR = {
    chooseToStart: { es: 'Elige un tratamiento para empezar.', en: 'Choose a treatment to get started.', it: 'Scegli un trattamento per iniziare.' },
    free: { es: 'Gratis', en: 'Free', it: 'Gratis' },
    from: { es: 'Desde', en: 'From', it: 'Da' },
    promoCategory: { es: 'Promociones', en: 'Promotions', it: 'Promozioni' },
    promoGroupFacial: { es: 'Facial', en: 'Facial', it: 'Viso' },
    promoGroupCorporal: { es: 'Corporal', en: 'Body', it: 'Corpo' },
    promoGroupLaser: { es: 'Láser', en: 'Laser', it: 'Laser' },
    noPromos: { es: 'No hay promociones activas de momento.', en: 'No active promotions right now.', it: 'Al momento non ci sono promozioni attive.' },
    chooseDuration: { es: 'Elige la duración', en: 'Choose the duration', it: 'Scegli la durata' },
    totalDuration: { es: 'Duración total', en: 'Total duration', it: 'Durata totale' },
    withEmployee: { es: 'Con', en: 'With', it: 'Con' },
    at: { es: 'a las', en: 'at', it: 'alle' },
    loadServicesError: { es: 'No se pudieron cargar los tratamientos. Comprueba tu conexión e inténtalo de nuevo.', en: 'Could not load treatments. Check your connection and try again.', it: 'Non è stato possibile caricare i trattamenti. Controlla la connessione e riprova.' },
    loading: { es: 'Cargando…', en: 'Loading…', it: 'Caricamento…' },
    loadEmployeesError: { es: 'No se pudieron cargar las profesionales.', en: 'Could not load the professionals.', it: 'Non è stato possibile caricare le professioniste.' },
    noEmployees: { es: 'No hay profesionales disponibles para este tratamiento. Escríbenos por WhatsApp.', en: 'No professionals available for this treatment. Message us on WhatsApp.', it: 'Nessuna professionista disponibile per questo trattamento. Scrivici su WhatsApp.' },
    laserPhonePrompt: { es: 'Antes de elegir hora, dinos tu teléfono — así sabemos si ya eres clienta.', en: 'Before picking a time, tell us your phone number — this way we know if you\'re already a client.', it: 'Prima di scegliere l\'orario, dicci il tuo numero di telefono — così sappiamo se sei già nostra cliente.' },
    laserPhonePlaceholder: { es: 'Tu teléfono', en: 'Your phone number', it: 'Il tuo telefono' },
    laserPhoneContinue: { es: 'Continuar', en: 'Continue', it: 'Continua' },
    laserPhoneRequired: { es: 'Escribe tu teléfono para continuar.', en: 'Enter your phone number to continue.', it: 'Inserisci il tuo numero di telefono per continuare.' },
    laserPhoneError: { es: 'No se pudo comprobar el teléfono — elige profesional como siempre.', en: 'Could not check the phone number — choose a professional as usual.', it: 'Non è stato possibile verificare il numero — scegli una professionista come al solito.' },
    searchingSlots: { es: 'Buscando huecos libres…', en: 'Looking for available times…', it: 'Ricerca degli orari disponibili…' },
    noSlots: { es: 'No quedan huecos libres ese día. Prueba con otra fecha.', en: 'No available times left that day. Try another date.', it: 'Non ci sono più orari disponibili quel giorno. Prova un\'altra data.' },
    availabilityError: { es: 'No se pudo consultar la disponibilidad.', en: 'Could not check availability.', it: 'Non è stato possibile verificare la disponibilità.' },
    fullRequired: { es: 'Este tratamiento requiere el pago completo online:', en: 'This treatment requires full payment online:', it: 'Questo trattamento richiede il pagamento completo online:' },
    depositRequired: { es: 'Este tratamiento requiere pagar la reserva ahora, un importe de', en: 'This treatment requires paying the booking fee now, an amount of', it: 'Questo trattamento richiede il pagamento di una caparra ora, per un importo di' },
    restAtCenter: { es: 'resto de', en: 'remaining', it: 'resto di' },
    atCenter: { es: 'en el centro', en: 'at the center', it: 'in centro' },
    payDepositOnly: { es: 'Pagar solo la reserva —', en: 'Pay booking fee only —', it: 'Paga solo la caparra —' },
    restAtCenterParen: { es: '(resto en el centro)', en: '(remaining amount paid at the center)', it: '(resto in centro)' },
    payFullNow: { es: 'Pagar el total ahora —', en: 'Pay in full now —', it: 'Paga tutto ora —' },
    cancelPolicyNote: { es: 'Si cancelas con menos de 48h de antelación, el importe pagado no será reembolsado.', en: "If you cancel less than 48h in advance, the amount paid will not be refunded.", it: 'Se cancelli con meno di 48h di anticipo, l\'importo pagato non sarà rimborsato.' },
    fillNamePhone: { es: 'Rellena tu nombre, teléfono y email para continuar.', en: 'Fill in your name, phone number and email to continue.', it: 'Inserisci nome, telefono ed email per continuare.' },
    missingBookingData: { es: 'Faltan datos de la reserva, vuelve a empezar.', en: 'Booking data is missing, please start again.', it: 'Mancano dati della prenotazione, ricomincia da capo.' },
    connectingPayment: { es: 'Conectando con el pago seguro…', en: 'Connecting to secure payment…', it: 'Connessione al pagamento sicuro…' },
    goToPayment: { es: 'Ir al pago seguro', en: 'Go to secure payment', it: 'Vai al pagamento sicuro' },
    checkoutError: { es: 'No se pudo iniciar el pago.', en: 'Could not start the payment.', it: 'Non è stato possibile avviare il pagamento.' },
    confirmedTitle: { es: '¡Reserva confirmada! ✓', en: 'Booking confirmed! ✓', it: 'Prenotazione confermata! ✓' },
    confirmedText: { es: 'Te hemos enviado la confirmación. Si tienes cualquier duda, escríbenos por WhatsApp.', en: "We've sent you the confirmation. If you have any questions, message us on WhatsApp.", it: 'Ti abbiamo inviato la conferma. Per qualsiasi dubbio, scrivici su WhatsApp.' },
    backHome: { es: 'Volver al inicio', en: 'Back to home', it: 'Torna alla home' },
    cancelledPayment: { es: 'Has cancelado el pago. Puedes intentarlo de nuevo cuando quieras.', en: 'You cancelled the payment. You can try again whenever you like.', it: 'Hai annullato il pagamento. Puoi riprovare quando vuoi.' },
    addTreatment: { es: '+ Añadir tratamiento…', en: '+ Add treatment…', it: '+ Aggiungi trattamento…' },
    removeAddon: { es: 'Quitar', en: 'Remove', it: 'Rimuovi' },
    cancel: { es: 'Cancelar', en: 'Cancel', it: 'Annulla' },
    bonoTitle: { es: 'Ahorra con nuestros bonos de sesiones', en: 'Save with our session packages', it: 'Risparmia con i nostri pacchetti di sedute' },
    bonoPerSession: { es: (n) => `= ${n} € / sesión`, en: (n) => `= €${n} / session`, it: (n) => `= ${n} € / seduta` },
    bonoSingleLabel: { es: 'Solo esta sesión', en: 'Just this session', it: 'Solo questa seduta' },
    bonoPackLabel: { es: (n) => `Bono ${n} sesiones`, en: (n) => `${n}-session package`, it: (n) => `Pacchetto ${n} sedute` },
    bonoSaveNote: { es: (n) => `Ahorras ${n} €`, en: (n) => `Save €${n}`, it: (n) => `Risparmi ${n} €` },
    bonoSessionNote: { es: (n) => `Reservas hoy la sesión 1 de ${n}. ${n - 1 === 1 ? 'La otra queda guardada' : `Las otras ${n - 1} quedan guardadas`} en "Mis reservas" para que la${n - 1 === 1 ? '' : 's'} agendes cuando quieras.`, en: (n) => `Today you book session 1 of ${n}. The other ${n - 1 === 1 ? 'one is' : `${n - 1} are`} saved in "My bookings" so you can schedule ${n - 1 === 1 ? 'it' : 'them'} whenever you like.`, it: (n) => `Oggi prenoti la seduta 1 di ${n}. ${n - 1 === 1 ? "L'altra resta salvata" : `Le altre ${n - 1} restano salvate`} in "Le mie prenotazioni" per fissarl${n - 1 === 1 ? 'a' : 'e'} quando vuoi.` },
    multiSessionTitle: { es: '¿Vas a necesitar varias sesiones? Cómpralas ya y agéndalas cuando quieras', en: 'Need several sessions? Buy them now and schedule them whenever you like', it: 'Ti servono più sedute? Comprale ora e fissale quando vuoi' },
    scheduleToday: { es: 'Reservar cita hoy', en: 'Book appointment now', it: 'Prenota ora' },
    scheduleFirstToday: { es: 'Reservar ya la 1ª sesión', en: 'Book the 1st session now', it: 'Prenota ora la 1ª seduta' },
    laterNote: { es: 'Lo compras ahora y todas las sesiones quedan guardadas en "Mis reservas" para que las agendes cuando quieras.', en: 'You buy it now and all sessions are saved in "My bookings" so you can schedule them whenever you like.', it: 'Lo compri ora e tutte le sedute restano salvate in "Le mie prenotazioni" per fissarle quando vuoi.' },
    laterSummary: { es: (names) => `Para agendar después (desde "Mis reservas"): ${names}`, en: (names) => `To schedule later (from "My bookings"): ${names}`, it: (names) => `Da fissare più avanti (da "Le mie prenotazioni"): ${names}` },
    noAppointmentNote: { es: 'Compra sin cita: lo agendas cuando quieras desde "Mis reservas".', en: 'Purchase without appointment: schedule it whenever you like from "My bookings".', it: 'Acquisto senza appuntamento: lo fissi quando vuoi da "Le mie prenotazioni".' },
    purchasedTitle: { es: '¡Compra confirmada! ✓', en: 'Purchase confirmed! ✓', it: 'Acquisto confermato! ✓' },
    purchasedText: { es: 'Te hemos enviado un email con el resumen. Tus sesiones ya están pagadas y guardadas: resérvalas cuando quieras desde "Mis reservas" con tu teléfono y tu email.', en: 'We have sent you an email with the summary. Your sessions are paid and saved: book them whenever you like from "My bookings" with your phone and email.', it: 'Ti abbiamo inviato un\'email con il riepilogo. Le tue sedute sono pagate e salvate: prenotale quando vuoi da "Le mie prenotazioni" con il tuo telefono e la tua email.' },
    goMyBookings: { es: 'Ir a Mis reservas', en: 'Go to My bookings', it: 'Vai a Le mie prenotazioni' },
    qtyLabel: { es: 'Nº de sesiones', en: 'Number of sessions', it: 'N. di sedute' },
    qtyLess: { es: 'Una sesión menos', en: 'One session less', it: 'Una seduta in meno' },
    qtyMore: { es: 'Una sesión más', en: 'One more session', it: 'Una seduta in più' },
    qtyNote: { es: 'Pulsa + para comprar varias sesiones a la vez: reservas hoy la 1ª y el resto las agendas cuando quieras desde "Mis reservas".', en: 'Tap + to buy several sessions at once: book the 1st today and schedule the rest whenever you like from "My bookings".', it: 'Premi + per comprare più sedute insieme: prenoti oggi la 1ª e le altre le fissi quando vuoi da "Le mie prenotazioni".' },
    qtyPackHint: { es: (n, price, save) => `Con el bono de ${n} sesiones (${price} €) ahorras ${save} €.`, en: (n, price, save) => `With the ${n}-session package (€${price}) you save €${save}.`, it: (n, price, save) => `Con il pacchetto da ${n} sedute (${price} €) risparmi ${save} €.` },
    multiSessionLabel: { es: (n) => `${n} sesiones`, en: (n) => `${n} sessions`, it: (n) => `${n} sedute` },
    bonoFullNote: { es: 'Si pagas el total ahora, puedes financiarlo con Klarna en hasta 3 cuotas sin intereses.', en: 'If you pay the full amount now, you can finance it with Klarna in up to 3 interest-free instalments.', it: 'Se paghi tutto ora, puoi finanziarlo con Klarna fino a 3 rate senza interessi.' },
    bonoTermsLabel: {
      es: 'He leído y acepto que, tras la primera ausencia sin preaviso o cancelación con menos de 48h se me avisará, y a partir de la segunda vez se descontará una sesión del bono.',
      en: 'I have read and accept that after the first no-show or cancellation with less than 48h notice I will be warned, and from the second time onward a session will be deducted from the package.',
      it: 'Ho letto e accetto che, dopo la prima assenza senza preavviso o cancellazione con meno di 48h di anticipo, verrò avvisata, e dalla seconda volta in poi verrà scalata una seduta dal pacchetto.',
    },
    bonoTermsRequired: { es: 'Tienes que aceptar las condiciones del bono para continuar.', en: 'You need to accept the package terms to continue.', it: 'Devi accettare le condizioni del pacchetto per continuare.' },
    discountPlaceholder: { es: 'Código de descuento', en: 'Discount code', it: 'Codice sconto' },
    discountApplyBtn: { es: 'Aplicar', en: 'Apply', it: 'Applica' },
    discountChooseTreatmentFirst: { es: 'Elige primero un tratamiento.', en: 'Choose a treatment first.', it: 'Scegli prima un trattamento.' },
    discountNotForBono: { es: 'Los códigos de descuento no se pueden usar con bonos de sesiones.', en: 'Discount codes cannot be used with session packages.', it: 'I codici sconto non si possono usare con i pacchetti di sedute.' },
    discountApplied: { es: (n) => `Código aplicado: -${n.toFixed(2)} €`, en: (n) => `Code applied: -€${n.toFixed(2)}`, it: (n) => `Codice applicato: -${n.toFixed(2)} €` },
    discountLine: { es: 'Descuento', en: 'Discount', it: 'Sconto' },
    discountStale: { es: 'El código ya no aplica a tu selección actual — vuelve a introducirlo si quieres aplicarlo.', en: 'The code no longer applies to your current selection — enter it again if you want to apply it.', it: 'Il codice non è più valido per la tua selezione attuale — reinseriscilo se vuoi applicarlo.' },
    loyaltyTitle: { es: 'Saldo acumulado', en: 'Loyalty balance', it: 'Saldo accumulato' },
    loyaltyBalanceText: { es: (n) => `Tienes ${n.toFixed(2)} € acumulados`, en: (n) => `You have €${n.toFixed(2)} saved up`, it: (n) => `Hai ${n.toFixed(2)} € accumulati` },
    loyaltyBelowMinText: { es: (n) => `Tienes ${n.toFixed(2)} € acumulados — a partir de 10 € puedes canjearlos.`, en: (n) => `You have €${n.toFixed(2)} saved up — redeemable from €10.`, it: (n) => `Hai ${n.toFixed(2)} € accumulati — canjeabili a partire da 10 €.` },
    loyaltyRedeemLabel: { es: '¿Cuánto quieres canjear?', en: 'How much would you like to redeem?', it: 'Quanto vuoi utilizzare?' },
    loyaltyRedeemBtn: { es: 'Canjear', en: 'Redeem', it: 'Utilizza' },
    loyaltyRedeemApplied: { es: (n) => `Saldo canjeado: -${n.toFixed(2)} €`, en: (n) => `Balance redeemed: -€${n.toFixed(2)}`, it: (n) => `Saldo utilizzato: -${n.toFixed(2)} €` },
    loyaltyRedeemRemove: { es: 'Quitar', en: 'Remove', it: 'Rimuovi' },
    loyaltyRedeemMin: { es: 'El canje mínimo es de 10 €.', en: 'The minimum redemption is €10.', it: "L'importo minimo da utilizzare è 10 €." },
    loyaltyRedeemEnterAmount: { es: 'Indica cuánto quieres canjear.', en: 'Enter how much you want to redeem.', it: 'Indica quanto vuoi utilizzare.' },
    loyaltyRedeemMax: { es: (n) => `Como máximo puedes canjear ${n.toFixed(2)} €.`, en: (n) => `You can redeem up to €${n.toFixed(2)}.`, it: (n) => `Puoi utilizzare al massimo ${n.toFixed(2)} €.` },
    loyaltyRedeemBlockedByDiscount: { es: 'No puedes canjear saldo y usar un código de descuento a la vez. Quita el código si quieres canjear saldo.', en: "You can't redeem balance and use a discount code at the same time. Remove the code if you want to redeem balance.", it: 'Non puoi utilizzare il saldo e un codice sconto insieme. Rimuovi il codice se vuoi usare il saldo.' },
    loyaltyDiscountBlockedByRedeem: { es: 'Ya has canjeado saldo de fidelidad — quítalo si quieres usar un código de descuento.', en: "You've already redeemed loyalty balance — remove it if you want to use a discount code.", it: 'Hai già utilizzato il saldo fedeltà — rimuovilo se vuoi usare un codice sconto.' },
    loyaltyBlockedByPromo: { es: 'El saldo de fidelidad no se puede canjear en promociones.', en: "Loyalty balance can't be redeemed on promotions.", it: 'Il saldo fedeltà non è utilizzabile sulle promozioni.' },
    loyaltyDecemberReminder: { es: '✦ Tus puntos caducan el 31 de diciembre — ¡canjéalos antes de que termine el mes! Este mes no hay importe mínimo.', en: '✦ Your points expire on December 31st — redeem them before the month ends! No minimum amount this month.', it: '✦ I tuoi punti scadono il 31 dicembre — utilizzali prima della fine del mese! Questo mese non c\'è un importo minimo.' },
    loyaltyRedeemLine: { es: 'Saldo de fidelidad canjeado', en: 'Loyalty balance redeemed', it: 'Saldo fedeltà utilizzato' },
    termsLabel: {
      es: 'He leído y acepto las <a href="condiciones.html" target="_blank" rel="noopener">condiciones de reserva, cancelación y el programa de fidelidad</a>.',
      en: 'I have read and accept the <a href="condiciones.html" target="_blank" rel="noopener">booking, cancellation and loyalty programme terms</a>.',
      it: 'Ho letto e accetto le <a href="condiciones.html" target="_blank" rel="noopener">condizioni di prenotazione, cancellazione e il programma fedeltà</a>.',
    },
    rememberMe: { es: 'Recordar mis datos en este dispositivo para la próxima vez', en: 'Remember my details on this device for next time', it: 'Ricorda i miei dati su questo dispositivo per la prossima volta' },
    rememberedNote: { es: 'Hemos rellenado los datos guardados en este dispositivo.', en: 'We filled in the details saved on this device.', it: 'Abbiamo inserito i dati salvati su questo dispositivo.' },
    forgetMe: { es: 'Borrar mis datos de este dispositivo', en: 'Delete my details from this device', it: 'Cancella i miei dati da questo dispositivo' },
    termsRequired: { es: 'Tienes que aceptar las condiciones de reserva para continuar.', en: 'You need to accept the booking terms to continue.', it: 'Devi accettare le condizioni di prenotazione per continuare.' },
  };
  function t(key) { return (STR[key] && STR[key][LANG]) || (STR[key] && STR[key].es) || key; }

  const state = {
    service: null,
    extras: [],
    extraServices: [], // otros tratamientos añadidos a la misma cita (sesión suelta)
    extraBonos: [], // otros bonos añadidos a la misma cita (misma cita, distinto bono cada uno)
    employee: null,
    date: null,
    time: null,
    payChoice: 'deposit', // 'deposit' | 'full'
    wantsBono: false, // true si eligió el bono de varias sesiones en vez de una suelta
    bono: null, // { serviceId, serviceName, sessions, bonoPrice, singleSessionPrice }
    discountCode: null, // código ya validado por el servidor
    discountAmount: 0, // importe que se resta, calculado por el servidor
    discountMode: 'loose', // 'loose' | 'bono' — con qué modo se validó, para saber cómo comprobar que sigue aplicando
    discountValidatedIds: [], // ids de tratamientos con los que se validó (modo suelto) — si la selección cambia, el descuento deja de aplicar
    discountValidatedBonoSig: '', // firma de los bonos con los que se validó (modo bono) — mismo criterio que discountValidatedIds
    phone: '', // se rellena antes de tiempo solo si hace falta comprobar si es clienta nueva (ver hasLaserSelected)
    loyaltyChecked: '', // "telefono|email" con el que ya se comprobó el saldo, para no repetir la llamada
    loyaltyEligible: false,
    loyaltyBalance: 0,
    redeemAmount: 0, // importe de saldo de fidelidad ya aplicado (confirmado con "Canjear")
    durationGroup: null, // si el servicio elegido es de un grupo con varias duraciones (p.ej. masajes), el array de opciones del grupo
    laterIds: new Set(), // tratamientos del carrito que se compran ahora pero se agendan después (desde Mis reservas)
  };

  // "extras" son modificadores de zona/tiempo del tratamiento principal
  // (solo aplican cuando el principal NO es bono). "extraServices" y
  // "extraBonos" son otros tratamientos añadidos a la misma cita — sesión
  // suelta o bono, cualquier combinación, indistintamente del principal.
  function extrasDuration() { return state.extras.reduce((sum, e) => sum + e.durationMinutes, 0); }
  function extrasPrice() { return state.extras.reduce((sum, e) => sum + e.price, 0); }
  function addonsDuration() { return state.extraServices.reduce((sum, s) => sum + s.durationMinutes, 0); }
  function addonsPrice() { return state.extraServices.reduce((sum, s) => sum + s.price, 0); }
  function extraBonosDuration() { return state.extraBonos.reduce((sum, b) => sum + ((findServiceById(b.serviceId) || {}).durationMinutes || 0), 0); }
  function extraBonosPrice() { return state.extraBonos.reduce((sum, b) => sum + b.bonoPrice, 0); }
  // Igual que en el servidor (ver COMBO_ARRIVAL_BUFFER_MINUTES en
  // pricing.js): con 2+ tratamientos reales en la misma visita, el margen
  // de llegada solo hace falta una vez — se resta del total aquí también
  // para que la vista previa coincida con lo que de verdad se reserva.
  const COMBO_ARRIVAL_BUFFER_MINUTES = 15;
  // ── Líneas del carrito ──
  // Cada tratamiento del carrito: cuántas sesiones se compran y si su 1ª
  // sesión se reserva en la cita de hoy o se compra "para agendar después"
  // (queda entero en Mis reservas). Solo los tratamientos que se agendan hoy
  // cuentan para la duración, la profesional y los huecos libres.
  function canBuyForLater(svc, sessions) {
    return !!svc && (sessions > 1 || isMultiSessionEligible(svc));
  }
  function cartLines() {
    if (!state.service) return [];
    const lines = [{
      svc: state.service, primary: true,
      sessions: state.wantsBono && state.bono ? state.bono.sessions : 1,
      bono: state.wantsBono ? state.bono : null,
    }];
    state.extraServices.forEach((sv) => lines.push({ svc: sv, sessions: 1, bono: null }));
    state.extraBonos.forEach((b) => {
      const sv = findServiceById(b.serviceId);
      if (sv) lines.push({ svc: sv, sessions: b.sessions, bono: b });
    });
    lines.forEach((l) => { l.later = state.laterIds.has(l.svc.id) && canBuyForLater(l.svc, l.sessions); });
    return lines;
  }
  function scheduledLines() { return cartLines().filter((l) => !l.later); }
  function hasAppointment() { return !state.service || scheduledLines().length > 0; }
  function primaryScheduledSingle() {
    const l = cartLines()[0];
    return !!l && !l.later && l.sessions === 1;
  }
  function totalDuration() {
    const lines = scheduledLines();
    if (!lines.length) return 0;
    const durations = lines.map((l) => l.svc.durationMinutes || 0);
    const modifiers = primaryScheduledSingle() ? extrasDuration() : 0;
    const naive = durations.reduce((a, b) => a + b, 0) + modifiers;
    if (lines.length < 2) return naive;
    return Math.max(Math.max(...durations), naive - COMBO_ARRIVAL_BUFFER_MINUTES);
  }
  // "Modo bono" (pago por bono-checkout): hay varias sesiones de algo, o
  // algo comprado para agendar después.
  function hasAnyBono() { return cartLines().some((l) => l.sessions > 1 || l.later); }
  // Un código de descuento puede estar restringido a sesiones sueltas, a
  // bonos, o a ambos (lo decide quien lo crea en el panel) — cuál de los dos
  // "modos" comprobar depende de si el carrito actual tiene algún bono.
  function discountEligibleServiceIds() {
    // Modo sueltas: solo tiene sentido si NO hay ningún bono en el carrito
    // (con un bono de por medio, el pago pasa por bono-checkout entero).
    if (hasAnyBono()) return [];
    const ids = [];
    if (state.service) ids.push(state.service.id);
    state.extraServices.forEach((s) => ids.push(s.id));
    return ids;
  }
  // Modo bono: todos los bonos del carrito (el principal, si lo es, + los
  // añadidos), cada uno identificado por tratamiento + nº de sesiones —
  // el descuento se calcula sobre el precio del PAQUETE, no de una sesión.
  function currentBonoSelections() {
    return cartLines().filter((l) => l.sessions > 1 || l.later).map((l) => ({ serviceId: l.svc.id, sessions: l.sessions }));
  }
  function bonoSelectionsSignature(sels) {
    return sels.map((s) => `${s.serviceId}:${s.sessions}`).sort().join(',');
  }
  // El descuento se validó contra una selección concreta (de tratamientos
  // sueltos, o de bonos) — si la selección cambia después (se añade/quita
  // algo), deja de aplicar hasta que se vuelva a comprobar el código.
  function discountIsStillValid() {
    if (!state.discountCode) return false;
    if (state.discountMode === 'bono') {
      const current = bonoSelectionsSignature(currentBonoSelections());
      return current !== '' && current === state.discountValidatedBonoSig;
    }
    const current = discountEligibleServiceIds().slice().sort().join(',');
    const validated = state.discountValidatedIds.slice().sort().join(',');
    return current !== '' && current === validated;
  }
  function discountAmount() { return discountIsStillValid() ? state.discountAmount : 0; }
  // Precio antes de descuento/canje — lo usan discountAmount/redeemAmount
  // (para no poder canjear/descontar más de lo que de verdad cuesta) y
  // totalPrice (que sí resta ambos).
  function rawPrice() {
    const primary = state.wantsBono && state.bono ? state.bono.bonoPrice : (state.service ? state.service.price : 0);
    const modifiers = primaryScheduledSingle() ? extrasPrice() : 0;
    return primary + modifiers + addonsPrice() + extraBonosPrice();
  }
  // El saldo de fidelidad no se puede canjear en promociones (ofertas
  // puntuales ya rebajadas, ver categoría "Promociones") — solo en
  // tratamientos y packs a precio normal.
  function hasAnyPromo() {
    const promoLabel = t('promoCategory');
    if (state.service && state.service.category === promoLabel) return true;
    return state.extraServices.some((s) => s.category === promoLabel);
  }
  // El canje de saldo de fidelidad solo está disponible para sesiones
  // sueltas (no para compras de bono, que van por bono-checkout — ver
  // handleSubmit), nunca a la vez que un código de descuento, y nunca en
  // promociones. Se limita también a lo que cuesta la reserva, por si el
  // carrito cambia después de haber canjeado un importe mayor.
  function redeemAmount() {
    if (hasAnyBono() || discountAmount() > 0 || hasAnyPromo()) return 0;
    return Math.min(state.redeemAmount || 0, rawPrice());
  }
  function totalPrice() {
    return rawPrice() - discountAmount() - redeemAmount();
  }
  function scheduledServiceIds() { return scheduledLines().map((l) => l.svc.id); }
  function selectedServiceIds() {
    return [state.service.id, ...state.extraServices.map((s) => s.id), ...state.extraBonos.map((b) => b.serviceId)];
  }
  function findServiceById(id) {
    for (const cat in servicesByCategory) {
      const found = servicesByCategory[cat].find((s) => s.id === id);
      if (found) return found;
    }
    return null;
  }

  const els = {
    shell: document.getElementById('booking-shell'),
    steps: document.querySelectorAll('.booking-progress-step'),
    panels: document.querySelectorAll('.booking-step-panel'),
    catPills: document.getElementById('booking-cat-pills'),
    services: document.getElementById('booking-services'),
    bonoSection: document.getElementById('booking-bono-section'),
    durationSection: document.getElementById('booking-duration-section'),
    addonsSection: document.getElementById('booking-addons-section'),
    addonsChips: document.getElementById('booking-addons-chips'),
    addonsSelect: document.getElementById('booking-addons-select'),
    addonsModeChooser: document.getElementById('booking-addons-mode-chooser'),
    extrasSection: document.getElementById('booking-extras-section'),
    extras: document.getElementById('booking-extras'),
    step1Actions: document.getElementById('booking-step1-actions'),
    continueStep1: document.getElementById('booking-continue-step1'),
    employees: document.getElementById('booking-employees'),
    calMonthLabel: document.getElementById('cal-month-label'),
    calGrid: document.getElementById('booking-calendar-grid'),
    calPrev: document.getElementById('cal-prev'),
    calNext: document.getElementById('cal-next'),
    slots: document.getElementById('booking-slots'),
    summary: document.getElementById('booking-summary'),
    payOptions: document.getElementById('booking-pay-options'),
    submit: document.getElementById('booking-submit'),
    error: document.getElementById('booking-error'),
    discountCodeInput: document.getElementById('booking-discount-code'),
    discountApplyBtn: document.getElementById('booking-discount-apply'),
    discountMsg: document.getElementById('booking-discount-msg'),
    loyaltyBox: document.getElementById('booking-loyalty-box'),
    clientPhone: document.getElementById('booking-phone'),
    clientEmail: document.getElementById('booking-email'),
  };

  function showError(msg) {
    els.error.textContent = msg;
    els.error.style.display = 'block';
    els.error.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function clearError() {
    els.error.style.display = 'none';
  }

  function goToStep(n) {
    els.shell.dataset.activeStep = String(n);
    els.panels.forEach((p) => p.classList.toggle('active', p.dataset.stepPanel === String(n)));
    els.steps.forEach((s) => {
      const stepNum = Number(s.dataset.step);
      s.classList.toggle('active', stepNum === n);
      s.classList.toggle('done', stepNum < n);
    });
    window.scrollTo({ top: document.getElementById('booking-steps').offsetTop - 90, behavior: 'smooth' });
  }

  document.querySelectorAll('.booking-back').forEach((btn) => {
    btn.addEventListener('click', () => goToStep(Number(btn.dataset.back) === 3 && !hasAppointment() ? 1 : Number(btn.dataset.back)));
  });

  // ── Resumen persistente (panel lateral) ──
  function renderSummary() {
    const { service, extras, extraServices, extraBonos, employee, date, time } = state;
    if (!service) {
      els.summary.innerHTML = `<p class="booking-summary-empty">${t('chooseToStart')}</p>`;
      return;
    }
    let html;
    if (state.wantsBono && state.bono) {
      html = `<div class="booking-summary-row"><strong>${state.bono.custom ? t('multiSessionLabel')(state.bono.sessions) : t('bonoPackLabel')(state.bono.sessions)} — ${service.name}</strong><span>${state.bono.bonoPrice.toFixed(0)} €</span></div><div class="booking-summary-qty" data-qty-main></div><div class="booking-summary-later" data-later="${service.id}"></div>`;
    } else {
      html = `<div class="booking-summary-row"><strong>${service.name}</strong><span>${service.price > 0 ? service.price.toFixed(0) + ' €' : t('free')}</span></div><div class="booking-summary-qty" data-qty-main></div><div class="booking-summary-later" data-later="${service.id}"></div>`;
      if (primaryScheduledSingle()) extras.forEach((ex) => {
        html += `<div class="booking-summary-row" style="margin-top:6px;"><span>+ ${ex.name}</span><span>${ex.price > 0 ? ex.price.toFixed(0) + ' €' : t('free')}</span></div>`;
      });
    }
    extraServices.forEach((s) => {
      html += `<div class="booking-summary-row" style="margin-top:6px;"><span>+ ${s.name}</span><span>${s.price > 0 ? s.price.toFixed(0) + ' €' : t('free')}</span></div><div class="booking-summary-qty" data-qty-addon="${s.id}"></div><div class="booking-summary-later" data-later="${s.id}"></div>`;
    });
    extraBonos.forEach((b) => {
      html += `<div class="booking-summary-row" style="margin-top:6px;"><span>+ ${b.custom ? t('multiSessionLabel')(b.sessions) : t('bonoPackLabel')(b.sessions)} — ${b.serviceName}</span><span>${b.bonoPrice.toFixed(0)} €</span></div><div class="booking-summary-qty" data-qty-addon="${b.serviceId}"></div><div class="booking-summary-later" data-later="${b.serviceId}"></div>`;
    });
    if (discountIsStillValid()) {
      html += `<div class="booking-summary-row" style="margin-top:6px;"><span>${t('discountLine')} (${state.discountCode})</span><span>-${state.discountAmount.toFixed(0)} €</span></div>`;
    }
    if (redeemAmount() > 0) {
      html += `<div class="booking-summary-row" style="margin-top:6px;"><span>${t('loyaltyRedeemLine')}</span><span>-${redeemAmount().toFixed(0)} €</span></div>`;
    }
    const laterLines = cartLines().filter((l) => l.later);
    if (hasAppointment()) {
      html += `<div class="booking-summary-meta">${t('totalDuration')}: ${totalDuration()} min · <strong>${totalPrice().toFixed(0)} €</strong>${state.wantsBono && !laterLines.some((l) => l.primary) ? ` · ${t('bonoSessionNote')(state.bono.sessions)}` : ''}</div>`;
    } else {
      html += `<div class="booking-summary-meta"><strong>${totalPrice().toFixed(0)} €</strong> · ${t('noAppointmentNote')}</div>`;
    }
    if (laterLines.length && hasAppointment()) {
      html += `<div class="booking-summary-meta">${t('laterSummary')(laterLines.map((l) => l.svc.name).join(', '))}</div>`;
    }
    if (employee && hasAppointment()) {
      html += `<div class="booking-summary-line">${t('withEmployee')} <strong>${employee.name}</strong></div>`;
    }
    if (date && time && hasAppointment()) {
      const dateLabel = new Date(`${date}T12:00:00`).toLocaleDateString(DATE_LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });
      html += `<div class="booking-summary-line">${dateLabel} ${t('at')} ${time}</div>`;
    }
    els.summary.innerHTML = html;
    // Selector − / + también aquí, en "Tu reserva" (siempre a la vista en
    // ordenador): en Promociones la lista es larga y el recuadro de sesiones
    // de debajo quedaba fuera de la pantalla. Solo se ve en el paso 1 (CSS).
    const mainSlot = els.summary.querySelector('[data-qty-main]');
    if (mainSlot) {
      const qtys = sessionQuantitiesFor(service);
      if (qtys.length > 1) {
        const qty = state.wantsBono && state.bono ? state.bono.sessions : 1;
        mainSlot.innerHTML = `<span class="booking-summary-qty-label">${t('qtyLabel')}</span>`;
        mainSlot.appendChild(buildQtyStepper(qtys, qty, setMainQty));
      } else {
        mainSlot.remove();
      }
    }
    els.summary.querySelectorAll('[data-later]').forEach((slot) => {
      const toggle = buildLaterToggle(slot.dataset.later);
      if (toggle) slot.appendChild(toggle); else slot.remove();
    });
    els.summary.querySelectorAll('[data-qty-addon]').forEach((slot) => {
      const svc = findServiceById(slot.dataset.qtyAddon);
      const qtys = sessionQuantitiesFor(svc);
      if (!svc || qtys.length < 2) { slot.remove(); return; }
      const bono = state.extraBonos.find((b) => b.serviceId === svc.id);
      slot.innerHTML = `<span class="booking-summary-qty-label">${t('qtyLabel')}</span>`;
      slot.appendChild(buildQtyStepper(qtys, bono ? bono.sessions : 1, (n) => setAddonQty(svc, n)));
    });

    // Si había un código aplicado y la selección ha cambiado desde entonces,
    // avisamos de que hay que volver a comprobarlo (en vez de aplicarlo mal).
    if (state.discountCode && !discountIsStillValid()) {
      state.discountCode = null;
      state.discountAmount = 0;
      state.discountValidatedIds = [];
      state.discountValidatedBonoSig = '';
      els.discountMsg.textContent = t('discountStale');
      els.discountMsg.className = 'booking-discount-msg error';
      els.discountMsg.style.display = 'block';
    }
    // Si el carrito cambió y lo canjeado ya no cabe en el nuevo precio, o pasó
    // a incluir una promoción, se recorta/oculta — redeemAmount() ya lo hace
    // al calcular, aquí solo refrescamos la caja para que se vea igual.
    renderLoyaltyBox();
  }

  // ── Saldo de fidelidad (se comprueba en cuanto hay teléfono + email de
  // una clienta que ya tiene alguna reserva — ver /api/loyalty-balance) ──
  // El saldo del año caduca el 31 de diciembre — durante todo diciembre se
  // deja canjear cualquier importe, sin el mínimo habitual de 10 €, para
  // que no se quede nadie con saldo sin usar antes de que desaparezca.
  const IS_DECEMBER = new Date().getMonth() === 11;
  const MIN_REDEEM = IS_DECEMBER ? 0 : 10;
  async function checkLoyaltyBalance() {
    const phone = els.clientPhone.value.trim();
    const email = els.clientEmail.value.trim();
    if (!phone || !email) return;
    const key = `${phone}|${email}`;
    if (state.loyaltyChecked === key) return;
    state.loyaltyChecked = key;
    try {
      const res = await fetch(`${BOOKING_API_BASE}/loyalty-balance?phone=${encodeURIComponent(phone)}&email=${encodeURIComponent(email)}`);
      const data = await res.json();
      state.loyaltyEligible = !!data.eligible;
      state.loyaltyBalance = data.balance || 0;
    } catch (e) {
      state.loyaltyEligible = false;
      state.loyaltyBalance = 0;
    }
    renderLoyaltyBox();
  }

  function renderLoyaltyBox() {
    const box = els.loyaltyBox;
    if (!box) return;

    // Ya canjeado: se muestra siempre lo aplicado — solo se puede quitar,
    // no cambiar el importe (para eso se quita y se vuelve a canjear).
    if (state.redeemAmount > 0) {
      box.style.display = 'block';
      box.innerHTML = `
        <div class="booking-loyalty-label">${t('loyaltyTitle')}</div>
        <div class="booking-loyalty-applied">
          <strong>${t('loyaltyRedeemApplied')(redeemAmount())}</strong>
          <button type="button" class="booking-loyalty-remove-btn">${t('loyaltyRedeemRemove')}</button>
        </div>
      `;
      box.querySelector('.booking-loyalty-remove-btn').addEventListener('click', () => {
        state.redeemAmount = 0;
        renderLoyaltyBox();
        renderSummary();
        renderPayOptions();
      });
      return;
    }

    if (!state.loyaltyEligible || state.loyaltyBalance <= 0) {
      box.style.display = 'none';
      box.innerHTML = '';
      return;
    }

    const blockedByPromo = hasAnyPromo();
    const blockedByDiscount = discountIsStillValid();
    box.style.display = 'block';
    if (blockedByPromo || blockedByDiscount) {
      box.innerHTML = `
        <div class="booking-loyalty-label">${t('loyaltyTitle')}</div>
        <div class="booking-loyalty-balance">${t('loyaltyBalanceText')(state.loyaltyBalance)}</div>
        <p class="booking-loyalty-msg error">${blockedByPromo ? t('loyaltyBlockedByPromo') : t('loyaltyRedeemBlockedByDiscount')}</p>
      `;
      return;
    }

    const canRedeem = state.loyaltyBalance >= MIN_REDEEM;
    box.innerHTML = `
      <div class="booking-loyalty-label">${t('loyaltyTitle')}</div>
      <div class="booking-loyalty-balance">${canRedeem ? t('loyaltyBalanceText')(state.loyaltyBalance) : t('loyaltyBelowMinText')(state.loyaltyBalance)}</div>
      ${IS_DECEMBER ? `<p class="booking-loyalty-msg booking-loyalty-december">${t('loyaltyDecemberReminder')}</p>` : ''}
      ${canRedeem ? `
        <div class="booking-loyalty-redeem-row">
          <input type="number" min="${MIN_REDEEM}" step="1" inputmode="numeric" placeholder="${t('loyaltyRedeemLabel')}">
          <button type="button" class="booking-loyalty-redeem-btn">${t('loyaltyRedeemBtn')}</button>
        </div>
        <p class="booking-loyalty-msg" style="display:none;"></p>
      ` : ''}
    `;
    if (canRedeem) {
      const input = box.querySelector('.booking-loyalty-redeem-row input');
      const msg = box.querySelector('.booking-loyalty-msg:not(.booking-loyalty-december)');
      box.querySelector('.booking-loyalty-redeem-btn').addEventListener('click', () => {
        const amount = Math.round(Number(input.value) || 0);
        msg.style.display = 'none';
        if (amount <= 0) {
          msg.textContent = t('loyaltyRedeemEnterAmount');
          msg.className = 'booking-loyalty-msg error';
          msg.style.display = 'block';
          return;
        }
        if (amount < MIN_REDEEM) {
          msg.textContent = t('loyaltyRedeemMin');
          msg.className = 'booking-loyalty-msg error';
          msg.style.display = 'block';
          return;
        }
        const max = Math.floor(Math.min(state.loyaltyBalance, rawPrice()));
        if (amount > max) {
          msg.textContent = t('loyaltyRedeemMax')(max);
          msg.className = 'booking-loyalty-msg error';
          msg.style.display = 'block';
          return;
        }
        state.redeemAmount = amount;
        renderLoyaltyBox();
        renderSummary();
        renderPayOptions();
      });
    }
  }

  els.clientPhone.addEventListener('blur', checkLoyaltyBalance);
  els.clientEmail.addEventListener('blur', checkLoyaltyBalance);

  els.discountApplyBtn.addEventListener('click', async () => {
    const code = els.discountCodeInput.value.trim();
    els.discountMsg.style.display = 'none';
    if (state.redeemAmount > 0) {
      els.discountMsg.textContent = t('loyaltyDiscountBlockedByRedeem');
      els.discountMsg.className = 'booking-discount-msg error';
      els.discountMsg.style.display = 'block';
      return;
    }
    if (!code) return;
    const bonoMode = hasAnyBono();
    const bonoSels = bonoMode ? currentBonoSelections() : [];
    const looseIds = bonoMode ? [] : discountEligibleServiceIds();
    if ((bonoMode && !bonoSels.length) || (!bonoMode && !looseIds.length)) {
      els.discountMsg.textContent = t('discountChooseTreatmentFirst');
      els.discountMsg.className = 'booking-discount-msg error';
      els.discountMsg.style.display = 'block';
      return;
    }
    els.discountApplyBtn.disabled = true;
    try {
      const res = await fetch(`${BOOKING_API_BASE}/discount-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bonoMode ? { code, mode: 'bono', bonoSelections: bonoSels } : { code, serviceIds: looseIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('checkoutError'));
      state.discountCode = code.toUpperCase();
      state.discountAmount = data.amountOff;
      state.discountMode = bonoMode ? 'bono' : 'loose';
      state.discountValidatedIds = bonoMode ? [] : looseIds;
      state.discountValidatedBonoSig = bonoMode ? bonoSelectionsSignature(bonoSels) : '';
      els.discountMsg.textContent = t('discountApplied')(data.amountOff);
      els.discountMsg.className = 'booking-discount-msg success';
      els.discountMsg.style.display = 'block';
    } catch (e) {
      state.discountCode = null;
      state.discountAmount = 0;
      state.discountValidatedIds = [];
      state.discountValidatedBonoSig = '';
      els.discountMsg.textContent = e.message;
      els.discountMsg.className = 'booking-discount-msg error';
      els.discountMsg.style.display = 'block';
    }
    els.discountApplyBtn.disabled = false;
    renderSummary();
    renderPayOptions();
  });

  // ── PASO 1: cargar servicios ──
  let servicesByCategory = {};
  let activeCategory = null;

  async function loadServices() {
    try {
      const res = await fetch(`${BOOKING_API_BASE}/services?lang=${LANG}`);
      const data = await res.json();
      servicesByCategory = {};
      data.services.forEach((s) => {
        servicesByCategory[s.category] = servicesByCategory[s.category] || [];
        servicesByCategory[s.category].push(s);
      });
      // "Promociones" se muestra siempre la última, aunque en ese momento no
      // haya ninguna promoción activa (ver renderServiceGrid) — así siempre
      // está en el mismo sitio y es fácil de encontrar.
      const promoLabel = t('promoCategory');
      if (!servicesByCategory[promoLabel]) servicesByCategory[promoLabel] = [];
      const categories = [...Object.keys(servicesByCategory).filter((c) => c !== promoLabel), promoLabel];
      activeCategory = categories[0];
      renderCatPills(categories);
      renderServiceGrid();
    } catch (e) {
      showError(t('loadServicesError'));
    }
  }

  function renderCatPills(categories) {
    els.catPills.innerHTML = '';
    categories.forEach((cat) => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'booking-pill' + (cat === activeCategory ? ' active' : '');
      pill.textContent = cat;
      pill.addEventListener('click', () => {
        activeCategory = cat;
        els.catPills.querySelectorAll('.booking-pill').forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        renderServiceGrid();
      });
      els.catPills.appendChild(pill);
    });
  }

  function renderServiceCards(items) {
    // Agrupa servicios que comparten nombre base (p. ej. "Masaje relajante · 30 min",
    // "· 60 min", "· 90 min") para que el cliente elija primero el tipo, sin ver el
    // precio, y luego la duración en una fila compacta de opciones.
    const groups = [];
    const groupIndexByBase = {};
    items.forEach((s) => {
      const base = s.name.replace(/\s*·\s*\d+\s*min\s*$/i, '').trim();
      if (groupIndexByBase[base] === undefined) {
        groupIndexByBase[base] = groups.length;
        groups.push({ base, items: [] });
      }
      groups[groupIndexByBase[base]].items.push(s);
    });

    groups.forEach((g) => {
      if (g.items.length === 1) {
        const s = g.items[0];
        const card = document.createElement('div');
        card.className = 'booking-service-card' + (s.pack ? ' pack' : '') + (state.service && state.service.id === s.id ? ' selected' : '');
        card.innerHTML = `
          <strong>${s.name}</strong>
          ${s.promoBadge ? `<span class="booking-promo-badge">${s.promoBadge}</span>` : ''}
          <span class="booking-service-meta">${s.durationMinutes} min</span>
          ${s.description ? `<span class="booking-service-desc">${s.description}</span>` : ''}
          <span class="booking-service-price">${s.originalPrice ? `<span class="booking-service-price-was">${s.originalPrice.toFixed(0)} €</span> ` : ''}${s.price > 0 ? s.price.toFixed(0) + ' €' : t('free')}</span>
        `;
        card.addEventListener('click', () => selectService(s, card));
        els.services.appendChild(card);
        return;
      }

      // Varias duraciones para el mismo tratamiento (p.ej. masajes): la tarjeta
      // solo elige el TIPO — al seleccionarla aparece, debajo de toda la rejilla,
      // un bloque para elegir la duración (mismo patrón visual que el bono de
      // sesiones de depilación láser), en vez de botones diminutos dentro de la
      // propia tarjeta.
      const sorted = g.items.slice().sort((a, b) => a.durationMinutes - b.durationMinutes);
      const selectedItem = state.service && sorted.find((s) => s.id === state.service.id);
      const card = document.createElement('div');
      card.className = 'booking-service-card' + (selectedItem ? ' selected' : '');
      card.innerHTML = selectedItem ? `
        <strong>${g.base}</strong>
        <span class="booking-service-meta">${selectedItem.durationMinutes} min</span>
        <span class="booking-service-price">${selectedItem.price > 0 ? selectedItem.price.toFixed(0) + ' €' : t('free')}</span>
      ` : `
        <strong>${g.base}</strong>
        <span class="booking-service-price booking-service-price-from">${t('from')} ${sorted[0].price > 0 ? sorted[0].price.toFixed(0) + ' €' : t('free')}</span>
      `;
      card.addEventListener('click', () => {
        if (selectedItem) return; // ya elegida — la duración se cambia desde el bloque de abajo
        selectService(sorted[0], card, sorted);
      });
      els.services.appendChild(card);
    });
  }

  function renderServiceGrid() {
    const items = servicesByCategory[activeCategory] || [];
    els.services.innerHTML = '';

    if (activeCategory === t('promoCategory') && items.length === 0) {
      els.services.innerHTML = `<p class="booking-loading">${t('noPromos')}</p>`;
      return;
    }

    // En Promociones, si los tratamientos tienen promoGroup (Facial/Corporal/
    // Láser), se separan en bloques con su propio título — más fácil de
    // escanear cuando hay muchas promociones activas a la vez (Black Friday).
    const hasPromoGroups = activeCategory === t('promoCategory') && items.some((s) => s.promoGroup);
    if (!hasPromoGroups) {
      renderServiceCards(items);
      return;
    }
    const order = ['Facial', 'Corporal', 'Laser'];
    order.forEach((group) => {
      const groupItems = items.filter((s) => s.promoGroup === group);
      if (!groupItems.length) return;
      const header = document.createElement('div');
      header.className = 'booking-promo-subheader';
      header.textContent = t('promoGroup' + group);
      els.services.appendChild(header);
      renderServiceCards(groupItems);
    });
    // Promociones sin grupo asignado (p.ej. de temporada, no de Black
    // Friday) van al final, sin cabecera de bloque.
    const ungrouped = items.filter((s) => !s.promoGroup);
    if (ungrouped.length) renderServiceCards(ungrouped);
  }

  function renderDurationSection() {
    const group = state.durationGroup;
    if (!group) {
      els.durationSection.style.display = 'none';
      els.durationSection.innerHTML = '';
      return;
    }
    els.durationSection.style.display = 'block';
    els.durationSection.innerHTML = `
      <div class="booking-bono-title">${t('chooseDuration')}</div>
      <div class="booking-bono-options">
        ${group.map((s) => `
          <button type="button" class="booking-bono-option${state.service && state.service.id === s.id ? ' selected' : ''}" data-id="${s.id}">
            <span class="booking-bono-option-name">${s.durationMinutes} min</span>
            <span class="booking-bono-option-price">${s.price > 0 ? s.price.toFixed(0) + ' €' : t('free')}</span>
          </button>
        `).join('')}
      </div>
    `;
    els.durationSection.querySelectorAll('.booking-bono-option').forEach((btn) => {
      btn.addEventListener('click', () => {
        const svc = group.find((s) => s.id === btn.dataset.id);
        const cardEl = els.services.querySelector('.booking-service-card.selected');
        selectService(svc, cardEl, group, true);
        renderServiceGrid();
      });
    });
  }

  // ── Bonos de sesiones (opcional, solo si el tratamiento elegido tiene uno) ──
  let bonosById = {};
  async function loadBonos() {
    try {
      const res = await fetch(`${BOOKING_API_BASE}/bonos?lang=${LANG}`);
      const data = await res.json();
      bonosById = {};
      (data.bonos || []).forEach((b) => {
        if (!bonosById[b.serviceId]) bonosById[b.serviceId] = [];
        bonosById[b.serviceId].push(b);
      });
      Object.values(bonosById).forEach((tiers) => tiers.sort((a, b) => a.sessions - b.sessions));
    } catch (e) {
      bonosById = {}; // si falla, simplemente no se ofrece bono — no bloquea la reserva normal
    }
  }

  // ── Nº de sesiones de cada tratamiento (selector − / + del carrito) ──
  // Cada tratamiento del carrito se puede comprar en 1, 2 o 3 sesiones
  // (precio de sesión suelta × n), y además en los bonos que tenga
  // configurados (p.ej. bono de 3 con descuento, o bono de 6 sesiones). Si
  // hay bono configurado para ese nº de sesiones, se usa su precio. Con 2+
  // sesiones se compra como bono: se agenda hoy la 1ª y el resto quedan
  // solas en "Mis reservas". Mismo criterio que lib/bonoTiers.js del
  // servidor: en promociones también, salvo las de presoterapia; nunca en
  // packs normales ni tratamientos gratuitos.
  const MULTI_SESSION_MAX = 3;
  function isMultiSessionEligible(svc) {
    if (!svc || !(svc.price > 0)) return false;
    if (svc.category === t('promoCategory')) return !svc.id.includes('presoterapia');
    return !svc.pack;
  }
  // Cantidades posibles para un tratamiento, en orden: [1, 2, 3, 6...]
  function sessionQuantitiesFor(svc) {
    if (!svc) return [1];
    const set = new Set([1]);
    if (isMultiSessionEligible(svc)) for (let n = 2; n <= MULTI_SESSION_MAX; n++) set.add(n);
    (bonosById[svc.id] || []).forEach((b) => set.add(b.sessions));
    return Array.from(set).sort((a, b) => a - b);
  }
  // "Bono" para n sesiones: el configurado si existe, si no uno a precio
  // suelto × n. null para 1 sesión (va como sesión suelta normal).
  function bonoForQty(svc, n) {
    if (!svc || n < 2) return null;
    const configured = (bonosById[svc.id] || []).find((b) => b.sessions === n);
    if (configured) return { ...configured, serviceName: svc.name, custom: false };
    return {
      serviceId: svc.id,
      serviceName: svc.name,
      category: svc.category,
      sessions: n,
      bonoPrice: Math.round(svc.price * n * 100) / 100,
      singleSessionPrice: svc.price,
      custom: true,
    };
  }
  function bonoLabel(b) {
    return b.custom ? t('multiSessionLabel')(b.sessions) : t('bonoPackLabel')(b.sessions);
  }
  // Pinta el selector "− n +" — onChange recibe la nueva cantidad.
  function buildQtyStepper(qtys, current, onChange) {
    const wrap = document.createElement('span');
    wrap.className = 'booking-qty';
    const idx = qtys.indexOf(current);
    const minus = document.createElement('button');
    minus.type = 'button';
    minus.className = 'booking-qty-btn';
    minus.textContent = '−';
    minus.setAttribute('aria-label', t('qtyLess'));
    minus.disabled = idx <= 0;
    const value = document.createElement('span');
    value.className = 'booking-qty-value';
    value.textContent = current;
    const plus = document.createElement('button');
    plus.type = 'button';
    plus.className = 'booking-qty-btn';
    plus.textContent = '+';
    plus.setAttribute('aria-label', t('qtyMore'));
    plus.disabled = idx >= qtys.length - 1;
    minus.addEventListener('click', () => { if (idx > 0) onChange(qtys[idx - 1]); });
    plus.addEventListener('click', () => { if (idx < qtys.length - 1) onChange(qtys[idx + 1]); });
    wrap.appendChild(minus);
    wrap.appendChild(value);
    wrap.appendChild(plus);
    return wrap;
  }

  // Tic "Reservar cita hoy" de cada tratamiento del carrito. Desmarcado =
  // se compra igual, pero se agenda después desde Mis reservas (así quien
  // compra varias cosas por la promoción no tiene que hacerlo todo el mismo
  // día ni encontrar un hueco con tiempo para todo junto).
  function buildLaterToggle(serviceId) {
    const line = cartLines().find((l) => l.svc.id === serviceId);
    if (!line || !canBuyForLater(line.svc, line.sessions)) return null;
    const label = document.createElement('label');
    label.className = 'booking-later-toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !line.later;
    const text = document.createElement('span');
    text.textContent = line.sessions > 1 ? t('scheduleFirstToday') : t('scheduleToday');
    label.appendChild(input);
    label.appendChild(text);
    input.addEventListener('change', () => {
      if (input.checked) state.laterIds.delete(serviceId); else state.laterIds.add(serviceId);
      onCartScheduleChanged();
    });
    return label;
  }
  function onCartScheduleChanged() {
    // Los extras de zona/tiempo solo tienen sentido si el principal se hace hoy.
    if (!primaryScheduledSingle()) {
      state.extras = [];
      els.extrasSection.style.display = 'none';
    } else if (!state.wantsBono) {
      loadExtras();
    }
    renderBonoSection();
    renderAddonsChips();
    renderSummary();
  }

  function renderBonoSection() {
    const svc = state.service;
    const qtys = sessionQuantitiesFor(svc);
    if (qtys.length < 2) {
      els.bonoSection.style.display = 'none';
      els.bonoSection.innerHTML = '';
      state.wantsBono = false;
      state.bono = null;
      return;
    }
    // Si ya había varias sesiones elegidas (p.ej. al cambiar solo la
    // duración dentro de un grupo), se mantiene la cantidad si es posible.
    let qty = state.wantsBono && state.bono ? state.bono.sessions : 1;
    if (!qtys.includes(qty)) qty = 1;
    state.wantsBono = qty > 1;
    state.bono = bonoForQty(svc, qty);

    const hasDiscountPack = (bonosById[svc.id] || []).length > 0;
    const price = state.bono ? state.bono.bonoPrice : svc.price;
    const save = state.bono ? Math.max(0, svc.price * qty - state.bono.bonoPrice) : 0;
    const nextPack = (bonosById[svc.id] || []).find((b) => b.sessions > qty);
    els.bonoSection.style.display = 'block';
    els.bonoSection.innerHTML = `
      <div class="booking-bono-title">✦ ${hasDiscountPack ? t('bonoTitle') : t('multiSessionTitle')}</div>
      <div class="booking-qty-row">
        <span class="booking-qty-label">${t('qtyLabel')}</span>
        <span class="booking-qty-slot"></span>
        <span class="booking-qty-total">
          <span class="booking-bono-option-price">${price.toFixed(0)} €</span>
          ${save >= 1 ? `<span class="booking-bono-option-badge">${t('bonoSaveNote')(save.toFixed(0))}</span>` : ''}
          ${qty > 1 && save >= 1 ? `<span class="booking-qty-per">${t('bonoPerSession')((price / qty).toFixed(0))}</span>` : ''}
        </span>
      </div>
      ${state.bono && !state.bono.custom ? `<p class="booking-qty-packname">${bonoLabel(state.bono)}</p>` : ''}
      ${!state.wantsBono && nextPack ? `<p class="booking-qty-hint">${t('qtyPackHint')(nextPack.sessions, nextPack.bonoPrice.toFixed(0), Math.max(0, svc.price * nextPack.sessions - nextPack.bonoPrice).toFixed(0))}</p>` : ''}
      <p class="booking-bono-note">${state.wantsBono ? t('bonoSessionNote')(qty) : t('qtyNote')}</p>
    `;
    els.bonoSection.querySelector('.booking-qty-slot').appendChild(buildQtyStepper(qtys, qty, setMainQty));
    const mainToggle = buildLaterToggle(svc.id);
    if (mainToggle) {
      mainToggle.classList.add('booking-later-toggle-dark');
      els.bonoSection.appendChild(mainToggle);
      if (state.laterIds.has(svc.id)) {
        els.bonoSection.querySelector('.booking-bono-note').textContent = t('laterNote');
      }
    }
  }

  function setMainQty(n) {
    const svc = state.service;
    if (!svc) return;
    const wasBono = state.wantsBono;
    state.wantsBono = n > 1;
    state.bono = bonoForQty(svc, n);
    // Los "extras" de zona/tiempo del principal no tienen sentido si el
    // principal pasa a ser un bono; los tratamientos añadidos se mantienen.
    if (state.wantsBono) {
      state.extras = [];
      els.extrasSection.style.display = 'none';
    } else if (wasBono) {
      loadExtras();
    }
    renderBonoSection();
    renderAddonsSelect();
    renderSummary();
  }

  function selectService(service, cardEl, durationGroup, keepExtras) {
    state.service = service;
    state.durationGroup = durationGroup || null;
    // Cambiar solo la duración dentro del mismo grupo (p.ej. masajes) no debe
    // tirar los extras/añadidos ya elegidos — eso solo tiene sentido al
    // cambiar de tratamiento de verdad.
    if (!keepExtras) {
      state.extras = [];
      state.extraServices = [];
      state.extraBonos = [];
      addonOrder = [];
      state.laterIds = new Set();
      state.wantsBono = false;
    }
    document.querySelectorAll('#booking-services .booking-service-card').forEach((c) => c.classList.remove('selected'));
    if (cardEl) cardEl.classList.add('selected');
    renderSummary();
    renderBonoSection();
    renderDurationSection();
    els.addonsSection.style.display = 'block';
    els.step1Actions.style.display = 'block';
    renderAddonsChips();
    renderAddonsSelect();
    if (!keepExtras) loadExtras();
    // En móvil "Tu reserva" queda al final de la página: al elegir un
    // tratamiento se baja lo justo para que se vea el selector de sesiones
    // (en listas largas como Promociones quedaba fuera de la pantalla).
    if (!keepExtras && window.innerWidth <= 980 && els.bonoSection.style.display !== 'none') {
      setTimeout(() => els.bonoSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
    }
  }

  // ── "Otros tratamientos" añadidos a la misma cita ──
  // Se añaden con 1 sesión y en el propio chip se sube o baja el nº de
  // sesiones con − / + (igual que el principal). Con 1 sesión va en
  // extraServices; con 2+ en extraBonos. addonOrder guarda el orden en que
  // se añadieron para que el chip no cambie de sitio al cambiar la cantidad.
  let addonOrder = [];
  function renderAddonsSelect() {
    const usedIds = new Set(selectedServiceIds());
    els.addonsSelect.innerHTML = `<option value="">${t('addTreatment')}</option>`;
    Object.keys(servicesByCategory).forEach((cat) => {
      const items = servicesByCategory[cat].filter((s) => !usedIds.has(s.id));
      if (!items.length) return;
      const group = document.createElement('optgroup');
      group.label = cat;
      items.forEach((s) => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = `${s.name} — ${s.price > 0 ? s.price.toFixed(0) + ' €' : t('free')}`;
        group.appendChild(opt);
      });
      els.addonsSelect.appendChild(group);
    });
  }

  function setAddonQty(svc, n) {
    state.extraServices = state.extraServices.filter((x) => x.id !== svc.id);
    state.extraBonos = state.extraBonos.filter((x) => x.serviceId !== svc.id);
    if (n <= 0) {
      addonOrder = addonOrder.filter((id) => id !== svc.id);
      state.laterIds.delete(svc.id);
    } else if (n === 1) {
      state.extraServices.push(svc);
    } else {
      state.extraBonos.push(bonoForQty(svc, n));
    }
    onAddonsChanged();
  }

  function renderAddonsChips() {
    els.addonsChips.innerHTML = '';
    const ids = addonOrder.filter((id) => state.extraServices.some((s) => s.id === id) || state.extraBonos.some((b) => b.serviceId === id));
    // Por si algo se añadió sin pasar por addonOrder, que no se pierda.
    [...state.extraServices.map((s) => s.id), ...state.extraBonos.map((b) => b.serviceId)].forEach((id) => { if (!ids.includes(id)) ids.push(id); });
    addonOrder = ids;
    ids.forEach((id) => {
      const svc = findServiceById(id);
      if (!svc) return;
      const bono = state.extraBonos.find((b) => b.serviceId === id);
      const qty = bono ? bono.sessions : 1;
      const chip = document.createElement('span');
      chip.className = 'booking-addon-chip' + (bono ? ' booking-addon-chip-bono' : '');
      const label = document.createElement('span');
      label.textContent = bono && !bono.custom ? `${svc.name} — ${bonoLabel(bono)}` : svc.name;
      chip.appendChild(label);
      const qtys = sessionQuantitiesFor(svc);
      if (qtys.length > 1) chip.appendChild(buildQtyStepper(qtys, qty, (n) => setAddonQty(svc, n)));
      const chipToggle = buildLaterToggle(svc.id);
      if (chipToggle) chip.appendChild(chipToggle);
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'booking-addon-remove';
      removeBtn.setAttribute('aria-label', t('removeAddon'));
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', () => setAddonQty(svc, 0));
      chip.appendChild(removeBtn);
      els.addonsChips.appendChild(chip);
    });
  }

  function onAddonsChanged() {
    renderAddonsChips();
    renderAddonsSelect();
    renderSummary();
    if (!state.wantsBono) loadExtras();
  }

  els.addonsSelect.addEventListener('change', () => {
    const id = els.addonsSelect.value;
    if (!id) return;
    const svc = findServiceById(id);
    if (svc) {
      addonOrder.push(svc.id);
      state.extraServices.push(svc);
      onAddonsChanged();
    }
    els.addonsSelect.value = '';
  });

  // ── Extras opcionales (antes de pasar a elegir profesional) ──
  async function loadExtras() {
    els.extrasSection.style.display = 'none';
    try {
      const ids = selectedServiceIds().join(',');
      const res = await fetch(`${BOOKING_API_BASE}/extras?serviceIds=${encodeURIComponent(ids)}&lang=${LANG}`);
      const data = await res.json();
      const applicable = data.extras || [];
      // Si un extra ya no aplica (porque se quitó el tratamiento al que iba asociado), lo destildamos
      state.extras = state.extras.filter((ex) => applicable.some((d) => d.id === ex.id));
      if (!applicable.length) {
        renderSummary();
        return;
      }
      els.extras.innerHTML = '';
      applicable.forEach((ex) => {
        const label = document.createElement('label');
        label.className = 'booking-extra-option';
        const checked = state.extras.some((sel) => sel.id === ex.id);
        label.innerHTML = `
          <span class="booking-extra-option-label">
            <input type="checkbox" value="${ex.id}" ${checked ? 'checked' : ''}>
            <span>
              <span class="booking-extra-option-name">${ex.name}</span>
              <span class="booking-extra-option-meta"> · ${ex.durationMinutes} min</span>
            </span>
          </span>
          <span class="booking-extra-option-price">${ex.price > 0 ? ex.price.toFixed(0) + ' €' : t('free')}</span>
        `;
        label.querySelector('input').addEventListener('change', (e) => {
          if (e.target.checked) {
            state.extras.push(ex);
          } else {
            state.extras = state.extras.filter((sel) => sel.id !== ex.id);
          }
          renderSummary();
        });
        els.extras.appendChild(label);
      });
      els.extrasSection.style.display = 'block';
      renderSummary();
    } catch (e) {
      // Si fallan los extras, seguimos sin bloquear la reserva del tratamiento principal
      renderSummary();
    }
  }

  // Clientas nuevas (sin ninguna reserva previa) que reservan láser SHR se
  // derivan directamente a una profesional concreta, sin pasar por la
  // elección manual — ver showLaserPhoneGate(). El id de servicio es el
  // mismo en los 3 idiomas, así que comprobarlo así no depende del idioma.
  const LASER_AUTO_ASSIGN_EMPLOYEE_ID = 'vanessa';
  function hasLaserSelected() {
    return scheduledServiceIds().some((id) => id.startsWith('laser-'));
  }

  els.continueStep1.addEventListener('click', () => {
    // Todo comprado para agendar después: no hace falta profesional ni
    // hora — directo a los datos y el pago.
    if (!hasAppointment()) {
      state.employee = null;
      state.date = null;
      state.time = null;
      renderSummary();
      renderPayOptions();
      goToStep(4);
      return;
    }
    goToStep(2);
    if (hasLaserSelected()) {
      showLaserPhoneGate();
    } else {
      loadEmployees();
    }
  });

  // ── PASO 2: empleadas ──
  function renderEmployeeGrid(list) {
    els.employees.innerHTML = '';
    list.forEach((emp) => {
      const card = document.createElement('div');
      card.className = 'booking-employee-card';
      card.textContent = emp.name;
      card.addEventListener('click', () => {
        state.employee = emp;
        document.querySelectorAll('#booking-employees .booking-employee-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        renderSummary();
        setupCalendar();
        goToStep(3);
      });
      els.employees.appendChild(card);
    });
    if (!list.length) {
      els.employees.innerHTML = `<p>${t('noEmployees')}</p>`;
    }
  }

  async function loadEmployees() {
    els.employees.innerHTML = `<p class="booking-loading">${t('loading')}</p>`;
    try {
      const ids = scheduledServiceIds().join(',');
      const res = await fetch(`${BOOKING_API_BASE}/employees?serviceIds=${encodeURIComponent(ids)}`);
      const data = await res.json();
      renderEmployeeGrid(data.employees);
    } catch (e) {
      showError(t('loadEmployeesError'));
    }
  }

  // Igual que loadEmployees, pero si la profesional objetivo puede con
  // todos los tratamientos elegidos, se selecciona sola (sin mostrar la
  // rejilla) — si no puede (p.ej. combinada con algo que no hace), se cae
  // de vuelta a la elección manual de siempre, con la lista ya cargada.
  async function loadEmployeesAutoAssign(employeeId) {
    els.employees.innerHTML = `<p class="booking-loading">${t('loading')}</p>`;
    try {
      const ids = scheduledServiceIds().join(',');
      const res = await fetch(`${BOOKING_API_BASE}/employees?serviceIds=${encodeURIComponent(ids)}`);
      const data = await res.json();
      const target = data.employees.find((e) => e.id === employeeId);
      if (target) {
        state.employee = target;
        renderSummary();
        setupCalendar();
        goToStep(3);
      } else {
        renderEmployeeGrid(data.employees);
      }
    } catch (e) {
      showError(t('loadEmployeesError'));
    }
  }

  // Paso previo solo para láser SHR: pide el teléfono antes de mostrar a
  // quién elegir, para saber si es clienta nueva (sin ninguna reserva
  // previa) — si lo es, se deriva directamente a LASER_AUTO_ASSIGN_EMPLOYEE_ID;
  // si ya es clienta, sigue pudiendo elegir como siempre.
  function showLaserPhoneGate() {
    els.employees.innerHTML = `
      <div class="booking-laser-phone-gate">
        <p>${t('laserPhonePrompt')}</p>
        <input type="tel" class="booking-laser-phone-input" placeholder="${t('laserPhonePlaceholder')}">
        <button type="button" class="btn-primary booking-laser-phone-continue">${t('laserPhoneContinue')}</button>
        <p class="booking-error booking-laser-phone-error" style="display:none;"></p>
      </div>
    `;
    const input = els.employees.querySelector('.booking-laser-phone-input');
    const savedForGate = loadSavedClient();
    if (savedForGate && savedForGate.phone) input.value = savedForGate.phone;
    const btn = els.employees.querySelector('.booking-laser-phone-continue');
    const errorEl = els.employees.querySelector('.booking-laser-phone-error');
    const submit = async () => {
      const phone = input.value.trim();
      errorEl.style.display = 'none';
      if (!phone) {
        errorEl.textContent = t('laserPhoneRequired');
        errorEl.style.display = 'block';
        return;
      }
      state.phone = phone;
      btn.disabled = true;
      try {
        const res = await fetch(`${BOOKING_API_BASE}/client-status?phone=${encodeURIComponent(phone)}`);
        const data = await res.json();
        if (data.isNew) {
          await loadEmployeesAutoAssign(LASER_AUTO_ASSIGN_EMPLOYEE_ID);
        } else {
          await loadEmployees();
        }
      } catch (e) {
        // Fallo al comprobar — no bloquea la reserva, deja elegir como siempre.
        await loadEmployees();
      }
      btn.disabled = false;
    };
    btn.addEventListener('click', submit);
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') submit(); });
  }

  // ── PASO 3: calendario y hora ──
  const MIN_DATE = new Date();
  MIN_DATE.setHours(0, 0, 0, 0);
  // Sin límite de fecha máxima — igual que bookingWindowDays en
  // booking-api/src/config/hours.js, que tampoco lo tiene.
  const calendarState = { year: MIN_DATE.getFullYear(), month: MIN_DATE.getMonth() };

  function toISODate(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function isSameDate(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function setupCalendar() {
    calendarState.year = MIN_DATE.getFullYear();
    calendarState.month = MIN_DATE.getMonth();
    state.date = null;
    state.time = null;
    els.slots.innerHTML = '';
    renderCalendar();
  }

  function renderCalendar() {
    const { year, month } = calendarState;
    const first = new Date(year, month, 1);
    const startWeekday = (first.getDay() + 6) % 7; // lunes = 0
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthLabel = first.toLocaleDateString(DATE_LOCALE, { month: 'long', year: 'numeric' });
    els.calMonthLabel.textContent = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);

    els.calGrid.innerHTML = '';
    for (let i = 0; i < startWeekday; i++) {
      const empty = document.createElement('div');
      empty.className = 'booking-cal-cell empty';
      els.calGrid.appendChild(empty);
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(year, month, d);
      dateObj.setHours(0, 0, 0, 0);
      const iso = toISODate(dateObj);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'booking-cal-cell';
      cell.textContent = String(d);
      const empWeekly = state.employee && state.employee.weekly;
      const daySchedule = empWeekly && empWeekly[dateObj.getDay()];
      const dayOff = empWeekly && (!daySchedule || daySchedule.closed);
      const closures = (state.employee && state.employee.closures) || [];
      const isClosureDay = closures.some((c) => iso >= c.start && iso <= c.end);
      const disabled = dateObj < MIN_DATE || dayOff || isClosureDay;
      if (disabled) {
        cell.classList.add('disabled');
        cell.disabled = true;
      }
      if (isSameDate(dateObj, new Date())) cell.classList.add('today');
      if (state.date === iso) cell.classList.add('selected');
      if (!disabled) {
        cell.addEventListener('click', () => {
          state.date = iso;
          state.time = null;
          document.querySelectorAll('.booking-cal-cell.selected').forEach((c) => c.classList.remove('selected'));
          cell.classList.add('selected');
          loadSlotsForDate(iso);
        });
      }
      els.calGrid.appendChild(cell);
    }

    els.calPrev.disabled = year === MIN_DATE.getFullYear() && month === MIN_DATE.getMonth();
  }

  els.calPrev.addEventListener('click', () => {
    calendarState.month--;
    if (calendarState.month < 0) {
      calendarState.month = 11;
      calendarState.year--;
    }
    renderCalendar();
  });
  els.calNext.addEventListener('click', () => {
    calendarState.month++;
    if (calendarState.month > 11) {
      calendarState.month = 0;
      calendarState.year++;
    }
    renderCalendar();
  });

  async function loadSlotsForDate(dateStr) {
    els.slots.innerHTML = `<p class="booking-slot-message">${t('searchingSlots')}</p>`;
    try {
      // Solo lo que se agenda hoy (incluidos los bonos añadidos, que antes
      // no se mandaban y el calendario enseñaba huecos demasiado cortos).
      const schedIds = scheduledServiceIds();
      const params = new URLSearchParams({
        serviceId: schedIds[0],
        employeeId: state.employee.id,
        date: dateStr,
        extraIds: primaryScheduledSingle() ? state.extras.map((e) => e.id).join(',') : '',
        extraServiceIds: schedIds.slice(1).join(','),
      });
      const res = await fetch(`${BOOKING_API_BASE}/availability?${params}`);
      if (!res.ok) throw new Error('availability request failed');
      const data = await res.json();
      els.slots.innerHTML = '';
      if (!data.slots || !data.slots.length) {
        els.slots.innerHTML = `<p class="booking-slot-message">${t('noSlots')}</p>`;
        return;
      }
      data.slots.forEach((time) => {
        const slot = document.createElement('div');
        slot.className = 'booking-slot';
        slot.textContent = time;
        slot.addEventListener('click', () => {
          state.time = time;
          document.querySelectorAll('.booking-slot').forEach((s) => s.classList.remove('selected'));
          slot.classList.add('selected');
          renderSummary();
          renderPayOptions();
          goToStep(4);
          // Si ya se pidió el teléfono antes (ver showLaserPhoneGate), se
          // rellena solo para no hacérselo escribir dos veces.
          if (state.phone) {
            const phoneInput = document.getElementById('booking-phone');
            if (phoneInput && !phoneInput.value) phoneInput.value = state.phone;
          }
        });
        els.slots.appendChild(slot);
      });
    } catch (e) {
      els.slots.innerHTML = '';
      showError(t('availabilityError'));
    }
  }

  // ── PASO 4: pago y envío ──
  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function renderPayOptions() {
    const { service } = state;
    const price = totalPrice();
    els.payOptions.innerHTML = '';
    const termsHtml = `
      <label class="booking-pay-option booking-bono-terms">
        <input type="checkbox" id="booking-terms-check">
        <span>${t('termsLabel')}</span>
      </label>
    `;

    // El bloque de pago "bono" (con nota informativa + checkbox de términos)
    // debe salir siempre que haya ALGÚN bono en el carrito, sea el principal
    // o uno añadido como extra — no solo cuando el tratamiento principal es
    // el bono. Si no, un bono comprado solo como "extra" nunca mostraría el
    // checkbox de condiciones y se compraría sin que la clienta lo aceptase.
    if (hasAnyBono()) {
      const depositAmount = round2((price * (service.depositPercent || 30)) / 100);
      state.payChoice = 'deposit';
      els.payOptions.innerHTML = `
        <label class="booking-pay-option">
          <input type="radio" name="pay" value="deposit" checked>
          <span>${t('payDepositOnly')} <strong>${depositAmount.toFixed(2)} €</strong> ${t('restAtCenterParen')}</span>
        </label>
        <label class="booking-pay-option">
          <input type="radio" name="pay" value="full">
          <span>${t('payFullNow')} <strong>${price.toFixed(2)} €</strong></span>
        </label>
        <p class="booking-pay-note">${t('bonoFullNote')}</p>
        <label class="booking-pay-option booking-bono-terms">
          <input type="checkbox" id="booking-bono-terms-check">
          <span>${t('bonoTermsLabel')}</span>
        </label>
      `;
      els.payOptions.querySelectorAll('input[name="pay"]').forEach((r) => {
        r.addEventListener('change', () => { state.payChoice = r.value; });
      });
      // OJO: nunca usar "innerHTML +=" aquí — recrea todos los nodos hijos
      // (incluidos los radios ya con su listener) dejando la elección de
      // pago sin efecto. insertAdjacentHTML solo añade, no destruye nada.
      els.payOptions.insertAdjacentHTML('beforeend', `<p class="booking-pay-note booking-cancel-note">${t('cancelPolicyNote')}</p>`);
      els.payOptions.insertAdjacentHTML('beforeend', termsHtml);
      return;
    }

    const depositAmount = round2((price * (service.depositPercent || 0)) / 100);

    if (service.paymentPolicy === 'full_required') {
      els.payOptions.innerHTML = `<p class="booking-pay-note">${t('fullRequired')} <strong>${price.toFixed(2)} €</strong></p>`;
      state.payChoice = 'full';
    } else if (service.paymentPolicy === 'deposit_required') {
      els.payOptions.innerHTML = `<p class="booking-pay-note">${t('depositRequired')} <strong>${depositAmount.toFixed(2)} €</strong> (${t('restAtCenter')} ${(price - depositAmount).toFixed(2)} € ${t('atCenter')}).</p>`;
      state.payChoice = 'deposit';
    } else {
      state.payChoice = 'deposit';
      els.payOptions.innerHTML = `
        <label class="booking-pay-option">
          <input type="radio" name="pay" value="deposit" checked>
          <span>${t('payDepositOnly')} <strong>${depositAmount.toFixed(2)} €</strong> ${t('restAtCenterParen')}</span>
        </label>
        <label class="booking-pay-option">
          <input type="radio" name="pay" value="full">
          <span>${t('payFullNow')} <strong>${price.toFixed(2)} €</strong></span>
        </label>
      `;
      els.payOptions.querySelectorAll('input[name="pay"]').forEach((r) => {
        r.addEventListener('change', () => { state.payChoice = r.value; });
      });
    }
    // Igual que arriba: insertAdjacentHTML, nunca "innerHTML +=".
    els.payOptions.insertAdjacentHTML('beforeend', `<p class="booking-pay-note booking-cancel-note">${t('cancelPolicyNote')}</p>`);
    els.payOptions.insertAdjacentHTML('beforeend', termsHtml);
  }

  els.submit.addEventListener('click', async () => {
    clearError();
    const name = document.getElementById('booking-name').value.trim();
    const phone = document.getElementById('booking-phone').value.trim();
    const email = document.getElementById('booking-email').value.trim();
    const birthdate = document.getElementById('booking-birthdate').value.trim();

    if (!name || !phone || !email) {
      showError(t('fillNamePhone'));
      return;
    }
    if (!state.service || (hasAppointment() && (!state.employee || !state.date || !state.time))) {
      showError(t('missingBookingData'));
      return;
    }
    if (hasAnyBono()) {
      const bonoTermsCheck = document.getElementById('booking-bono-terms-check');
      if (!bonoTermsCheck || !bonoTermsCheck.checked) {
        showError(t('bonoTermsRequired'));
        return;
      }
    }
    const termsCheck = document.getElementById('booking-terms-check');
    if (!termsCheck || !termsCheck.checked) {
      showError(t('termsRequired'));
      return;
    }

    rememberClientIfAsked({ name, phone, email, birthdate });

    els.submit.disabled = true;
    els.submit.textContent = t('connectingPayment');

    // Si hay algún bono de por medio (el principal o algún tratamiento
    // añadido), se usa bono-checkout, que soporta cualquier mezcla de
    // sesiones sueltas y bonos. Si no hay ningún bono, sigue el checkout
    // normal de toda la vida.
    const bonoMode = hasAnyBono();
    const withAppointment = hasAppointment();
    const endpoint = bonoMode ? 'bono-checkout' : 'checkout';
    const body = bonoMode
      ? {
          items: cartLines().map((l) => ({ serviceId: l.svc.id, sessions: l.sessions, scheduleNow: !l.later })),
          extraIds: primaryScheduledSingle() ? state.extras.map((e) => e.id) : [],
          employeeId: withAppointment ? state.employee.id : undefined,
          date: withAppointment ? state.date : undefined,
          time: withAppointment ? state.time : undefined,
          clientName: name,
          clientPhone: phone,
          clientEmail: email || undefined,
          clientBirthdate: birthdate || undefined,
          paymentChoice: state.payChoice,
          discountCode: discountIsStillValid() ? state.discountCode : undefined,
          termsAccepted: true,
          lang: LANG,
        }
      : {
          serviceId: state.service.id,
          employeeId: state.employee.id,
          extraIds: state.extras.map((e) => e.id),
          extraServiceIds: state.extraServices.map((s) => s.id),
          date: state.date,
          time: state.time,
          clientName: name,
          clientPhone: phone,
          clientEmail: email || undefined,
          clientBirthdate: birthdate || undefined,
          paymentChoice: state.payChoice,
          discountCode: discountIsStillValid() ? state.discountCode : undefined,
          redeemAmount: redeemAmount() > 0 ? redeemAmount() : undefined,
          termsAccepted: true,
          lang: LANG,
        };

    try {
      const res = await fetch(`${BOOKING_API_BASE}/${endpoint}`, {
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
      els.submit.textContent = t('goToPayment');
    }
  });

  // ============================================================
  // Recordar los datos de la clienta en SU dispositivo (localStorage), para
  // que no tenga que escribirlos en cada reserva. Solo si marca la casilla;
  // no se manda a ningún sitio nuevo, y se puede borrar desde el formulario.
  // ============================================================
  const CLIENT_STORAGE_KEY = 'osana_cliente_v1';

  function loadSavedClient() {
    try {
      const data = JSON.parse(localStorage.getItem(CLIENT_STORAGE_KEY));
      return data && typeof data === 'object' ? data : null;
    } catch (e) {
      return null; // navegación privada o almacenamiento bloqueado: como siempre
    }
  }

  function forgetSavedClient() {
    try { localStorage.removeItem(CLIENT_STORAGE_KEY); } catch (e) { /* nada que borrar */ }
  }

  function rememberClientIfAsked(client) {
    const check = document.getElementById('booking-remember-check');
    if (!check) return;
    if (!check.checked) { forgetSavedClient(); return; }
    try {
      localStorage.setItem(CLIENT_STORAGE_KEY, JSON.stringify(client));
    } catch (e) { /* sin almacenamiento: la reserva sigue igual */ }
  }

  function setupRememberedClient() {
    const fields = { name: 'name', phone: 'tel', email: 'email', birthdate: 'bday' };
    Object.keys(fields).forEach((key) => {
      const el = document.getElementById(`booking-${key}`);
      if (el) el.setAttribute('autocomplete', fields[key]);
    });
    const birthdateInput = document.getElementById('booking-birthdate');
    const anchor = birthdateInput && birthdateInput.closest('.booking-field');
    if (!anchor) return;

    const box = document.createElement('div');
    box.className = 'booking-field booking-remember';
    box.innerHTML = `
      <label class="booking-remember-label">
        <input type="checkbox" id="booking-remember-check">
        <span>${t('rememberMe')}</span>
      </label>`;
    anchor.insertAdjacentElement('afterend', box);

    const saved = loadSavedClient();
    if (!saved) return;
    Object.keys(fields).forEach((key) => {
      const el = document.getElementById(`booking-${key}`);
      if (el && !el.value && typeof saved[key] === 'string') el.value = saved[key];
    });
    if (saved.phone) state.phone = saved.phone;
    document.getElementById('booking-remember-check').checked = true;

    const note = document.createElement('p');
    note.className = 'booking-remember-note';
    note.textContent = `${t('rememberedNote')} `;
    const forget = document.createElement('button');
    forget.type = 'button';
    forget.className = 'booking-remember-forget';
    forget.textContent = t('forgetMe');
    forget.addEventListener('click', () => {
      forgetSavedClient();
      state.phone = '';
      Object.keys(fields).forEach((key) => {
        const el = document.getElementById(`booking-${key}`);
        if (el) el.value = '';
      });
      document.getElementById('booking-remember-check').checked = false;
      note.remove();
    });
    note.appendChild(forget);
    box.appendChild(note);
  }

  setupRememberedClient();

  // Mensaje si venimos de vuelta de Stripe
  const params = new URLSearchParams(window.location.search);
  if (params.get('estado') === 'ok') {
    document.querySelector('.booking-shell').innerHTML = `
      <div class="booking-confirm">
        <h2>${t('confirmedTitle')}</h2>
        <p>${t('confirmedText')}</p>
        <a href="index.html" class="btn-primary">${t('backHome')}</a>
      </div>`;
  } else if (params.get('estado') === 'comprado') {
    document.querySelector('.booking-shell').innerHTML = `
      <div class="booking-confirm">
        <h2>${t('purchasedTitle')}</h2>
        <p>${t('purchasedText')}</p>
        <a href="mis-reservas.html" class="btn-primary">${t('goMyBookings')}</a>
      </div>`;
  } else if (params.get('estado') === 'cancelado') {
    showError(t('cancelledPayment'));
    loadServices();
    loadBonos();
  } else {
    loadServices();
    loadBonos();
  }
})();
