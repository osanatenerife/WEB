# Fase 2 — Pasar los datos reales a Supabase (plan)

Parte de la Fase 1 (`docs/FASE1-SUPABASE.md`): las 33 funciones ya
funcionan igual con Supabase, verificado con datos inventados.

## Estado (29/10/2026)

| Paso | Estado |
|---|---|
| 0. Decisiones | Supabase **Pro** para producción (decidido por la titular). Faltan: privacidad, ventana del cambio. |
| 1. Auditoría | **Hecho** — `docs/AUDITORIA.md`: 0 celdas incompatibles en 1.363 filas. Hecho con la copia descargada como Excel (`tools/audit-sheet.js --xlsx`), sin Google Cloud. |
| 2. Limpieza | **Hecho** — no hace falta ninguna regla (`docs/LIMPIEZA.md`). |
| 3. Scripts | **Hecho** — `tools/import-sheet.js` y `tools/verify-import.js`, probados en el lab con Excel inventado. La verificación detecta cada alteración plantada. |
| 4. Ensayo | **Hecho** (autorizado por escrito por la titular el 29/10/2026). Copia real importada en `osana-lab` en 6 s: 1.363 filas, verificación sin diferencias (701 reservas, 187 bonos, saldo de 212 clientas). Benchmark solo lectura con datos reales: buscar clienta 252 ms (8,5 ms con caché), calcular saldo 116 ms. La titular probó el panel. Después: lab vaciado y recargado con datos inventados (0 filas reales, comprobado), Excel a la papelera. |
| 5. Solo lectura | **Hecho y probado** — ver paso 5 (cambió el diseño: corte en la puerta del servidor). |
| 6. Día del cambio | Proyecto de producción **creado** el 04/11/2026 por la titular: organización OSANA (Pro), `osana-produccion`, ref `uhggazgerwkpaiguhvdr`, Frankfurt, sin datos. Render también está en Frankfurt. Esquema cargado y comprobado: huella `c9f40f7311c3cb8b9c4664a4a16869ef`, 223 elementos y 0 permisos públicos, igual que el lab. Pendiente: fecha de la ventana, llevar el código al repo real y la clave secreta en Render. |
| 7. Vuelta atrás | **Ensayado el 04/11/2026** con datos inventados: Excel de `export-to-xlsx.js` → Google Sheet de prueba → Importar → Reemplazar → descargado otra vez. Se conservan el ID del documento y el título, y Hoja 1 queda la primera. Sin celdas con tipo (Google no convirtió texto en números ni fechas) y `verify-import.js` sin diferencias. Los gid de las pestañas cambian, pero `sheets.js` no los usa. **Ojo:** la opción por defecto del diálogo es "Crear hoja de cálculo nueva", que da otro ID. No probado: que el backend lea por la API de Google la hoja reemplazada, ni que la cuenta de servicio conserve el acceso. |
| 8. Después | Pendiente. |

**Coordinación (04/11/2026):** los cambios recientes del repo real
(`osanatenerife/web`) los hace la titular. Los 3 commits hasta `312774f`
ya están en el lab y en el paquete de entrega. Si entran más, hay que
rehacer el paquete. Que el panel de `osana.es` vaya por detrás del repo es
voluntario.

### Proyecto de producción (lo hace la titular)

Organización **nueva** "Osana", tipo Company, plan **Pro** (25 $/mes;
incluye 10 $ de cómputo, que cubren un proyecto Micro → 25 $/mes en
total; Spend Cap activado por defecto). Cuenta de la titular, con su
tarjeta y verificación en dos pasos. El desarrollador entra como
**Developer**. Proyecto `osana-produccion`, región Central EU
(Frankfurt). El esquema se carga con `docs/SCHEMA.sql` en el SQL Editor;
el conector de Claude **no** se autoriza en esta organización.

Cambio respecto al plan original: el origen de la importación es la Sheet
**descargada como .xlsx** (Archivo → Descargar), no la API de Google con
una cuenta de servicio. Es más simple y los datos no salen del Mac. El día
del cambio, la descarga se hace **después** de activar el modo solo
lectura, para que el Excel sea la foto exacta final.

