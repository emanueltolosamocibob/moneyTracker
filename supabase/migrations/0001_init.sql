-- MoneyTracker: schema inicial multi-usuario.
-- Cada tabla de datos tiene user_id + RLS "own rows only", así que un usuario
-- solo puede ver/tocar lo suyo aunque comparta el mismo proyecto de Supabase.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: select own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles: update own" on public.profiles
  for update using (auth.uid() = id);

-- Crea el profile automáticamente cuando alguien se loguea por primera vez.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;

  insert into public.categories (user_id, name, icon, is_default)
  select new.id, name, icon, true
  from (values
    ('Supermercado', '🛒'),
    ('Restaurantes', '🍽️'),
    ('Transporte', '🚗'),
    ('Servicios', '💡'),
    ('Salud', '🩺'),
    ('Entretenimiento', '🎬'),
    ('Compras', '🛍️'),
    ('Otros', '❓')
  ) as defaults(name, icon)
  on conflict do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  icon text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

alter table public.categories enable row level security;

create policy "categories: all own" on public.categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- transactions
-- ---------------------------------------------------------------------
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category_id uuid references public.categories (id) on delete set null,
  amount numeric(12, 2) not null,
  currency text not null default 'ARS',
  merchant text,
  description text,
  occurred_at timestamptz not null default now(),
  type text not null check (type in ('expense', 'income')),
  source text not null check (source in ('gmail', 'manual')) default 'manual',
  source_email_id text,
  category_confidence numeric(3, 2),
  needs_review boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, source_email_id)
);

create index transactions_user_occurred_idx on public.transactions (user_id, occurred_at desc);

alter table public.transactions enable row level security;

create policy "transactions: all own" on public.transactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- budgets (futuro: UI pendiente, tabla lista)
-- ---------------------------------------------------------------------
create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category_id uuid references public.categories (id) on delete cascade,
  month date not null,
  amount numeric(12, 2) not null,
  created_at timestamptz not null default now(),
  unique (user_id, category_id, month)
);

alter table public.budgets enable row level security;

create policy "budgets: all own" on public.budgets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- investments (futuro: UI pendiente, tabla lista)
-- ---------------------------------------------------------------------
create table public.investments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  kind text not null,
  quantity numeric(18, 6) not null,
  unit_cost numeric(18, 6) not null,
  currency text not null default 'ARS',
  created_at timestamptz not null default now()
);

alter table public.investments enable row level security;

create policy "investments: all own" on public.investments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- gmail_connections
-- Guarda el refresh_token de Gmail por usuario para el polling en
-- background. Es sensible: la tabla NO tiene grant de SELECT para
-- `authenticated`, solo el service role (usado desde las funciones de
-- Vercel) puede leer/escribir directamente. Los usuarios ven su estado de
-- conexión a través de la vista `gmail_connection_status`, que nunca expone
-- el token.
-- ---------------------------------------------------------------------
create table public.gmail_connections (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  refresh_token text not null,
  connected_at timestamptz not null default now(),
  last_scanned_at timestamptz
);

alter table public.gmail_connections enable row level security;
revoke all on public.gmail_connections from authenticated, anon;

create view public.gmail_connection_status
with (security_invoker = true) as
  select user_id, email, connected_at, last_scanned_at
  from public.gmail_connections;

grant select on public.gmail_connection_status to authenticated;

create policy "gmail_connections: select own" on public.gmail_connections
  for select using (auth.uid() = user_id);
