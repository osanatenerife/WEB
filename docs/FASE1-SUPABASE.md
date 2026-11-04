# Fase 1 — Supabase detrás de las mismas funciones

Rama: `fase-1-supabase` (repo `xsochef/osana-web-lab`). Nada de esto toca
el sitio real: por defecto el backend sigue usando la Google Sheet.

## Qué cambia

| Archivo | Qué hace |
|---|---|
| `booking-api/src/lib/db-schema.js` | Tablas, columnas y tipos. Fuente única. |
| `docs/SCHEMA.sql` | Generado con `node tools/gen-schema.js`. No editar a mano. |
| `booking-api/src/lib/db-supabase.js` | Las mismas 33 funciones que `sheets.js`, guardando en Supabase. |
| `booking-api/src/lib/sheets.js` | Solo el final: interruptor `DATA_BACKEND=sheets\|supabase` (por defecto `sheets`). |
| `booking-api/server.js` | Lee también `booking-api/.env.local` (solo existe en local). |
| `tools/fake-data.js` | Datos inventados con la estructura de las pestañas. |
| `tools/compare.js` | `sheets.js` real (sobre una hoja falsa en memoria) contra Supabase. |
| `tools/benchmark.js` | Tiempos de las operaciones principales. |

`panel.js`, `webhook.js` y las demás rutas **no se han tocado**.

## Cómo se mantiene el contrato

- Todo se devuelve como **texto**, igual que la Sheet (`''` si está vacío).
  Los `numeric` se leen como texto para no perder `"10.50"`.
- Los "booleanos" del código no son iguales en todas las columnas; cada
  una guarda su texto: `reminderSent` = `'sent'`, `noShowForgiven`,
  `deletedAsMistake`, `confirmationEmailSent` = `'1'`, `active` =
  `'true'`/`'false'`.
- `_sheetRow` = `row_id` (identity) de la tabla. El ID de negocio
  (`booking_id`, `bono_id`...) es `UNIQUE`.
- Misma caché de 25 s, y las mismas funciones releen la fila antes de
  escribir (o se fían de la caché) que en `sheets.js`.
- RLS activado sin políticas: solo la clave secreta del servidor accede.
  Las claves públicas reciben 401.

## Diferencia de comportamiento conocida

La Sheet acepta cualquier texto en cualquier celda. Supabase rechaza con
un error claro un valor que no encaja en el tipo de la columna (p. ej.
fecha `31/12/2026`, importe `10,5`, `reminderSent: 'yes'`). Con lo que
escribe el código hoy no pasa (comprobado), pero **los datos reales que
se hayan editado a mano en la Sheet habrá que limpiarlos al importarlos**
(Fase 2).

## Cómo probarlo en local

1. `cd booking-api && npm ci`
2. Copiar `booking-api/.env.local.example` → `booking-api/.env.local` y
   rellenar `SUPABASE_URL` y `SUPABASE_SECRET_KEY` del proyecto de PRUEBA.
3. `node tools/compare.js` → debe terminar en `SIN DIFERENCIAS`.
4. `DATA_BACKEND=supabase node tools/benchmark.js --cargar`
5. `cd booking-api && npm start` → backend en `http://localhost:3001` con
   Supabase.

Proyecto de prueba: `osana-lab` (región `eu-central-1`, Frankfurt),
organización "Osana Lab", plan Free.

## Resultados (29/10/2026, datos inventados, 700 reservas)

`compare.js`: **sin diferencias** — mismas columnas en las 11 pestañas,
33 funciones, 17 lecturas sobre 1.725 filas y 22 escenarios de escritura.

`benchmark.js` (Supabase, 10 medidas, caché vacía salvo donde se indica):

| Operación | Mediana | p95 |
|---|---|---|
| Buscar clienta (5 tablas, como `/panel/search`) | 280 ms | 338 ms |
| Buscar clienta (con caché) | 39 ms | 41 ms |
| Crear reserva | 81 ms | 90 ms |
| Actualizar pago (buscar + actualizar) | 417 ms | 445 ms |
| Calcular saldo | 128 ms | 159 ms |

Sin medir aún con la Google Sheet ("antes"): hace falta una hoja de
PRUEBA (ver preguntas abiertas).

Las funciones siguen leyendo la tabla entera, igual que con la Sheet (por
eso "Actualizar pago" lee las 700 reservas). Es a propósito: en Fase 1 el
comportamiento debe ser idéntico. Buscar por ID directamente en la base
es la mejora natural de la Fase 2.
