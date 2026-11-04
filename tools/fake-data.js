// ============================================================
// Datos INVENTADOS con la misma estructura que las pestañas de la Google
// Sheet (ver booking-api/src/lib/db-schema.js). Ninguna persona real:
//   - teléfonos del bloque +44 7700 900000–900999, reservado en Reino Unido
//     para ficción (Ofcom): no está asignado a nadie;
//   - emails en @example.com (dominio reservado para ejemplos, RFC 2606);
//   - nombres = nombre de pila + apellido "Prueba"/"Ficticia"/"Demo".
// Siempre genera lo mismo para la misma semilla (para poder comparar).
//
// Uso:  node tools/fake-data.js            → escribe tools/.out/fake-data.json
//       node tools/fake-data.js --semilla 7
// ============================================================
const fs = require('fs');
const path = require('path');

const API = path.join(__dirname, '..', 'booking-api', 'src');
const SERVICES = require(path.join(API, 'config', 'services.js'));
const EMPLOYEES = require(path.join(API, 'config', 'employees.js'));
const { normalizePhone, normalizeEmail } = require(path.join(API, 'lib', 'clientId.js'));

const COUNTS = {
  clients: 320, bookings: 700, loyalty: 400, sessionBonos: 190, gifts: 40, birthdays: 150,
  unsubscribes: 20, strikes: 30, productSales: 120, quotes: 25, discounts: 10, followups: 40,
};

const FIRST = ['Lucía', 'María', 'Carmen', 'Ana', 'Laura', 'Marta', 'Paula', 'Sara', 'Elena', 'Julia',
  'Irene', 'Alba', 'Nerea', 'Claudia', 'Noelia', 'Rocío', 'Sofía', 'Valeria', 'Chiara', 'Giulia',
  'Emma', 'Olivia', 'Daniela', 'Patricia', 'Cristina', 'Beatriz', 'Andrea', 'Silvia', 'Inés', 'Lorena'];
