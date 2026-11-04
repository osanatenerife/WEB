# Escaleta del cambio de Google Sheet a Supabase

Para la noche del cambio (`docs/FASE2-PLAN.md`, paso 6). Duración prevista:
1 hora. **Si un punto marcado con ⛔ no da lo esperado, se para ahí** y se
vuelve atrás como dice ese punto. Nadie improvisa.

Personas: **T** = titular (Render, Sheet, claves) · **D** = quien lanza los
comandos en el Mac con el repositorio.

## Antes de esa noche (días antes)

- [ ] **Código en el repo real.** T aplica el paquete de entrega
      (`consegna-fase-2.patch`). No cambia nada mientras no se activen las
      variables: sin `DATA_BACKEND` se sigue usando la Sheet. Después del
      despliegue, comprobar `https://osana-9pub.onrender.com/health` y hacer
      una búsqueda en el panel.
- [x] **Ensayo de vuelta atrás** con datos inventados en una Sheet de prueba
      (04/11/2026): *Reemplazar hoja de cálculo* conserva los datos, sin
      diferencias. Falta comprobar con la API de Google que el backend lee
      la hoja reemplazada (se comprueba en la vuelta atrás, paso 6).
- [ ] **Privacidad (RGPD):** T aprueba a Supabase como proveedor y actualiza
      el aviso legal.
- [ ] **Clave de importación:** en `osana-produccion` → Project Settings →
      API Keys, T crea una clave secreta nueva solo para esa noche. Se revoca
      al terminar. La de Render es otra.
- [ ] **Fecha** decidida y equipo avisado.

## La noche del cambio

| # | Min | Quién | Qué hacer | Resultado esperado |
|---|---|---|---|---|
| 1 | 0 | T | Comprobar que no hay nadie usando el panel. | Equipo avisado. |
| 2 | 5 | T | Render → Environment → `DATA_READONLY=1` → guardar y esperar al despliegue. | Log: `DATA_READONLY=1: modo solo lectura`. |
| 3 | 10 | D | Comprobar: `curl -i -X POST https://osana-9pub.onrender.com/api/webhook/stripe` | ⛔ `503`. Si no: quitar la variable y parar. |
| 4 | 12 | T | Descargar la Sheet **original** como .xlsx, en Descargas. Debe ser **después** del paso 2. | Archivo con la hora actual. |
| 5 | 15 | D | `node tools/audit-sheet.js --xlsx "<archivo>"` | ⛔ 0 celdas a revisar, cabeceras ok, 0 IDs repetidos. Si no: quitar `DATA_READONLY` y parar. |
| 6 | 18 | T+D | En `booking-api/.env.local`: `SUPABASE_URL` de producción y `SUPABASE_SECRET_KEY` la clave de importación (la pega T). **Quitar `LAB_ALLOW_WIPE`**. | `grep -c LAB_ALLOW_WIPE` no muestra la variable activa. |
| 7 | 20 | D | `node tools/import-sheet.js --xlsx "<archivo>" --destino uhggazgerwkpaiguhvdr --simular` y, si va bien, otra vez sin `--simular`. **Nunca `--vaciar`.** | ⛔ Mismas filas en cada tabla. Si no: quitar `DATA_READONLY` y parar. |
| 8 | 25 | D | `node tools/verify-import.js --xlsx "<archivo>"` | ⛔ `IMPORTACIÓN VERIFICADA: sin diferencias`. Si no: quitar `DATA_READONLY` y parar. Producción sigue en la Sheet. |
| 9 | 30 | T | Render → Environment: `DATA_BACKEND=supabase`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (la de Render) y **quitar `DATA_READONLY`** → guardar y esperar al despliegue. | Log sin errores. |
| 10 | 35 | T | Panel: buscar una clienta conocida, abrir agenda y saldo. | ⛔ Datos correctos. Si no: ver "Vuelta atrás". |
| 11 | 40 | T | Crear un seguimiento de prueba en el panel y marcarlo como hecho. | ⛔ Aparece en Supabase → tabla `seguimientos`. |
| 12 | 45 | T | Hacer una reserva real pequeña o un bono de prueba, pagando con Stripe. | ⛔ Aparece en `reservas` y el evento en el Calendar. |
| 13 | 50 | T | Stripe → Developers → Webhooks → eventos de la ventana. | Los que dieron 503 entran al reintentar. Los reintentos pueden tardar: volver a mirar por la mañana. |
| 14 | 55 | T+D | Revocar la clave de importación. Devolver `.env.local` al lab. Papelera: borrar el Excel. | Sin datos reales ni claves de producción en el Mac. |

**Efectos normales durante la ventana:** la web da error al reservar o
cancelar, y el panel al guardar. La tarea de recordatorios falla si cae dentro
(GitHub puede avisar por email) y los manda en su siguiente ejecución.

## Vuelta atrás

**Hasta el paso 8:** quitar `DATA_READONLY` en Render. Nada ha cambiado.

**Después del paso 9, sin que hayan entrado datos nuevos:** en Render,
`DATA_BACKEND=sheets` → desplegar. La Sheet sigue intacta.

**Después del paso 9, con datos nuevos en Supabase:**

1. Render: `DATA_READONLY=1` → desplegar.
2. `node tools/export-to-xlsx.js`
3. `node tools/verify-import.js --xlsx "<export>"` → sin diferencias.
4. Sheet original: Archivo → Importar → *Reemplazar hoja de cálculo*. Antes,
   hacer una copia de la Sheet por seguridad. **La opción por defecto es
   "Crear hoja de cálculo nueva": hay que cambiarla.** Después, la dirección
   de la Sheet debe tener el mismo ID. Si cambia, se ha creado otra hoja y la
   web no la usará.
5. Render: `DATA_BACKEND=sheets` y quitar `DATA_READONLY` → desplegar.
6. Volver a probar el panel.

Plazo garantizado: 7 días tras el cambio.

## Por la mañana

- [ ] Recordatorios de la noche enviados (`/send-reminders` sin errores en
      GitHub Actions).
- [ ] Stripe sin eventos pendientes.
- [ ] Revisar logs de Render: ninguna línea `Valor no compatible para`. Si
      aparece, el código intentó guardar un valor que la Sheet aceptaba y
      Supabase no: avisar y mirar esa columna.
