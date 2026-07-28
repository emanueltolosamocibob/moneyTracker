-- Agrega método de pago y, si corresponde, los últimos 4 dígitos de la
-- tarjeta usada. Se infiere junto con la categoría en la misma pasada del
-- LLM (ver api/_lib/categorize.ts).
alter table public.transactions
  add column payment_method text
    check (payment_method in ('credit_card', 'debit_card', 'transfer', 'cash', 'other')),
  add column card_last4 text
    check (card_last4 is null or card_last4 ~ '^[0-9]{4}$');

create index transactions_payment_method_idx on public.transactions (user_id, payment_method);
