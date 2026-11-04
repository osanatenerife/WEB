# Auditoría de la copia de la Google Sheet

Generado por `tools/audit-sheet.js` el 2026-10-29 22:04. Solo lectura. **No contiene datos de clientas**: solo pestaña, columna, número de fila y el patrón del valor (dígitos → `N`, letras → `A`).

Pestañas en la copia, por orden: `Hoja 1`, `Cumpleanos`, `Faltas`, `Saldo`, `BonosSesiones`, `Bonos`, `Seguimientos`, `Presupuestos`, `Descuentos`, `VentasProducto`, `Bajas`. La primera (`Hoja 1`) es la que el código usa como reservas.

## Resumen

| Pestaña | Filas | Celdas que Supabase rechazaría | Celdas con tipo (a mano) | Cabecera distinta | Filas vacías en medio | Filas con celdas fuera de columnas | IDs repetidos | IDs vacíos |
|---|---|---|---|---|---|---|---|---|
| Hoja 1 | 701 | 0 | 0 | no | 0 | 0 | 0 | 0 |
| Bonos | 2 | 0 | 0 | no | 0 | 0 | 0 | 0 |
| Cumpleanos | 24 | 0 | 0 | no | 0 | 0 | — | — |
| Bajas | 2 | 0 | 0 | no | 0 | 0 | — | — |
| BonosSesiones | 187 | 0 | 0 | no | 0 | 0 | 0 | 0 |
| Faltas | 28 | 0 | 1 | no | 0 | 0 | — | — |
| Saldo | 391 | 0 | 3 | no | 0 | 0 | — | — |
| VentasProducto | 13 | 0 | 0 | no | 0 | 0 | 0 | 0 |
| Presupuestos | 8 | 0 | 0 | no | 0 | 0 | 0 | 0 |
| Descuentos | 7 | 0 | 0 | no | 0 | 0 | 0 | 0 |
| Seguimientos | 0 | 0 | 0 | no | 0 | 0 | — | — |

_Celdas con tipo_: en el Excel llegan como número, fecha, sí/no o fórmula. El código siempre escribe texto, así que esas las tecleó alguien a mano. En la Sheet se ven con el formato regional (p. ej. `10,5` o `31/12/2026`) y es lo que lee hoy el código: necesitan una regla de limpieza aunque algunas pasen el control.

## Conclusión (29/10/2026)

- **Ninguna celda** que Supabase rechace, en las 11 pestañas (1.363 filas).
- Cabeceras, orden de columnas e IDs: todo correcto. Ni filas vacías en
  medio ni datos fuera de columnas.
- Solo **4 celdas tecleadas a mano** como número (pestañas Faltas y Saldo).
  Pasan el control, pero hay que mirar en la Sheet cómo se ven: si una
  muestra coma decimal (p. ej. `12,5`), el código ya la lee hoy como `0`
  al calcular el saldo, y habría que corregirla en la importación.
- La pestaña de reservas es la primera (`Hoja 1`), como espera el código.
  El resto de pestañas está en otro orden, pero el código las busca por
  nombre, así que da igual.

Se puede pasar al paso 2 del plan con muy poca limpieza.

## Faltas → `faltas`

Celdas con tipo (tecleadas a mano):

| Columna | Tipo en el Excel | Celdas | Primeras filas |
|---|---|---|---|
| `strikeCount` | número | 1 | 4 |

## Saldo → `saldo_movimientos`

Celdas con tipo (tecleadas a mano):

| Columna | Tipo en el Excel | Celdas | Primeras filas |
|---|---|---|---|
| `baseAmount` | número | 2 | 199, 204 |
| `amount` | número | 1 | 199 |