const LAST = ['Prueba', 'Ficticia', 'Demo'];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generate({ seed = 42, now = new Date('2026-10-29T12:00:00.000Z') } = {}) {
  const rand = mulberry32(seed);
  const int = (min, max) => min + Math.floor(rand() * (max - min + 1));
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const chance = (p) => rand() < p;
  const uuid = () => {
    const h = () => Math.floor(rand() * 16).toString(16);
    const s = (n) => Array.from({ length: n }, h).join('');
    return `${s(8)}-${s(4)}-4${s(3)}-${pick(['8', '9', 'a', 'b'])}${s(3)}-${s(12)}`;
  };
  const DAY = 86400000;
  const isoAt = (daysFromNow, hour = 10, min = 0) => {
    const d = new Date(now.getTime() + daysFromNow * DAY);
    d.setUTCHours(hour, min, int(0, 59), int(0, 999));
    return d.toISOString();
  };
  const dateAt = (daysFromNow) => isoAt(daysFromNow).slice(0, 10);
  const money = (n) => String(Math.round(n * 100) / 100); // como String(round2(x)) en el código

  const employees = EMPLOYEES.map((e) => ({ id: e.id, name: e.name, calendarId: `${e.id}@calendario-prueba.example.com` }));
  const services = SERVICES.filter((s) => s.id && s.price !== undefined);

  // Clientas inventadas
  const clients = Array.from({ length: COUNTS.clients }, (_, i) => {
    const first = pick(FIRST);
    const last = pick(LAST);
    const n = String(i).padStart(3, '0');
    const phone = chance(0.5) ? `+44 7700 900${n}` : `+447700900${n}`; // dos formas de escribirlo
    const email = `${first.normalize('NFD').replace(/[^a-zA-Z]/g, '').toLowerCase()}.${last.toLowerCase()}${n}@example.com`;
    return {
      name: `${first} ${last} ${n}`,
      phone,
      email: chance(0.1) ? email.toUpperCase() : email,
      birthdate: chance(0.6) ? `${int(1965, 2004)}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}` : '',
      lang: pick(['es', 'es', 'es', 'en', 'it']),
    };
  });

  // Bonos de sesiones (paquetes de 3)
  const sessionBonos = Array.from({ length: COUNTS.sessionBonos }, () => {
    const c = pick(clients);
    const s = pick(services);
    const used = int(0, 3);
    const total = Math.round(s.price * 3 * 0.75);
    const online = chance(0.6) ? total : Math.round(total * 0.3);
    const manual = chance(0.25);
    return {
      bonoId: uuid(), createdAt: isoAt(-int(1, 300)), clientName: c.name, clientPhone: c.phone,
      clientEmail: c.email, serviceId: s.id, serviceName: s.name, employeeId: pick(employees).id,
      totalSessions: '3', sessionsUsed: String(used), sessionsRemaining: String(3 - used),
      totalPrice: money(total), amountPaidOnline: money(online),
      paymentType: online === total ? 'pagar total' : 'pagar reserva',
      remainingAmount: money(total - online), remainingPaidHow: online === total ? '' : pick(['', 'efectivo', 'tarjeta', 'bizum']),
      status: used >= 3 ? 'completed' : 'active', expiryDate: dateAt(int(30, 365)),
      paymentIntentId: manual ? '' : `pi_test_${uuid().replace(/-/g, '').slice(0, 24)}`, lang: c.lang,
      paidCash: manual ? money(online / 2) : '', paidBizum: manual ? money(online / 2) : '', paidCard: manual ? '0' : '',
    };
  });

  // Reservas
  const bookings = Array.from({ length: COUNTS.bookings }, () => {
    const c = pick(clients);
    const s = pick(services);
    const e = pick(employees);
    const dayOffset = int(-330, 60);
    const past = dayOffset < 0;
    const status = past ? pick(['confirmed', 'confirmed', 'confirmed', 'done', 'cancelled', 'no_show', 'no_show_forgiven']) : pick(['confirmed', 'confirmed', 'pending', 'cancelled']);
    const fromBono = chance(0.2) ? pick(sessionBonos) : null;
    const price = Number(s.price);
    const paid = fromBono ? 0 : (chance(0.5) ? price : Math.round(price * 0.3 * 100) / 100);
    const closed = past && status === 'done';
    const final = closed ? price + (chance(0.2) ? 10 : 0) : 0;
    const split = closed && chance(0.3);
    const remainder = final - paid;
    return {
      bookingId: uuid(), createdAt: isoAt(Math.min(dayOffset, 0) - int(1, 20)), status,
      name: c.name, phone: c.phone, email: c.email,
      serviceId: s.id, serviceName: s.name, employeeId: e.id, employeeName: e.name,
      calendarId: e.calendarId, eventId: `evt${uuid().replace(/-/g, '').slice(0, 20)}`,
      date: dateAt(dayOffset), time: `${String(int(9, 19)).padStart(2, '0')}:${pick(['00', '30'])}`,
      durationMinutes: String(s.durationMinutes || 30), price: money(price), amountPaid: money(paid),
      paymentType: fromBono ? 'bono' : (paid === price ? 'pagar total' : 'pagar reserva'),
      paymentIntentId: fromBono ? '' : `pi_test_${uuid().replace(/-/g, '').slice(0, 24)}`,
      lang: c.lang, reminderSent: past && chance(0.8) ? 'sent' : '', birthdate: c.birthdate,
      bonoId: fromBono ? fromBono.bonoId : '', sessionNumber: fromBono ? `${int(1, 3)}/3` : '',
      notes: chance(0.15) ? pick(['Piel sensible', 'Prefiere por la tarde', 'Primera visita']) : '',
      finalAmount: closed ? money(final) : '', remainderPaidHow: closed ? pick(['efectivo', 'tarjeta', 'bizum']) : '',
      remainderAmount2: split ? money(remainder / 2) : '', remainderPaidHow2: split ? 'efectivo' : '',
      redeemedAmount: closed && chance(0.1) ? '5.50' : '', termsAcceptedAt: chance(0.7) ? isoAt(Math.min(dayOffset, 0) - 1) : '',
      depositPaidHow: !fromBono && chance(0.1) ? 'bizum' : '',
      noShowForgiven: status === 'no_show_forgiven' ? '1' : '',
      deletedAsMistake: status === 'cancelled' && chance(0.1) ? '1' : '',
      depositPaidDate: chance(0.05) ? dateAt(dayOffset - 3) : '',
      confirmationEmailSent: status === 'confirmed' && chance(0.9) ? '1' : '',
      depositAmount2: '', depositPaidHow2: '',
    };
  });

  // Saldo de fidelización (libro mayor)
  const loyalty = Array.from({ length: COUNTS.loyalty }, () => {
    const b = pick(bookings);
    const type = pick(['earn', 'earn', 'earn', 'earn', 'redeem', 'reversal', 'manual_adjustment']);
    const base = Number(b.price);
    const rate = type === 'earn' ? pick(['0.05', '0.07']) : '';
    const amount = type === 'earn' ? Math.round(base * Number(rate) * 100) / 100 : int(1, 15);
    return {
      date: dateAt(int(-500, 0)), phoneNormalized: normalizePhone(b.phone), emailNormalized: normalizeEmail(b.email),
      name: b.name, type, bookingId: type === 'manual_adjustment' ? '' : b.bookingId,
      serviceName: b.serviceName, category: pick(['facial', 'corporal', 'laser', 'cejas', 'venta']),
      baseAmount: type === 'earn' ? money(base) : '', paidHow: type === 'earn' ? pick(['efectivo', 'tarjeta']) : '',
      rateApplied: rate, amount: money(amount), note: type === 'manual_adjustment' ? 'Ajuste de prueba' : '',
    };
  });

  const gifts = Array.from({ length: COUNTS.gifts }, (_, i) => {
    const buyer = pick(clients);
    const s = pick(services);
    const byService = chance(0.5);
    const redeemed = chance(0.3);
    return {
      bonoId: uuid(), code: `PRUEBA-${String(i).padStart(4, '0')}`, createdAt: isoAt(-int(1, 300)),
      status: redeemed ? 'redeemed' : 'purchased', buyerName: buyer.name, buyerEmail: buyer.email,
      buyerPhone: buyer.phone, recipientName: `${pick(FIRST)} ${pick(LAST)}`,
      giftType: byService ? 'service' : 'amount', serviceId: byService ? s.id : '', serviceName: byService ? s.name : '',
      amount: money(byService ? s.price : pick([30, 50, 75, 100])), message: chance(0.5) ? '¡Feliz cumpleaños!' : '',
      expiryDate: dateAt(int(30, 365)), paymentIntentId: `pi_test_${uuid().replace(/-/g, '').slice(0, 24)}`,
      lang: buyer.lang, redeemedAt: redeemed ? isoAt(-int(0, 30)) : '',
    };
  });

  const withBirthdate = clients.filter((c) => c.birthdate);
  const birthdays = withBirthdate.slice(0, COUNTS.birthdays).map((c) => ({
    emailNormalized: normalizeEmail(c.email), phoneNormalized: normalizePhone(c.phone), name: c.name,
    birthdate: c.birthdate, lastSentYear: pick(['2024', '2025', '2026']),
  }));

  const unsubscribes = Array.from({ length: COUNTS.unsubscribes }, () => ({
    emailNormalized: normalizeEmail(pick(clients).email), unsubscribedAt: isoAt(-int(1, 200)),
  }));

  const strikes = Array.from({ length: COUNTS.strikes }, (_, i) => {
    const c = clients[i * 7 % clients.length];
    return {
      phoneNormalized: normalizePhone(c.phone), emailNormalized: normalizeEmail(c.email), name: c.name,
      strikeCount: String(int(0, 3)), lastStrikeDate: chance(0.8) ? dateAt(-int(1, 300)) : '',
    };
  });

  const productSales = Array.from({ length: COUNTS.productSales }, () => {
    const linked = chance(0.3) ? pick(bookings) : null;
    const c = chance(0.6) ? pick(clients) : null;
    return {
      saleId: uuid(), createdAt: isoAt(-int(1, 300)), date: dateAt(-int(1, 300)),
      product: pick(['Crema hidratante', 'Sérum vitamina C', 'Protector solar', 'Aceite corporal']),
      amount: money(pick([12.5, 18, 24.9, 35])), paidHow: pick(['efectivo', 'tarjeta', 'bizum']),
      notes: '', category: pick(['venta', 'venta', 'facial', 'corporal']), bookingId: linked ? linked.bookingId : '',
      status: chance(0.1) ? 'deleted' : 'active', clientPhone: c ? c.phone : '', clientName: c ? c.name : '',
      clientEmail: c ? c.email : '',
    };
  });

  const quotes = Array.from({ length: COUNTS.quotes }, () => {
    const c = pick(clients);
    const paid = chance(0.6);
    return {
      quoteId: uuid(), createdAt: isoAt(-int(1, 200)), clientName: c.name, clientPhone: c.phone,
      clientEmail: c.email, description: pick(['Tratamiento combinado', 'Pack verano', 'Sesión doble']),
      category: pick(['facial', 'corporal', 'laser']), amount: money(int(60, 400)),
      status: paid ? 'paid' : 'pending', paidDate: paid ? dateAt(-int(0, 100)) : '',
      paymentIntentId: paid ? `pi_test_${uuid().replace(/-/g, '').slice(0, 24)}` : '', lang: c.lang,
    };
  });

  const discounts = Array.from({ length: COUNTS.discounts }, (_, i) => {
    const s = pick(services);
    const all = chance(0.3);
    return {
      discountId: uuid(), code: `DESCPRUEBA${i}`, serviceIds: all ? 'ALL' : s.id, serviceNames: all ? 'Todos' : s.name,
      discountType: pick(['percent', 'fixed']), discountValue: pick(['10', '15', '20', '7.5']),
      validFrom: dateAt(-int(10, 60)), validUntil: dateAt(int(-5, 60)), active: pick(['true', 'true', 'false']),
      createdAt: isoAt(-int(10, 60)), note: '', emailSentAt: chance(0.3) ? isoAt(-int(1, 9)) : '',
      appliesTo: pick(['', 'loose', 'bono', 'both']),
    };
  });

  const followups = Array.from({ length: COUNTS.followups }, () => {
    const c = pick(clients);
    return {
      followupId: uuid(), createdAt: isoAt(-int(1, 60)), clientName: c.name, clientPhone: c.phone,
      clientEmail: c.email, note: pick(['Llamar en 1 semana', 'Preguntar cómo le fue', 'Ofrecer bono']),
      dueDate: dateAt(int(-10, 30)), status: pick(['pending', 'pending', 'done']),
    };
  });

  return { bookings, gifts, birthdays, unsubscribes, sessionBonos, strikes, loyalty, productSales, quotes, discounts, followups };
}

module.exports = { generate, COUNTS };

if (require.main === module) {
  const i = process.argv.indexOf('--semilla');
  const seed = i > -1 ? Number(process.argv[i + 1]) : 42;
  const data = generate({ seed });
  const dir = path.join(__dirname, '.out');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'fake-data.json'), JSON.stringify(data, null, 1));
  console.log(`Datos inventados (semilla ${seed}) → tools/.out/fake-data.json`);
  for (const [k, v] of Object.entries(data)) console.log(`  ${k.padEnd(14)} ${v.length}`);
}
