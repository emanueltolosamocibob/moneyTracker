-- Enlaza cada loan_payment con la transacción de egreso que genera al
-- registrarse (ver Loans.tsx: handlePaySubmit). on delete cascade en esta
-- dirección (transactions -> loan_payments) es lo que permite que borrar
-- una cuota, o borrar el préstamo entero (que ya cascadea a loan_payments),
-- borre también su transacción sin código extra en el cliente.
alter table public.transactions
  add column loan_payment_id uuid references public.loan_payments (id) on delete cascade;

create index transactions_loan_payment_id_idx on public.transactions (loan_payment_id);
