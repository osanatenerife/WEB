// Genera docs/SCHEMA.sql a partir de booking-api/src/lib/db-schema.js.
// Uso: node tools/gen-schema.js
const fs = require('fs');
const path = require('path');
const { TABLES, snake } = require('../booking-api/src/lib/db-schema');

const PG_TYPE = { text: 'text', int: 'integer', num: 'numeric', date: 'date', ts: 'timestamptz', boolTF: 'boolean' };
const pgType = (t) => (t.startsWith('bool:') ? 'boolean' : PG_TYPE[t]);
// "lower(clientEmail)" → "lower(client_email)"
const idxExpr = (e) => e.replace(/[A-Za-z]+(?=\)|$)/, (n) => snake(n));
const idxName = (table, e) => `${table}_${idxExpr(e).replace(/[()]/g, '_').replace(/_+$/, '')}_idx`;

const out = [];
out.push(`-- ============================================================
-- Osana — esquema Supabase (Fase 1). GENERADO por tools/gen-schema.js
-- desde booking-api/src/lib/db-schema.js: no editar a mano.
--
-- Una tabla por pestaña de la Google Sheet. "row_id" hace de número de
-- fila (_sheetRow) que usa el código para actualizar; el ID de negocio
-- (booking_id, bono_id...) es UNIQUE. Se puede ejecutar varias veces.
--
-- Seguridad: RLS activado SIN políticas → solo la clave secreta del
-- servidor (service_role / sb_secret_...) puede leer o escribir. La clave
-- pública (anon / sb_publishable_...) no ve nada.
-- ============================================================
`);

for (const def of Object.values(TABLES)) {
  const t = def.table;
  out.push(`-- Pestaña: ${def.tab}`);
  const cols = ['  row_id bigint generated always as identity primary key'];
  for (const [name, type] of def.columns) {
    const comment = type.startsWith('bool:') ? ` -- '${type.slice(5)}' en el código`
      : type === 'boolTF' ? ` -- 'true'/'false' en el código` : '';
    cols.push(`  ${snake(name)} ${pgType(type)}${comment}`);
  }
  // La coma va antes del comentario de la línea, no después.
  const body = cols.map((c, i) => {
    if (i === cols.length - 1) return c;
    const at = c.indexOf(' --');
    return at === -1 ? c + ',' : c.slice(0, at) + ',' + c.slice(at);
  }).join('\n');
  out.push(`create table if not exists public.${t} (\n${body}\n);`);
  for (const u of def.unique || []) {
    out.push(`create unique index if not exists ${t}_${snake(u)}_key on public.${t} (${snake(u)});`);
  }
  for (const e of def.indexes || []) {
    out.push(`create index if not exists ${idxName(t, e)} on public.${t} (${idxExpr(e)});`);
  }
  out.push(`alter table public.${t} enable row level security;`);
  out.push(`revoke all on public.${t} from anon, authenticated;`);
  out.push('');
}

out.push(`-- Saldo de fidelización por clienta (misma regla que computeLoyaltyBalance
-- en booking-api/src/config/loyalty.js): los canjes ("redeem") y las
-- anulaciones ("reversal") restan siempre; el resto suma solo si es de este
-- año; nunca baja de 0. Es para consultas/informes: la web sigue calculando
-- el saldo en JavaScript con las mismas filas.
create or replace view public.saldo_por_cliente
with (security_invoker = true) as
select
  phone_normalized,
  max(email_normalized) as email_normalized,
  max(name) as name,
  greatest(0, round(sum(
    case
      when type in ('redeem', 'reversal') then -coalesce(amount, 0)
      when date >= date_trunc('year', current_date)::date then coalesce(amount, 0)
      else 0
    end
  ), 2)) as saldo,
  count(*) as movimientos
from public.saldo_movimientos
group by phone_normalized;
revoke all on public.saldo_por_cliente from anon, authenticated;
`);

const target = path.join(__dirname, '..', 'docs', 'SCHEMA.sql');
fs.writeFileSync(target, out.join('\n'));
console.log('Escrito ' + path.relative(process.cwd(), target));
