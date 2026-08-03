-- ---------------------------------------------------------------------
-- categories.color
-- Color estable por categoría, usado para diferenciar cada porción del
-- gráfico de gastos por categoría del Dashboard (y su leyenda) — sin esto,
-- un color asignado al azar en cada render no se podría cruzar de forma
-- consistente entre el gráfico y la leyenda, ni mantenerse igual entre
-- meses/visitas. Se asigna sola vía trigger (abajo) en cualquier insert que
-- no la especifique, así que no hace falta tocar los distintos lugares que
-- crean categorías (Settings.tsx, el "+ agregar" de Transactions.tsx, ni el
-- scan de Gmail en api/_lib/scanGmailForUser.ts).
-- ---------------------------------------------------------------------
alter table public.categories add column color text;

-- Paleta fija, ciclada en orden de creación por usuario — misma lógica que
-- usa el trigger de abajo para categorías nuevas, aplicada acá una vez para
-- las que ya existían antes de esta migración.
with palette as (
  select array[
    '#5b8def', '#eb6f92', '#f6c177', '#3fb68f', '#c297eb',
    '#f2a154', '#4fb3bf', '#e07a5f', '#9db4c0', '#c3a6ff',
    '#6fcf97', '#f77f9b'
  ] as colors
),
numbered as (
  select id, row_number() over (partition by user_id order by created_at) - 1 as rn
  from public.categories
)
update public.categories c
set color = palette.colors[(numbered.rn % array_length(palette.colors, 1)) + 1]
from numbered, palette
where c.id = numbered.id;

alter table public.categories alter column color set not null;

create or replace function public.assign_category_color()
returns trigger as $$
declare
  palette text[] := array[
    '#5b8def', '#eb6f92', '#f6c177', '#3fb68f', '#c297eb',
    '#f2a154', '#4fb3bf', '#e07a5f', '#9db4c0', '#c3a6ff',
    '#6fcf97', '#f77f9b'
  ];
  existing_count int;
begin
  if new.color is null then
    select count(*) into existing_count from public.categories where user_id = new.user_id;
    new.color := palette[(existing_count % array_length(palette, 1)) + 1];
  end if;
  return new;
end;
$$ language plpgsql;

create trigger categories_assign_color
before insert on public.categories
for each row execute function public.assign_category_color();

-- ---------------------------------------------------------------------
-- category_month_spend
-- "Foto" de lo gastado por categoría en un mes dado, para el gráfico de
-- gastos por categoría del Dashboard. No es solo una caché de performance:
-- category_name/category_color quedan grabados como texto plano en el
-- momento de guardar, independientes de `categories` — así, si el usuario
-- borra una categoría más adelante, los meses ya cerrados que la usaron
-- siguen mostrando su gasto (con category_id vuelto null vía
-- "on delete set null", pero el nombre/color originales intactos) en vez de
-- perderse o mezclarse con "Sin categoría". El Dashboard decide cuándo
-- recalcular vs. leer esta tabla tal cual (ver Dashboard.tsx): el mes en
-- curso siempre se recalcula en vivo desde `transactions`, pero un mes ya
-- cerrado solo se recalcula la primera vez que se visita — de ahí en más
-- se lee esta tabla como registro congelado.
-- ---------------------------------------------------------------------
create table public.category_month_spend (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  month_start date not null,
  category_id uuid references public.categories (id) on delete set null,
  category_name text not null,
  category_color text not null,
  amount numeric not null,
  created_at timestamptz not null default now()
);

alter table public.category_month_spend enable row level security;

create policy "category_month_spend: all own" on public.category_month_spend
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index category_month_spend_user_month_idx on public.category_month_spend (user_id, month_start);
