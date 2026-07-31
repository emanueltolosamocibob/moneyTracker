-- Caché comercio -> categoría. Cuando el scan de Gmail categoriza un mail
-- con Gemini, guarda acá la relación (merchant_key, category_id) para ese
-- usuario. La próxima vez que aparezca el mismo comercio (parseado por
-- regex desde el template estructurado del mail, sin pasar por el LLM —
-- ver api/_lib/parseEmailTemplate.ts), se usa la categoría cacheada
-- directo: cero llamadas a Gemini para comercios ya conocidos.
create table public.merchant_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Comercio normalizado (trim + mayúsculas + espacios colapsados) para que
  -- variaciones triviales de formato no rompan el match.
  merchant_key text not null,
  category_id uuid not null references public.categories (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, merchant_key)
);

alter table public.merchant_categories enable row level security;

create policy "merchant_categories: all own" on public.merchant_categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
