-- Reemplaza la tabla `investments` original (snapshot simple, sin filas
-- reales todavía — la UI nunca llegó a usarla) por un modelo de lotes de
-- compra/venta: cada compra es un lote con una cantidad remanente propia,
-- y cada venta (total o parcial) descuenta de uno o más lotes en orden FIFO
-- y queda registrada aparte para poder calcular la ganancia realizada de
-- esa venta puntual (precio de venta vs. precio de compra del lote).
drop table if exists public.investments;

-- 'ar' = acción argentina / CEDEAR, cotiza en pesos. 'world' = acción del
-- resto del mundo, cotiza en USD. La moneda de cada lote se deriva de este
-- campo en el cliente, no se guarda por separado.
create table public.investment_lots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  symbol text not null,
  market text not null check (market in ('ar', 'world')),
  buy_date date not null,
  buy_quantity numeric(18, 6) not null check (buy_quantity > 0),
  buy_price numeric(18, 6) not null check (buy_price > 0),
  -- Cantidad todavía en cartera de este lote puntual (arranca igual a
  -- buy_quantity, baja con cada venta que lo consuma). 0 = lote agotado,
  -- se mantiene para el historial de Movimientos.
  remaining_quantity numeric(18, 6) not null check (remaining_quantity >= 0),
  created_at timestamptz not null default now()
);

alter table public.investment_lots enable row level security;

create policy "investment_lots: all own" on public.investment_lots
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table public.investment_sales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  lot_id uuid not null references public.investment_lots (id) on delete cascade,
  sell_date date not null,
  sell_quantity numeric(18, 6) not null check (sell_quantity > 0),
  sell_price numeric(18, 6) not null check (sell_price > 0),
  created_at timestamptz not null default now()
);

alter table public.investment_sales enable row level security;

create policy "investment_sales: all own" on public.investment_sales
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
