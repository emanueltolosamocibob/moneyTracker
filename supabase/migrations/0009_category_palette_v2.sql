-- ---------------------------------------------------------------------
-- Reemplaza la paleta de categorías (ver 0008_category_spend_tracking.sql)
-- por una rampa magenta -> púrpura -> azul -> cian pedida por el usuario.
-- Recolorea las categorías existentes (no solo las nuevas) siguiendo el
-- mismo orden de creación de antes, y actualiza el trigger para que las
-- categorías que se creen de acá en más usen esta paleta.
-- ---------------------------------------------------------------------
with palette as (
  select array[
    '#fb2f8a', '#c92aab', '#9c1ec9', '#7f1ac9', '#6617c4',
    '#4f14bf', '#3e2ad4', '#3f5aee', '#4a8ef2', '#4dd3ec'
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

create or replace function public.assign_category_color()
returns trigger as $$
declare
  palette text[] := array[
    '#fb2f8a', '#c92aab', '#9c1ec9', '#7f1ac9', '#6617c4',
    '#4f14bf', '#3e2ad4', '#3f5aee', '#4a8ef2', '#4dd3ec'
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
