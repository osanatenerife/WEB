require('dotenv').config();
const express = require('express');
const cors = require('cors');

const webhookRouter = require('./src/routes/webhook');
const servicesRouter = require('./src/routes/services');
const availabilityRouter = require('./src/routes/availability');
const checkoutRouter = require('./src/routes/checkout');
const reviewsRouter = require('./src/routes/reviews');
const myBookingsRouter = require('./src/routes/myBookings');

const app = express();

const allowedOrigin = process.env.FRONTEND_URL || '*';
app.use(cors({ origin: allowedOrigin }));

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

app.get('/', (req, res) => {
  res.json({ ok: true, service: 'osana-booking-api' });
});

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Osana booking API escuchando en el puerto ${PORT}`);
});
