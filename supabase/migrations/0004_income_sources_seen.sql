-- Fuentes de ingreso (sueldo, freelance, etc.), mismo patrón que
-- categories: por usuario, con RLS "own rows only".
create table public.income_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

alter table public.income_sources enable row level security;

create policy "income_sources: all own" on public.income_sources
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.transactions
  add column income_source_id uuid references public.income_sources (id) on delete set null;

-- "Nueva" (no vista todavía): se agrega con default true para que las
-- transacciones que ya existen no aparezcan todas como nuevas de golpe;
-- después se baja el default a false para que de acá en más nazcan sin ver
-- por defecto. El insert manual del formulario (src/pages/Transactions.tsx)
-- tiene que setear seen: true explícitamente para no marcarse a sí mismo
-- como "nueva" (el usuario la acaba de tipear, ya la vio).
alter table public.transactions
  add column seen boolean not null default true;

alter table public.transactions
  alter column seen set default false;
