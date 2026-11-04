# Mapa de `booking-api/src/lib/sheets.js` (para la migración)

Este documento describe cómo el backend usa la Google Sheet como base de
datos. Sirve para planificar una migración (a otra Sheet o a una base de
datos real) sin romper nada. Solo describe el código actual; no lo cambia.

## 1. Cómo funciona (resumen)

- **Un solo documento**, indicado por `GOOGLE_SHEET_ID`. Se accede con la
  cuenta de servicio de Google (permiso `spreadsheets`, ver
  `src/lib/googleCalendar.js`).
- **Las columnas se leen por POSICIÓN, no por nombre de cabecera.** Cada
  pestaña tiene una lista fija de columnas en el código (`COLUMNS`,
  `GIFT_COLUMNS`...). La columna 1 del código es la columna A de la hoja,
  y así seguido. Los nombres de la fila 1 **nunca se leen**: solo se
  escriben.
- **La fila 1 se reescribe desde el código** (`ensureHeader` y los
  `ensure*Tab`) con los nombres del código, de forma idempotente. En la
  pestaña de reservas se reescribe antes de **cada** `appendBooking`. En
  bonos, bonos de sesiones, faltas, saldo, ventas, presupuestos,
  descuentos y seguimientos se reescribe una vez por arranque del
  servidor. En `Cumpleanos` y `Bajas` solo se escribe al crear la
  pestaña.
- **Las pestañas se crean solas** si no existen (excepto la principal).
- **Las filas se identifican por su número de fila real** (`_sheetRow`).
  Las actualizaciones escriben la fila entera en `A{n}:{última}{n}`.
- **Caché en memoria de 25 segundos** (`READ_CACHE_TTL_MS`) por pestaña,
  que se borra al escribir en esa misma pestaña. Es por proceso: si hubiera
  varias instancias del servidor, cada una tendría su caché.

### Consecuencias para la migración

| Riesgo | Detalle |
|---|---|
| Insertar, borrar o mover columnas en la Sheet | Rompe todo: los datos se leen por posición. Solo se pueden añadir columnas **al final** (como ya hace el código). |
| Renombrar cabeceras a mano | No sirve de nada: el código las vuelve a sobrescribir. |
| Borrar o reordenar filas a mano | Cambia los números de fila; las referencias en memoria (`_sheetRow`) se quedan desfasadas hasta que caduca la caché (25 s). |
| Ordenar la hoja con filtros | Igual que el anterior; no ordenar la hoja real. |
| Pestaña principal | Se toma **la primera pestaña** del documento (`sheets[0]`), sea cual sea su nombre. Si se reordenan las pestañas, el backend escribirá reservas en otra. |
| Fila vacía al final | `getAll*` descarta la fila 1 y trata el resto como datos; una fila vacía en medio se leería como un registro vacío. |
| Actualizar sin releer | `updateGiftRow`, `updateQuoteRow`, `updateDiscountRow`, `updateFollowupRow` y `updateLoyaltyMovementRow` combinan con el dato de la **caché** (hasta 25 s de antigüedad), no con una lectura nueva. `updateBookingRow`, `updateSessionBonoRow` y `updateProductSaleRow` sí releen la fila justo antes de escribir. |
| Sin transacciones | Dos peticiones simultáneas a la misma fila pueden pisarse (`lib/asyncLock.js` se usa en `checkout`, `bonoCheckout`, `myBookings`, `panel` y `webhook`, pero no dentro de `sheets.js`, y solo protege dentro de un mismo proceso). |
| Cuota de la API de Sheets | Cada lectura lee la pestaña entera. Con muchos datos será lenta. |

## 2. Pestañas

Leyenda de rutas: `/api/panel/...` se abrevia **P:**, `/api/my-bookings/...`
se abrevia **M:**. El webhook de Stripe es `POST /api/webhook/stripe`
(en `routes/webhook.js`); sus funciones internas se indican por nombre.

| Pestaña | Columnas | Última col. | Cómo se obtiene |
|---|---|---|---|
| **Primera pestaña** (reservas; nombre libre, se autodetecta) | 38 (`COLUMNS`) | AL | Por posición |
| `Bonos` (bonos regalo) | 17 | Q | Por posición |
| `Cumpleanos` | 5 | E | Por posición |
| `Bajas` (baja de emails comerciales) | 2 | B | Por posición |
| `BonosSesiones` (paquetes de sesiones) | 23 | W | Por posición |
| `Faltas` (ausencias) | 5 | E | Por posición |
| `Saldo` (fidelización, libro mayor) | 13 | M | Por posición |
| `VentasProducto` | 13 | M | Por posición |
| `Presupuestos` (pagos a medida) | 12 | L | Por posición |
| `Descuentos` (códigos) | 13 | M | Por posición |
| `Seguimientos` | 8 | H | Por posición |

