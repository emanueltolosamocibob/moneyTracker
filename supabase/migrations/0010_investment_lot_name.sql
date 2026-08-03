-- Nombre de la compañía capturado al momento de elegir el símbolo en el
-- buscador (Twelve Data lo trae, ByMA/data912 no) — se persiste acá para
-- poder mostrarlo en Cartera actual sin tener que volver a pegarle a la
-- API de búsqueda en cada carga de la página.
alter table public.investment_lots
  add column name text;
