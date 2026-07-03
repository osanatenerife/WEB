# Puesta en marcha del sistema de reservas y pago de Osana

Esta guía asume que no has hecho esto antes — ve paso a paso, sin saltarte ninguno.
Al final tendrás: reservas online con selección de tratamiento, profesional y hora
(sincronizado con Google Calendar) y cobro con Stripe (seña o total, según cada
tratamiento).

---

## Resumen de lo que vas a crear

1. Una **cuenta de servicio de Google** — es como un "robot" al que cada
   empleada le da permiso para leer/escribir en su Google Calendar.
2. Un **backend** (este código, `booking-api/`) desplegado en **Render**
   (gratis para empezar) — es el que habla con Stripe y Google de forma segura.
3. Un **webhook de Stripe** — para que Stripe avise al backend cuando un
   pago se completa (y así confirmar la cita automáticamente).

---

## Paso 1 — Cuenta de servicio de Google (acceso a los calendarios)

1. Ve a [console.cloud.google.com](https://console.cloud.google.com/) e inicia
   sesión con tu cuenta de Google (la que uses para el negocio, o cualquiera).
2. Arriba a la izquierda, crea un **proyecto nuevo** (por ejemplo, "Osana Reservas").
3. En el buscador de arriba, escribe **"Google Calendar API"** y ábrela → pulsa
   **Habilitar**.
4. Ve a **"Credenciales"** (menú izquierdo) → **Crear credenciales** →
   **Cuenta de servicio**.
5. Ponle un nombre (ej. "osana-calendar-bot") y pulsa **Crear y continuar**,
   luego **Listo** (no hace falta darle ningún rol).
6. Entra en la cuenta de servicio que acabas de crear → pestaña **Claves** →
   **Agregar clave** → **Crear clave nueva** → tipo **JSON** → **Crear**.
   Esto descarga un archivo `.json` a tu ordenador. **Guárdalo bien, no lo
   subas nunca a internet ni lo compartas** — es como una contraseña.
7. Abre ese archivo `.json` con un editor de texto y copia un dato:
   el valor de `"client_email"` (algo como
   `osana-calendar-bot@osana-reservas-123456.iam.gserviceaccount.com`).
   Ese email es el que vas a compartir en el paso 2.

## Paso 2 — Compartir el calendario de cada empleada

Cada empleada tiene que hacer esto una vez, desde su propio Google Calendar
(no hace falta que se cree ninguna cuenta nueva ni que instale nada):

1. Entrar en [calendar.google.com](https://calendar.google.com) con su cuenta.
2. En "Mis calendarios" (barra izquierda), pasar el ratón por su calendario →
   los tres puntos → **Configuración y uso compartido**.
3. Bajar hasta **"Compartir con determinadas personas"** → **Agregar personas**.
4. Pegar el email de la cuenta de servicio (el `client_email` del paso 1.7).
5. En permisos, elegir **"Hacer cambios en los eventos"**.
6. Guardar.

Repite esto por cada empleada. Apunta el email de Google de cada una — lo
necesitas en el paso 3.

## Paso 3 — Rellenar los datos reales del negocio

Edita estos archivos (son texto plano, no hace falta saber programar,
solo respetar las comillas y comas):

- `booking-api/src/config/employees.js` → pon el nombre real y el
  `calendarId` (el email de Google) de cada empleada.
- `booking-api/src/config/services.js` → revisa/añade los tratamientos
  reales, precio, duración en minutos, y el tipo de pago
  (`deposit_required`, `full_required` o `deposit_or_full`) y el
  porcentaje de seña.
- `booking-api/src/config/hours.js` → horario real de apertura.
- `booking-api/src/config/extras.js` → extras opcionales que el
  cliente puede añadir a un tratamiento (por ejemplo, ampliar una
  zona o un tiempo extra), con su precio y duración. Si un extra
  vale para cualquier tratamiento, deja `applicableServices: []`.

## Paso 4 — Desplegar el backend en Render

1. Crea una cuenta gratis en [render.com](https://render.com) (puedes
   entrar directamente con tu cuenta de GitHub).
2. **New +** → **Web Service**.
3. Conecta el repositorio `osanatenerife/web` (dale acceso si te lo pide).
4. Configura:
   - **Root Directory**: `booking-api`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free
5. En **Environment Variables**, añade (usa `booking-api/.env.example`
   como referencia):
   - `STRIPE_SECRET_KEY` → tu clave secreta de Stripe (empieza probando
     con la de **test**, la real es para cuando ya lo hayas probado todo)
   - `STRIPE_WEBHOOK_SECRET` → lo rellenas en el paso 5, de momento
     pon cualquier texto, luego lo actualizas
   - `GOOGLE_SERVICE_ACCOUNT_JSON` → abre el archivo `.json` del paso 1.6,
     copia **todo su contenido** y pégalo aquí tal cual (todo en una línea)
   - `FRONTEND_URL` → `https://osana.es` (o el dominio real de tu web)
6. Pulsa **Create Web Service** y espera a que despliegue. Cuando termine,
   Render te da una URL tipo `https://osana-booking-api.onrender.com`.

> Nota: en el plan gratuito, Render "duerme" el servicio si nadie lo usa
> durante un rato, y tarda unos segundos en despertar en la siguiente
> visita. Si eso molesta, puedes pasar a un plan de pago más adelante.

## Paso 5 — Webhook de Stripe

1. Entra en tu [Dashboard de Stripe](https://dashboard.stripe.com/) →
   **Developers** → **Webhooks** → **Add endpoint**.
2. En "Endpoint URL" pon: `https://TU-URL-DE-RENDER.onrender.com/api/webhook/stripe`
3. En eventos a escuchar, añade `checkout.session.completed` y
   `checkout.session.expired`.
4. Al crear el endpoint, Stripe te da un **"Signing secret"**
   (`whsec_...`) — cópialo y actualiza la variable `STRIPE_WEBHOOK_SECRET`
   en Render (Environment → editar → Save, Render redesplegará solo).

## Paso 6 — Conectar la web con el backend

Edita `js/booking-config.js` en la raíz del proyecto y cambia la URL por
la real de Render:

```js
const BOOKING_API_BASE = "https://TU-URL-DE-RENDER.onrender.com/api";
```

Sube este cambio (o dímelo y lo hago yo) y publica la web.

## Paso 7 — Probar antes de cobrar de verdad

1. Con `STRIPE_SECRET_KEY` en modo **test** (`sk_test_...`), abre
   `reserva.html`, haz una reserva completa. Al llegar al pago, usa la
   [tarjeta de pruebas de Stripe](https://stripe.com/docs/testing):
   número `4242 4242 4242 4242`, cualquier fecha futura y cualquier CVC.
2. Comprueba que:
   - Se crea el evento en el Google Calendar de la empleada.
   - Tras "pagar", el evento pasa a "✅ Confirmada" (verde).
   - Si cancelas el pago o esperas 30 min sin pagar, el hueco se libera.
3. Cuando todo funcione, cambia `STRIPE_SECRET_KEY` a tu clave **real**
   (`sk_live_...`) en Render, y ya está cobrando de verdad.

---

## Preguntas frecuentes

**¿Puedo cambiar precios o añadir tratamientos después?**
Sí, edita `booking-api/src/config/services.js` y vuelve a desplegar
(Render lo hace solo en cuanto detecta el cambio en GitHub).

**¿Qué pasa si alguien no paga?**
El hueco queda bloqueado 30 minutos como "pendiente de pago"; si no se
completa el pago en ese tiempo, se libera automáticamente.

**¿Esto cuesta dinero?**
Render tiene plan gratuito para empezar. Stripe no cobra cuota fija,
solo una comisión por cada cobro (consulta las tarifas en tu país en
stripe.com/es/pricing).
