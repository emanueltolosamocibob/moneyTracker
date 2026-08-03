-- Préstamos: cada uno tiene un monto solicitado, un monto total a devolver
-- (ya con intereses incluidos) y una cantidad de cuotas fija pactada de
-- entrada. El progreso/estado "Finalizado" no se guarda como columna: se
-- deriva en el cliente comparando la suma de loan_payments.amount contra
-- amount_to_repay, para no tener que mantener sincronizado un campo
-- derivado cada vez que se registra o borra un pago.
create table public.loans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  bank text not null,
  amount_requested numeric(14, 2) not null check (amount_requested > 0),
  amount_to_repay numeric(14, 2) not null check (amount_to_repay > 0),
  installments_count integer not null check (installments_count > 0),
  created_at timestamptz not null default now()
);

alter table public.loans enable row level security;

create policy "loans: all own" on public.loans
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Un pago de cuota registrado a mano — no hay número de cuota fijo por
-- fila porque no siempre se paga cuota por cuota en orden estricto; el
-- número que se muestra en la tabla de la tarjeta es simplemente el
-- orden en que se registraron (1ro, 2do, ...), no un plan de cuotas
-- pre-generado.
create table public.loan_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  loan_id uuid not null references public.loans (id) on delete cascade,
  payment_date date not null,
  amount numeric(14, 2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

alter table public.loan_payments enable row level security;

create policy "loan_payments: all own" on public.loan_payments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
