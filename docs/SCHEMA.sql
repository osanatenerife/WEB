-- ============================================================
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

-- Pestaña: (primera pestaña)
create table if not exists public.reservas (
  row_id bigint generated always as identity primary key,
  booking_id text,
  created_at timestamptz,
  status text,
  name text,
  phone text,
  email text,
  service_id text,
  service_name text,
  employee_id text,
  employee_name text,
  calendar_id text,
  event_id text,
  date date,
  time text,
  duration_minutes integer,
  price numeric,
  amount_paid numeric,
  payment_type text,
  payment_intent_id text,
  lang text,
  reminder_sent boolean, -- 'sent' en el código
  birthdate date,
  bono_id text,
  session_number text,
  notes text,
  final_amount numeric,
  remainder_paid_how text,
  remainder_amount2 numeric,
  remainder_paid_how2 text,
  redeemed_amount numeric,
  terms_accepted_at timestamptz,
  deposit_paid_how text,
  no_show_forgiven boolean, -- '1' en el código
  deleted_as_mistake boolean, -- '1' en el código
  deposit_paid_date date,
  confirmation_email_sent boolean, -- '1' en el código
  deposit_amount2 numeric,
  deposit_paid_how2 text
);
create unique index if not exists reservas_booking_id_key on public.reservas (booking_id);
create index if not exists reservas_phone_idx on public.reservas (phone);
create index if not exists reservas_lower_email_idx on public.reservas (lower(email));
create index if not exists reservas_date_idx on public.reservas (date);
create index if not exists reservas_bono_id_idx on public.reservas (bono_id);
create index if not exists reservas_status_idx on public.reservas (status);
alter table public.reservas enable row level security;
revoke all on public.reservas from anon, authenticated;

-- Pestaña: Bonos
create table if not exists public.bonos_regalo (
  row_id bigint generated always as identity primary key,
  bono_id text,
  code text,
  created_at timestamptz,
  status text,
  buyer_name text,
  buyer_email text,
  buyer_phone text,
  recipient_name text,
  gift_type text,
  service_id text,
  service_name text,
  amount numeric,
  message text,
  expiry_date date,
  payment_intent_id text,
  lang text,
  redeemed_at timestamptz
);
create unique index if not exists bonos_regalo_bono_id_key on public.bonos_regalo (bono_id);
create index if not exists bonos_regalo_code_idx on public.bonos_regalo (code);
create index if not exists bonos_regalo_lower_buyer_email_idx on public.bonos_regalo (lower(buyer_email));
create index if not exists bonos_regalo_buyer_phone_idx on public.bonos_regalo (buyer_phone);
alter table public.bonos_regalo enable row level security;
revoke all on public.bonos_regalo from anon, authenticated;

-- Pestaña: Cumpleanos
create table if not exists public.cumpleanos (
  row_id bigint generated always as identity primary key,
  email_normalized text,
  phone_normalized text,
  name text,
  birthdate date,
  last_sent_year integer
);
create index if not exists cumpleanos_email_normalized_idx on public.cumpleanos (email_normalized);
create index if not exists cumpleanos_phone_normalized_idx on public.cumpleanos (phone_normalized);
alter table public.cumpleanos enable row level security;
revoke all on public.cumpleanos from anon, authenticated;

-- Pestaña: Bajas
create table if not exists public.bajas (
  row_id bigint generated always as identity primary key,
  email_normalized text,
  unsubscribed_at timestamptz
);
create index if not exists bajas_email_normalized_idx on public.bajas (email_normalized);
alter table public.bajas enable row level security;
revoke all on public.bajas from anon, authenticated;

-- Pestaña: BonosSesiones
create table if not exists public.bonos_sesiones (
  row_id bigint generated always as identity primary key,
  bono_id text,
  created_at timestamptz,
  client_name text,
  client_phone text,
  client_email text,
  service_id text,
  service_name text,
  employee_id text,
  total_sessions integer,
  sessions_used integer,
  sessions_remaining integer,
  total_price numeric,
  amount_paid_online numeric,
  payment_type text,
  remaining_amount numeric,
  remaining_paid_how text,
  status text,
  expiry_date date,
  payment_intent_id text,
  lang text,
  paid_cash numeric,
  paid_bizum numeric,
  paid_card numeric
);
create unique index if not exists bonos_sesiones_bono_id_key on public.bonos_sesiones (bono_id);
create index if not exists bonos_sesiones_client_phone_idx on public.bonos_sesiones (client_phone);
create index if not exists bonos_sesiones_lower_client_email_idx on public.bonos_sesiones (lower(client_email));
create index if not exists bonos_sesiones_status_idx on public.bonos_sesiones (status);
alter table public.bonos_sesiones enable row level security;
revoke all on public.bonos_sesiones from anon, authenticated;

