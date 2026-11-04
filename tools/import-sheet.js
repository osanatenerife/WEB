// ============================================================
// Fase 2 · Paso 3 — Importa la Google Sheet (descargada como .xlsx) en
// Supabase, pestaña por pestaña, en el MISMO orden de filas.
//
// - Lee cada fila por posición, como sheets.js (columna 1 del código =
//   columna A), incluidas las que el código oculta al leer (p. ej. ventas
//   con status "deleted"): no se pierde ninguna fila.
// - Aplica las reglas de limpieza de RULES (hoy ninguna: docs/AUDITORIA.md
//   no encontró celdas incompatibles).
// - Antes de escribir NADA comprueba todas las celdas. Si alguna no cabe,
//   para sin tocar Supabase.
// - Solo escribe en tablas VACÍAS, y solo en el proyecto que se indica con
//   --destino (tiene que coincidir con SUPABASE_URL de .env.local).
// - No imprime ni guarda ningún dato de clientas: solo conteos.
//
// Uso:
//   node tools/import-sheet.js --xlsx ~/Downloads/archivo.xlsx --destino <ref> --simular
//   node tools/import-sheet.js --xlsx ~/Downloads/archivo.xlsx --destino <ref>
//   (lab) añadir --vaciar para vaciar antes las tablas (exige LAB_ALLOW_WIPE)
// <ref> = el código del proyecto, lo que va antes de .supabase.co
// ============================================================
const fs = require('fs');
const path = require('path');
const { loadEnvLocal } = require('./lib/env');
const { loadSheetFromXlsx, tabObjects } = require('./lib/sheet-source');

const API = path.join(__dirname, '..', 'booking-api', 'src', 'lib');
const { TABLES } = require(path.join(API, 'db-schema.js'));

// Reglas de limpieza (docs/LIMPIEZA.md). Cada una: { tab, column, why, fix(value) → value }.
// Vacío a propósito: la auditoría del 29/10/2026 no encontró nada que limpiar.
const RULES = [];

const argValue = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };
const has = (name) => process.argv.includes(name);

async function main() {
  loadEnvLocal();
  const file = argValue('--xlsx');
  const destino = (argValue('--destino') || '').trim();
  const simulate = has('--simular');
  const url = process.env.SUPABASE_URL || '';
  const host = url ? new URL(url).host : '';
  if (!destino || host !== `${destino}.supabase.co`) {
    console.error(`--destino debe ser el código del proyecto de SUPABASE_URL (${host || 'sin configurar'}). Así no se importa por error en otro proyecto.`);
    process.exit(2);
  }

  const db = require(path.join(API, 'db-supabase.js'));
  const { fake, titles, typedCells } = await loadSheetFromXlsx(file);
  console.log(`Origen: Excel con ${titles.length} pestañas · ${typedCells} celdas tecleadas a mano`);
  console.log(`Destino: ${host}${simulate ? ' (SIMULACIÓN: no se escribe nada)' : ''}\n`);

  // 1. Preparar y comprobar todo antes de escribir.
  const plan = [];
  const problems = [];
  const cleaned = {};
  for (const [key, def] of Object.entries(TABLES)) {
    const title = key === 'bookings' ? titles[0] : def.tab;
    if (!titles.includes(title)) { plan.push({ key, def, title, objects: [], missing: true }); continue; }
    const objects = tabObjects(fake, title, def);
    objects.forEach((obj, i) => {
      for (const rule of RULES.filter((r) => r.tab === def.tab || (key === 'bookings' && r.tab === 'reservas'))) {
        const before = obj[rule.column];
        const after = rule.fix(before);
        if (after !== before) { obj[rule.column] = after; cleaned[`${def.table}.${rule.column}`] = (cleaned[`${def.table}.${rule.column}`] || 0) + 1; }
      }
      def.columns.forEach(([c, type]) => {
        try { db._lab.toDb(def.table, c, type, obj[c]); } catch (_) { problems.push(`${title} fila ${i + 2}, columna ${c}`); }
      });
    });
    plan.push({ key, def, title, objects });
  }
  if (problems.length) {
    console.error(`${problems.length} celdas no caben en Supabase. No se ha escrito nada. Primeras:`);
    problems.slice(0, 20).forEach((p) => console.error(`  - ${p}`));
    console.error('Ejecuta tools/audit-sheet.js para ver los patrones y añade una regla en RULES.');
    process.exit(1);
  }

  // 2. Las tablas de destino tienen que estar vacías.
  if (!simulate) {
    if (has('--vaciar')) {
      await db._lab.wipeAll(); // exige LAB_ALLOW_WIPE=si-borrar-todo
    } else {
      const busy = [];
      for (const { key, def } of plan) if (await db._lab.count(key)) busy.push(def.table);
      if (busy.length) {
        console.error(`Estas tablas de destino ya tienen datos: ${busy.join(', ')}. No se ha escrito nada.`);
        process.exit(1);
      }
    }
  }

  // 3. Importar, pestaña por pestaña, en el mismo orden de filas.
  const summary = [];
  for (const { key, def, title, objects, missing } of plan) {
    if (!simulate && objects.length) await db._lab.bulkInsert(key, objects);
    const inDb = simulate ? null : await db._lab.count(key);
    summary.push({ pestaña: title, tabla: def.table, filas: objects.length, enSupabase: inDb, falta: Boolean(missing) });
    const ok = simulate || inDb === objects.length;
    console.log(`  ${ok ? '✓' : '✗'} ${String(title).padEnd(16)} → ${def.table.padEnd(18)} ${String(objects.length).padStart(5)} filas${simulate ? '' : ` · en Supabase ${inDb}`}${missing ? ' (la pestaña no existe en el Excel)' : ''}`);
  }
  const cleanedTotal = Object.values(cleaned).reduce((a, b) => a + b, 0);
  console.log(`\nReglas de limpieza aplicadas: ${cleanedTotal}${cleanedTotal ? ` (${JSON.stringify(cleaned)})` : ''}`);

  const out = path.join(__dirname, '.out', `import-${simulate ? 'simulacion' : 'log'}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ fecha: new Date().toISOString(), destino: host, simulacion: simulate, limpieza: cleaned, pestañas: summary }, null, 1));
  const bad = summary.filter((s) => !simulate && s.enSupabase !== s.filas);
  if (bad.length) { console.error(`\n✗ ${bad.length} tablas con un número de filas distinto. Revisa antes de seguir.`); process.exit(1); }
  console.log(`${simulate ? 'Simulación correcta: se puede importar.' : 'Importación completa.'} Registro (sin datos): ${path.relative(process.cwd(), out)}`);
  if (!simulate) console.log('Siguiente: node tools/verify-import.js --xlsx <mismo archivo>');
}

main().catch((e) => { console.error('Error:', e.message); process.exit(2); });
