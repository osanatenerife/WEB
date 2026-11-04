# Reglas de limpieza para la importación

Fase 2 · paso 2. Cada regla de aquí se programa en `RULES` de
`tools/import-sheet.js`, que la aplica al importar (la Google Sheet no se
toca).

## Estado (29/10/2026): ninguna regla necesaria

La auditoría (`docs/AUDITORIA.md`) no encontró ninguna celda que Supabase
rechace. Las 4 celdas tecleadas a mano (Faltas D4; Saldo I199, I204,
L199) son números enteros: la titular lo comprobó en la Sheet. Se leen
igual hoy y en Supabase.

Los importes con punto decimal de la pestaña Saldo (p. ej. `3.15`) los
escribe la propia web y son correctos.

## Antes del día del cambio

Repetir `tools/audit-sheet.js --xlsx` con una descarga reciente. Si
aparece algo nuevo, se añade aquí la regla (pestaña, columna, problema,
corrección) y en `RULES`, y se ensaya en el lab.