Objetivo: que la web y el panel reales usen Supabase en vez de la Google
Sheet, **sin perder ni un dato y pudiendo volver atrás**.

Principios:

- La Google Sheet real **no se modifica nunca** durante la migración: es
  la copia de seguridad y la vía de vuelta.
- Primero se ensaya todo con una **copia** de la Sheet en el proyecto de
  prueba. Al proyecto de producción solo se llega con el ensayo superado.
- Cada paso con datos reales lo autoriza la titular, por escrito, antes de
  hacerlo.
- Ningún cambio de código de negocio (precios, calendarios, pagos).

---

## Paso 0 — Decisiones previas (titular)

| Decisión | Opciones | Recomendación |
|---|---|---|
| Plan de Supabase para producción | Free (0 $) o Pro (≈25 $/mes) | **Pro**. El Free se pausa tras 7 días sin uso y no tiene copias de seguridad diarias. Para los datos de las clientas no compensa. |
| Dónde vive el proyecto de producción | Organización nueva "Osana" (no "Osana Lab") | Organización **separada**, con la titular como propietaria y verificación en dos pasos activada. |
| Región | Central EU (Frankfurt) | Igual que el lab: datos dentro de la UE. |
| Aviso legal / privacidad | Añadir Supabase como encargado del tratamiento | Revisar con quien lleve la protección de datos (RGPD). Supabase ofrece contrato de encargado (DPA). |
| Ventana del cambio | Una noche de poco movimiento | Domingo por la noche, ~1 hora. |

## Paso 1 — Auditoría de la Sheet real (solo lectura)

Problema conocido: la Sheet acepta cualquier texto; Supabase rechaza lo
que no encaja en el tipo (fecha `31/12/2026`, importe `10,5`, un flag
escrito a mano como `sí`...). Hay que saber cuántos casos hay **antes**.

1. La titular hace **una copia** de la Sheet (Archivo → Hacer una copia) y
   la comparte, **solo como lector**, con una cuenta de servicio de Google
   nueva creada solo para esto.
2. Script nuevo `tools/audit-sheet.js` (por escribir): lee cada pestaña
   por posición, igual que `sheets.js`, pasa cada celda por los mismos
   conversores de `db-supabase.js` (`toDb`) y saca un informe:
   pestaña, columna, fila y **el patrón** del valor problemático (p. ej.
   `NN/NN/NNNN`). Nunca el valor en sí: el informe no contiene datos de
   clientas.
3. También revisa: IDs repetidos (`bookingId`, `bonoId`... deben ser
   únicos en Supabase), filas vacías en medio, pestañas con columnas de
   más o desordenadas, y que la primera pestaña sea la de reservas.

Resultado: `docs/AUDITORIA.md` con números (sin datos personales).

## Paso 2 — Reglas de limpieza (titular + desarrollo)

Por cada tipo de problema del informe se decide una regla y se escribe
en `docs/LIMPIEZA.md`. Ejemplos probables:

| Problema | Regla propuesta |
|---|---|
| Fecha `DD/MM/AAAA` | Convertir a `AAAA-MM-DD`. |
| Importe con coma `10,5` | Cambiar coma por punto. |
| Flag con otro texto (`si`, `x`, `TRUE`) | Mapear al valor que usa el código (`'1'`, `'sent'`...). |
| ID repetido | Revisar a mano con la titular cuál es la buena. |
| Valor imposible de interpretar | Se guarda en una tabla aparte `importacion_rechazos` y se decide a mano. |

La limpieza se aplica **durante la importación** (en el script), no
editando la Sheet. Así la Sheet sigue intacta.

## Paso 3 — Script de importación y verificación

Por escribir:

- `tools/import-sheet.js`: lee la Sheet (copia o real, solo lectura),
  aplica las reglas del paso 2 y carga cada pestaña en Supabase **en el
  mismo orden de filas**. Cuenta filas por pestaña y guarda un registro de
  cada transformación aplicada (fila, columna, regla), sin valores.
