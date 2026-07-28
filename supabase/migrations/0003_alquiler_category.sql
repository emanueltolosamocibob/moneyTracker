-- Agrega "Alquiler" a las categorías default. El trigger de 0001 solo
-- corre para usuarios nuevos, así que además hay que backfillear la
-- categoría para los que ya existen.

create or replace function public.handle_new_user()
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
    ('Alquiler', '🏠'),
    ('Otros', '❓')
  ) as defaults(name, icon)
  on conflict do nothing;

  return new;
end;
$$;

insert into public.categories (user_id, name, icon, is_default)
select id, 'Alquiler', '🏠', true
from public.profiles
on conflict do nothing;