-- Pestaña: Faltas
create table if not exists public.faltas (
  row_id bigint generated always as identity primary key,
  phone_normalized text,
  email_normalized text,
  name text,
  strike_count integer,
  last_strike_date date
);
create index if not exists faltas_phone_normalized_idx on public.faltas (phone_normalized);
create index if not exists faltas_email_normalized_idx on public.faltas (email_normalized);
alter table public.faltas enable row level security;
revoke all on public.faltas from anon, authenticated;

-- Pestaña: Saldo
create table if not exists public.saldo_movimientos (
  row_id bigint generated always as identity primary key,
  date date,
  phone_normalized text,
  email_normalized text,
  name text,
  type text,
  booking_id text,
  service_name text,
  category text,
  base_amount numeric,
  paid_how text,
  rate_applied numeric,
  amount numeric,
  note text
);
create index if not exists saldo_movimientos_phone_normalized_idx on public.saldo_movimientos (phone_normalized);
create index if not exists saldo_movimientos_email_normalized_idx on public.saldo_movimientos (email_normalized);
create index if not exists saldo_movimientos_booking_id_idx on public.saldo_movimientos (booking_id);
alter table public.saldo_movimientos enable row level security;
revoke all on public.saldo_movimientos from anon, authenticated;

-- Pestaña: VentasProducto
create table if not exists public.ventas_producto (
  row_id bigint generated always as identity primary key,
  sale_id text,
  created_at timestamptz,
  date date,
  product text,
  amount numeric,
  paid_how text,
  notes text,
  category text,
  booking_id text,
  status text,
  client_phone text,
  client_name text,
  client_email text
);
create unique index if not exists ventas_producto_sale_id_key on public.ventas_producto (sale_id);
create index if not exists ventas_producto_booking_id_idx on public.ventas_producto (booking_id);
create index if not exists ventas_producto_client_phone_idx on public.ventas_producto (client_phone);
create index if not exists ventas_producto_date_idx on public.ventas_producto (date);
alter table public.ventas_producto enable row level security;
revoke all on public.ventas_producto from anon, authenticated;

-- Pestaña: Presupuestos
create table if not exists public.presupuestos (
  row_id bigint generated always as identity primary key,
  quote_id text,
  created_at timestamptz,
  client_name text,
  client_phone text,
  client_email text,
  description text,
  category text,
  amount numeric,
  status text,
  paid_date date,
  payment_intent_id text,
  lang text
);
create unique index if not exists presupuestos_quote_id_key on public.presupuestos (quote_id);
create index if not exists presupuestos_client_phone_idx on public.presupuestos (client_phone);
create index if not exists presupuestos_lower_client_email_idx on public.presupuestos (lower(client_email));
alter table public.presupuestos enable row level security;
revoke all on public.presupuestos from anon, authenticated;

-- Pestaña: Descuentos
create table if not exists public.descuentos (
  row_id bigint generated always as identity primary key,
  discount_id text,
  code text,
  service_ids text,
  service_names text,
  discount_type text,
  discount_value numeric,
  valid_from date,
  valid_until date,
  active boolean, -- 'true'/'false' en el código
  created_at timestamptz,
  note text,
  email_sent_at timestamptz,
  applies_to text
);
create unique index if not exists descuentos_discount_id_key on public.descuentos (discount_id);
create index if not exists descuentos_code_idx on public.descuentos (code);
alter table public.descuentos enable row level security;
revoke all on public.descuentos from anon, authenticated;

-- Pestaña: Seguimientos
create table if not exists public.seguimientos (
  row_id bigint generated always as identity primary key,
  followup_id text,
  created_at timestamptz,
  client_name text,
  client_phone text,
  client_email text,
  note text,
  due_date date,
  status text
);
create unique index if not exists seguimientos_followup_id_key on public.seguimientos (followup_id);
create index if not exists seguimientos_client_phone_idx on public.seguimientos (client_phone);
create index if not exists seguimientos_due_date_idx on public.seguimientos (due_date);
create index if not exists seguimientos_status_idx on public.seguimientos (status);
alter table public.seguimientos enable row level security;
revoke all on public.seguimientos from anon, authenticated;

-- Saldo de fidelización por clienta (misma regla que computeLoyaltyBalance
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
