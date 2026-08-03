-- La FK de 0012 no tenía "on delete set null" — por default Postgres usa
-- NO ACTION, que directamente bloquearía borrar un banco si algún
-- préstamo lo referencia. La UI de Configuración ya avisa "el préstamo
-- queda sin banco asignado" al borrar uno, así que el constraint tiene
-- que matchear eso en vez de tirar un error de FK.
alter table public.loans drop constraint loans_bank_id_fkey;
alter table public.loans
  add constraint loans_bank_id_fkey foreign key (bank_id) references public.banks (id) on delete set null;