> El comentario de cabecera de `sheets.js` dice que la pestaña de reservas
> llega hasta la columna V (22 columnas). Está desfasado: el array
> `COLUMNS` real tiene 38 (hasta AL). Manda el array.

## 3. Funciones exportadas

**L** = lee · **E** = escribe (añade fila o modifica una existente).

### Pestaña principal (reservas)

| Función | Pestaña | L/E | Rutas / funciones que la llaman |
|---|---|---|---|
| `appendBooking` | primera pestaña | E (añade) | M: book-bono-session-group · P: edit-booking, book-session, import-legacy-booking, book-combined-sessions · webhook: `handleBookingPayment`, `handleBonoSessionPayment` |
| `getAllBookings` | primera pestaña | L | `GET /api/send-birthday-emails` · `GET /api/send-reminders` · `GET /api/client-status` · M: (raíz) `GET /api/my-bookings`, history, cancel, reschedule, reschedule-group · P: search, edit-booking, reschedule, reschedule-combined, reassign-employee, visit-duration, edit-client, no-show, delete-booking, report, agenda, agenda-summary, payments-log · panel `getUniqueClientEmails` · webhook `handleBonoSessionPayment` |
| `findBookingById` | primera pestaña (vía `getAllBookings`) | L | `POST /api/my-bookings/add-treatment` · M: slots, cancel, reschedule, `loadRescheduleGroup` · P: note, edit-booking, reschedule-slots, reschedule, reschedule-combined, reassign-employee, extend-time, visit-duration, close, redeem, no-show, delete-booking · webhook: `sendBookingConfirmationEmail`, `handleBookingPayment`, `handleBonoSessionPayment`, `handleAddonTreatmentPayment` |
| `updateBookingRow` | primera pestaña | L + E (relee la fila y la reescribe) | `GET /api/send-reminders` · M: cancel, reschedule, reschedule-group · P: note, edit-booking, reschedule, reschedule-combined, reassign-employee, extend-time, visit-duration, close, edit-client, no-show, delete-booking · webhook: `sendBookingConfirmationEmail`, `handleBookingPayment`, `handleBonoSessionPayment`, `handleAddonTreatmentPayment` |

### Bonos regalo (`Bonos`)

| Función | L/E | Rutas / funciones |
|---|---|---|
| `appendGift` | E (añade) | webhook `handleGiftPayment` |
| `getAllGifts` | L | P: close, gift, gift-redeem · webhook `handleGiftPayment` |
| `updateGiftRow` | E (usa la caché) | P: close, gift-redeem |

### Cumpleaños (`Cumpleanos`) y bajas (`Bajas`)

| Función | L/E | Rutas / funciones |
|---|---|---|
| `getAllBirthdayRecords` | L | `GET /api/send-birthday-emails` |
| `upsertBirthdayRecord` | E (actualiza o añade) | `GET /api/send-birthday-emails` |
| `getAllUnsubscribedEmails` | L | `GET /api/send-birthday-emails` · P: campaign-email |
| `appendUnsubscribe` | E (añade) | `GET /api/unsubscribe` (en `routes/services.js`) |

### Bonos de sesiones (`BonosSesiones`)

| Función | L/E | Rutas / funciones |
|---|---|---|
| `appendSessionBono` | E (añade) | P: edit-booking, import-legacy-booking · webhook `handleBonoSessionPayment` |
| `getAllSessionBonos` | L | `GET /api/my-bookings` · P: search, edit-client, agenda, agenda-summary |
| `findSessionBonoById` | L (vía `getAllSessionBonos`) | M: cancel, `loadPendingBonoGroup` · P: edit-booking, book-session, close, no-show, delete-booking, edit-bono, book-combined-sessions |
| `updateSessionBonoRow` | L + E (relee la fila) | M: book-bono-session-group, cancel · P: edit-booking, book-session, close, edit-client, no-show, delete-booking, edit-bono, book-combined-sessions |

### Faltas (`Faltas`)

| Función | L/E | Rutas / funciones |
|---|---|---|
| `getAllStrikeRecords` | L | `GET /api/my-bookings` · M: reschedule, reschedule-group · P: search, edit-client, no-show, edit-strikes |
| `upsertStrikeRecord` | E (actualiza o añade) | M: reschedule, reschedule-group · P: edit-client, no-show, edit-strikes |

### Saldo de fidelización (`Saldo`)

