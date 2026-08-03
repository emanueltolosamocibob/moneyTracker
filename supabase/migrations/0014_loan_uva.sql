-- Préstamos en UVA: amount_requested/amount_to_repay pasan a interpretarse
-- como cantidad de UVAs (no pesos) cuando currency = 'UVA' — la conversión
-- a pesos se hace en el cliente, cuota por cuota, usando el valor de la
-- UVA en la fecha de cada pago (ver loan_payments.uva_value más abajo), no
-- un valor único del préstamo.
alter table public.loans
  add column currency text not null default 'ARS' check (currency in ('ARS', 'UVA'));

-- Valor de la UVA (en pesos) al momento de registrar ese pago puntual,
-- consultado a la API de ArgentinaDatos/BCRA. Nulo para préstamos en ARS
-- (no aplica) y también para pagos UVA ya cargados antes de este cambio.
alter table public.loan_payments
  add column uva_value numeric(12, 4);
