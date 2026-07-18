// Algunos hostings (Render incluido) tienen la salida IPv6 rota o muy lenta
// hacia ciertas APIs externas (Stripe entre ellas), y Node por defecto puede
// preferir IPv6 al resolver el dominio. Eso se manifiesta como "An error
// occurred with our connection to Stripe" aunque la clave sea correcta.
// Forzamos IPv4 primero para evitarlo.
require('dns').setDefaultResultOrder('ipv4first');

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const webhookRouter = require('./src/routes/webhook');
const servicesRouter = require('./src/routes/services');
const availabilityRouter = require('./src/routes/availability');
const checkoutRouter = require('./src/routes/checkout');
const reviewsRouter = require('./src/routes/reviews');
const myBookingsRouter = require('./src/routes/myBookings');
const remindersRouter = require('./src/routes/reminders');
const giftRouter = require('./src/routes/gift');
const birthdaysRouter = require('./src/routes/birthdays');
const bonoCheckoutRouter = require('./src/routes/bonoCheckout');
const panelRouter = require('./src/routes/panel');
const whatsappIncomingRouter = require('./src/routes/whatsappIncoming');
const addTreatmentRouter = require('./src/routes/addTreatment');

const app = express();

// Esta API la llaman los navegadores de los visitantes públicamente (no hay
// sesiones ni cookies de por medio), así que no restringimos CORS a un único
// origen — eso solo rompería las pruebas locales o desde otro dominio/hosting
// sin aportar seguridad real. FRONTEND_URL se usa aparte solo para construir
// las URLs de éxito/cancelación de Stripe (ver src/lib/origin.js).
app.use(cors({ origin: true }));

// El webhook de Stripe necesita el cuerpo SIN parsear (raw) para poder
// verificar la firma — por eso usa su propio parser "raw" y se monta
// antes de express.json() (que si no, se comería el cuerpo primero).
app.use('/api/webhook/stripe', express.raw({ type: 'application/json' }));
app.use('/api', webhookRouter);

app.use(express.json());
app.use('/api', servicesRouter);
app.use('/api', availabilityRouter);
app.use('/api', checkoutRouter);
app.use('/api', reviewsRouter);
app.use('/api', myBookingsRouter);
app.use('/api', remindersRouter);
app.use('/api', giftRouter);
app.use('/api', birthdaysRouter);
app.use('/api', bonoCheckoutRouter);
app.use('/api', panelRouter);
app.use('/api', whatsappIncomingRouter);
app.use('/api', addTreatmentRouter);

app.get('/', (req, res) => {
  res.json({ ok: true, service: 'osana-booking-api' });
});

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Osana booking API escuchando en el puerto ${PORT}`);
});
