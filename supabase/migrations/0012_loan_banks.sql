-- Bancos administrables en Configuración, mismo patrón que income_sources
-- (nombre libre, sin catálogo fijo).
create table public.banks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.banks enable row level security;

create policy "banks: all own" on public.banks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- loans.bank era texto libre; pasa a referenciar un banco administrable.
-- Sin NOT NULL a propósito (aunque hoy no debería haber filas reales
-- todavía, recién se agregó la pestaña) para no arriesgar romper un
-- préstamo ya cargado — la app exige elegir un banco al crear uno nuevo
-- de todos modos.
alter table public.loans add column bank_id uuid references public.banks (id);
alter table public.loans drop column bank;