- `tools/verify-import.js`: lee los dos lados con las funciones de verdad
  (`sheets.js` contra la Sheet, `db-supabase.js` contra Supabase) y
  compara todas las lecturas, como el paso 3 de `compare.js`. Las únicas
  diferencias aceptadas son las de las reglas de limpieza, y se listan.

## Paso 4 — Ensayo general (proyecto de prueba)

1. Importar la **copia** de la Sheet en el proyecto `osana-lab`:
   `node tools/import-sheet.js --xlsx <archivo> --destino ykerfefyzkhsilgywxih --vaciar`
   y después `node tools/verify-import.js --xlsx <archivo>`.

   **Importante:** entonces el lab tendrá datos reales. Justo después de
   importar, quitar `LAB_ALLOW_WIPE` de `.env.local` (para que
   `compare.js` o `benchmark.js --cargar` no los pisen a mitad del
   ensayo) y no usar `compare.js`. Al terminar el ensayo: vaciar el lab,
   volver a cargar los datos inventados y borrar el Excel y la copia.
2. `verify-import.js` sin diferencias inesperadas.
3. `benchmark.js` con datos reales, y también con la Sheet (el "antes" que
   falta de la Fase 1).
4. La titular prueba el panel de prueba en local con sus datos reales:
   buscar clientas, agenda, informe trimestral, saldo.
5. Medir cuánto tarda la importación completa: es la duración de la
   ventana del paso 6.

## Paso 5 — Modo "solo lectura" para la ventana del cambio

Durante el cambio no debe entrar ninguna escritura en la Sheet que luego
falte en Supabase. Hoy escriben en la Sheet:

- el webhook de Stripe (reservas pagadas, bonos, presupuestos);
- "Mis reservas" (cancelar, cambiar de hora);
- el panel interno;
- las tareas automáticas (recordatorios cada hora, cumpleaños a las 8).

**Hecho** — `DATA_READONLY=1` (`booking-api/src/lib/readOnly.js`).

Corrección respecto a la primera idea: bloquear solo las escrituras en
`sheets.js` **no basta**, por dos motivos encontrados en el código:

- El webhook de Stripe atrapa cualquier error y responde **200** a
  propósito (`webhook.js`, "para que Stripe no reintente"). Un pago
  durante la ventana se perdería: Stripe no lo reintentaría.
- Varias rutas mandan un email o tocan el calendario **antes** de
  escribir. Ejemplo: los recordatorios mandan el email y después marcan
  `reminderSent`. Si la marca fallara, la clienta recibiría el
  recordatorio otra vez a la hora siguiente.

Por eso el corte va en la **puerta** del servidor (middleware en
`server.js`, antes de todas las rutas, sin tocar la lógica de pagos):

- Toda petición que no sea GET/HEAD/OPTIONS → **503** con
  `Retry-After`. Al webhook también: con un 503 **Stripe sí reintenta**
  solo, durante horas. No se pierde ningún pago.
- Los GET que escriben o mandan mensajes (`/send-reminders`,
  `/send-birthday-emails`, `/unsubscribe`, `/test-whatsapp`) → 503. Las
  tareas automáticas lo vuelven a intentar en su próxima ejecución.
- Segunda red: `sheets.js` rechaza las 19 funciones de escritura.

Probado en el lab (29/10/2026): las lecturas (servicios, búsqueda, agenda,
preflight CORS) responden 200/204; las escrituras (panel, webhook,
cancelar, checkout, crones, baja) responden 503; las 19 escrituras quedan
rechazadas y no entra nada en la base. Sin la variable todo funciona como
antes (escrituras OK y firma de Stripe comprobada).

Durante la ventana, la web pública muestra error al reservar o cancelar,
y el panel al guardar. Es de noche y dura minutos.

## Paso 6 — Día del cambio (≈1 hora)

Solo con los pasos 1–5 terminados y la autorización escrita de la
titular.