| Función | L/E | Rutas / funciones |
|---|---|---|
| `appendLoyaltyMovement` | E (añade) | P: close, redeem, loyalty-adjust · webhook `handleCustomQuotePayment` · `lib/loyaltyEarn.js`: `earnLoyalty`, `reverseLoyaltyForBooking` |
| `getAllLoyaltyMovements` | L | P: search, edit-client · `lib/loyaltyEarn.js`: `reverseLoyaltyForBooking` |
| `getLoyaltyMovementsForPhone` | L (filtra la lectura de `getAllLoyaltyMovements`) | `GET /api/my-bookings` · P: close, redeem, loyalty-adjust · webhook `loyaltyBalanceLine` |
| `updateLoyaltyMovementRow` | E (usa la caché) | P: edit-client |

### Ventas de producto (`VentasProducto`)

| Función | L/E | Rutas / funciones |
|---|---|---|
| `appendProductSale` | E (añade) | P: product-sale |
| `getAllProductSales` | L (oculta las de `status = deleted`) | P: search, close, product-sale-edit, report, agenda, agenda-summary, payments-log |
| `updateProductSaleRow` | L + E (relee la fila) | P: close, product-sale-edit |

### Seguimientos (`Seguimientos`)

| Función | L/E | Rutas / funciones |
|---|---|---|
| `appendFollowup` | E (añade) | P: followup |
| `getAllFollowups` | L | P: followup-done, agenda |
| `updateFollowupRow` | E (usa la caché) | P: followup-done |

### Presupuestos (`Presupuestos`)

| Función | L/E | Rutas / funciones |
|---|---|---|
| `appendCustomQuote` | E (añade) | P: custom-quote |
| `getAllCustomQuotes` | L | P: report, agenda · webhook `handleCustomQuotePayment` |
| `updateQuoteRow` | E (usa la caché) | webhook `handleCustomQuotePayment` |

### Descuentos (`Descuentos`)

| Función | L/E | Rutas / funciones |
|---|---|---|
| `appendDiscount` | E (añade) | P: discount |
| `getAllDiscounts` | L | P: discount, discounts, discount-deactivate, discount-email-blast · `lib/discounts.js`: `resolveDiscount` (se usa al calcular precios en el checkout) |
| `updateDiscountRow` | E (usa la caché) | P: discount-deactivate, discount-email-blast |

### Funciones internas (no exportadas)

| Función | Pestaña | L/E | Uso |
|---|---|---|---|
| `getTabName` | primera pestaña | L (metadatos) | Detecta el nombre de la primera pestaña; se guarda en memoria del proceso |
| `ensureHeader` | primera pestaña | E (fila 1) | Antes de cada `appendBooking` |
| `ensureGiftTab`, `ensureBirthdayTab`, `ensureUnsubscribeTab`, `ensureSessionBonoTab`, `ensureStrikesTab`, `ensureLoyaltyTab`, `ensureProductSaleTab`, `ensureQuoteTab`, `ensureDiscountTab`, `ensureFollowupTab` | su pestaña | L (metadatos) + E (crean la pestaña y la fila 1) | Primera vez que se usa la pestaña tras arrancar el servidor |

## 4. Observaciones

1. **No hay otro acceso a Sheets fuera de `sheets.js`.** Se comprobó con
   una búsqueda en `booking-api/src` y `server.js`: ningún otro archivo
   llama a `spreadsheets.*`. Migrar `sheets.js` migra todo.
2. **El panel (`routes/panel.js`) concentra casi todas las escrituras.**
   Se protege con la variable `PANEL_SECRET`.
3. **El webhook de Stripe también escribe** (reservas, bonos, presupuestos,
   saldo). Una migración debe poder recibir esas escrituras sin perder
   eventos; Stripe reintenta si el endpoint falla.
4. **Datos personales:** las pestañas de reservas, bonos, bonos de
   sesiones, faltas, saldo, presupuestos, seguimientos, cumpleaños y
   ventas contienen nombre, teléfono, email y/o fecha de nacimiento.
   Para el entorno de prueba usa una hoja nueva con datos inventados.
5. **Config de la web:** `js/booking-config.js` apunta al backend **real**
   en Render (`BOOKING_API_BASE`). Un frontend de prueba debe apuntar a
   `http://localhost:3001/api` (o al backend de prueba) antes de usarlo,
   o escribirá en producción.

## 5. Preguntas abiertas

- ¿Cuántas filas tiene hoy la pestaña de reservas? (afecta a la velocidad
  de la lectura completa y al plan de migración).
- ¿Hay más de una instancia del backend en Render? (la caché es por proceso).
- ¿Alguien edita la Sheet a mano? (insertar columnas o reordenar rompería
  el backend).
