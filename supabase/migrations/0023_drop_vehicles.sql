-- Elimina la feature de Vehículos (tablas, columna de enlace y bucket).
--
-- La 0022 se aplicó a la base y después el código se revirtió de main por
-- decisión de producto, así que estos objetos quedaron huérfanos: ningún
-- código los lee ni los escribe. Se borran acá en vez de repararse el
-- historial a mano, para que la base y las migraciones vuelvan a contar la
-- misma historia.
--
-- Nota sobre las transacciones: los egresos que un service o una visita al
-- mecánico hayan generado en `transactions` NO se borran. Solo pierden el
-- enlace al desaparecer la columna, y quedan como transacciones manuales
-- normales — son registros de plata que el usuario efectivamente gastó, y
-- borrarlos sería pasarse de lo pedido.
alter table public.transactions drop column if exists vehicle_expense_id;

drop table if exists public.vehicle_expenses;
drop table if exists public.vehicles;

drop policy if exists "vehicle-docs: all own" on storage.objects;

-- El bucket va en un bloque con manejo de excepción, no como un delete
-- suelto, por dos motivos que ya hicieron fallar este archivo una vez:
-- el rol que corre las migraciones no puede borrar filas de
-- storage.objects (permission denied, y eso abortaba la migración entera
-- dejando las tablas en pie), y un bucket con archivos adentro tampoco se
-- puede borrar por la FK. Si alguna de las dos cosas pasa, el bucket queda
-- —vacío de sentido, sin política y sin código que lo use— y el resto del
-- drop se aplica igual. Se termina de borrar desde el dashboard.
do $$
begin
  delete from storage.buckets where id = 'vehicle-docs';
exception when others then
  raise notice 'bucket vehicle-docs no borrado (%), borralo desde el dashboard', sqlerrm;
end $$;