1. Avisar al equipo: no usar el panel durante la ventana.
2. En Render: `DATA_READONLY=1` → redesplegar. Comprobar que la web carga
   y que escribir da error 503.
3. **Después** del paso 2 (para que sea la foto final), descargar la Sheet
   real como .xlsx y pasar `audit-sheet.js --xlsx`: 0 celdas a revisar.
4. Importar en el proyecto Supabase de **producción**:
   `import-sheet.js --xlsx <archivo> --destino <ref de producción>` (sin
   `--vaciar`: las tablas de producción tienen que estar vacías).
5. `verify-import.js --xlsx <archivo>` → sin diferencias. **Si hay alguna:
   se para aquí**, se quita `DATA_READONLY` y todo sigue como antes.
6. En Render: `DATA_BACKEND=supabase`, `SUPABASE_URL`,
   `SUPABASE_SECRET_KEY` (la de producción, la pega la titular), y quitar
   `DATA_READONLY` → redesplegar.
7. Pruebas rápidas reales: buscar una clienta en el panel, abrir la
   agenda, hacer una reserva con pago real pequeño o con un bono regalo
   de prueba, y comprobar que aparece en Supabase.
8. En Stripe: comprobar que los reintentos del webhook de la ventana han
   entrado bien (Developers → Webhooks → eventos: los fallidos con 503
   deben aparecer después como entregados).

## Paso 7 — Vuelta atrás

| Cuándo | Cómo |
|---|---|
| Durante la ventana (antes del paso 5) | Quitar `DATA_READONLY`. Nada ha cambiado. |
| Después del cambio, con escrituras nuevas | 1) `DATA_READONLY=1` en Render. 2) `node tools/export-to-xlsx.js` (Supabase → Excel con la forma exacta de la Sheet). 3) `verify-import.js --xlsx` sobre ese Excel → sin diferencias. 4) La titular, en la Sheet **original**: Archivo → Importar → subir el Excel → **Reemplazar hoja de cálculo** (el ID no cambia). 5) En Render: `DATA_BACKEND=sheets`, quitar `DATA_READONLY` → redesplegar. Probado en el lab el 29/10/2026 hasta el punto 3 (ida y vuelta sin diferencias). **Falta ensayar el punto 4** en una copia de la Sheet. |
| Plazo | La vuelta atrás se garantiza durante **7 días**. Después, la Sheet queda como archivo de solo lectura. |

## Paso 8 — Después del cambio

- La Sheet real: quitarle el permiso de escritura a la cuenta de servicio y
  dejarla como archivo histórico.
- Copias de seguridad: las diarias de Supabase Pro, y además una
  exportación semanal fuera de Supabase.
- Rotar la clave secreta del lab y borrar el proyecto `osana-lab` si ya no
  hace falta.
- Fase 3 (opcional): buscar por ID directamente en la base en vez de leer
  tablas enteras (mucho más rápido, sobre todo "actualizar pago"), y
  transacciones para que dos escrituras a la vez no se pisen.

---

## Quién hace qué

| Tarea | Quién |
|---|---|
| Decisiones del paso 0, autorizaciones, pruebas en el panel | Titular |
| Copia de la Sheet, compartirla, pegar claves en Render | Titular (guiada paso a paso) |
| Scripts, ensayo, informes | Desarrollo (en `osana-web-lab`) |
| Pasar el código al repo real | Al final y por separado, sin la línea `localhost` de `js/booking-config.js` |

## Preguntas abiertas

1. ¿Supabase Free o Pro para producción?
2. ¿Quién lleva la protección de datos y tiene que aprobar el cambio de
   proveedor?
3. ¿Qué noche se puede parar el panel una hora?
4. ¿Se edita la Sheet a mano? ¿Quién, y en qué pestañas? (orienta la
   auditoría)
5. ¿Hay informes o personas que lean la Sheet directamente (contabilidad,
   gestoría)? Después del cambio dejarán de ver datos nuevos.
6. ¿Qué rama del repo real despliega Render?
