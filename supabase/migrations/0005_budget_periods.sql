-- Presupuestos: reemplaza la tabla `budgets` (un tope por categoría/mes,
-- sin agrupar) por un modelo de "período de presupuesto" + ítems por
-- categoría. Necesario para soportar períodos personalizados (no solo
-- mensuales), reinicio automático, e historial de períodos cerrados.
-- La tabla vieja nunca tuvo UI, así que no hay datos que migrar.

drop table if exists public.budgets;

create table public.budget_periods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  period_type text not null check (period_type in ('monthly', 'custom')),
  period_start date not null,
  period_end date not null,
  -- Solo tiene sentido para period_type = 'monthly': si true, al vencer este
  -- período se genera automáticamente el del mes siguiente con los mismos
  -- montos por categoría (ver budget_items).
  auto_renew boolean not null default false,
  created_at timestamptz not null default now()
);

create index budget_periods_user_start_idx on public.budget_periods (user_id, period_start desc);

alter table public.budget_periods enable row level security;

create policy "budget_periods: all own" on public.budget_periods
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table public.budget_items (
  id uuid primary key default gen_random_uuid(),
  budget_period_id uuid not null references public.budget_periods (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  amount numeric(12, 2) not null,
  created_at timestamptz not null default now(),
  unique (budget_period_id, category_id)
);

alter table public.budget_items enable row level security;

create policy "budget_items: all own" on public.budget_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
