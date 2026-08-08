-- Objetivos de ahorro: cada uno tiene un monto meta y una fecha estimada.
-- El progreso ("cuánto llevo ahorrado") no se guarda como columna: se
-- deriva en el cliente sumando goal_contributions, mismo criterio que
-- Préstamos (ver 0011_loans.sql) para no mantener sincronizado un campo
-- calculado cada vez que se agrega o borra un aporte.
--
-- Solo puede haber un objetivo activo a la vez por usuario (elegido a mano,
-- no automático) — el índice único parcial de abajo lo hace imposible de
-- violar aunque el cliente tenga un bug; is_active solo decide el orden en
-- que se muestran las tarjetas, no habilita ni bloquea agregar aportes.
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  target_amount numeric(14, 2) not null check (target_amount > 0),
  target_date date not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index goals_one_active_per_user on public.goals (user_id) where is_active;

alter table public.goals enable row level security;

create policy "goals: all own" on public.goals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Un aporte cargado a mano hacia un objetivo puntual.
create table public.goal_contributions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  goal_id uuid not null references public.goals (id) on delete cascade,
  contribution_date date not null,
  amount numeric(14, 2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

alter table public.goal_contributions enable row level security;

create policy "goal_contributions: all own" on public.goal_contributions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
