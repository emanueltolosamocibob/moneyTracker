-- Vehículos: registro, seguimiento y mantenimiento.
--
-- El consumo promedio y el intervalo de service NO viven en una tabla de
-- specs cacheada por (marca, modelo, año): son dos números que se piden una
-- sola vez a /api/vehicles/info cuando se crea el vehículo y quedan acá,
-- editables a mano. Una tabla compartida solo tendría sentido con muchos
-- usuarios cargando los mismos modelos; con dos o tres autos en toda la vida
-- de la app es un join de más para ahorrar llamadas que ya no se hacen.
--
-- Los datos de la póliza son tres columnas y no una tabla de documentos por
-- el mismo criterio: hoy el único archivo que se sube es el PDF del seguro.
-- Si en algún momento hay que guardar VTV, título y cédula como archivos,
-- ahí sí conviene una tabla vehicle_documents (kind, file_path, expires_on)
-- y estas columnas se migran a filas.
create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Decide qué silueta SVG muestra la tarjeta (ver VehicleSilhouette.tsx).
  type text not null check (type in ('car', 'suv', 'pickup', 'van', 'moto')),
  brand text not null,
  model text not null,
  year integer not null check (year between 1900 and 2100),
  -- Color en hex (#rrggbb): es con lo que se tiñe la silueta de la tarjeta.
  color text not null default '#c0c4cc',
  license_plate text,

  -- Kilometraje actual, cargado a mano. Es el que dispara el recordatorio de
  -- próximo service junto con service_interval_km.
  current_km integer check (current_km >= 0),

  -- Datos "de fábrica" traídos por /api/vehicles/info (LLM) y editables:
  -- por eso son nullable y no tienen default, un null significa "todavía no
  -- se consultó" y la UI lo muestra como tal en vez de inventar un 0.
  consumption_l100km numeric(5, 2) check (consumption_l100km > 0),
  service_interval_km integer check (service_interval_km > 0),
  fuel_type text,

  insurance_company text,
  -- Path dentro del bucket 'vehicle-docs' de Storage, no una URL: el bucket
  -- es privado y las URLs se firman al vuelo (ver Vehicles.tsx).
  insurance_pdf_path text,
  insurance_expires_on date,
  vtv_expires_on date,

  created_at timestamptz not null default now()
);

alter table public.vehicles enable row level security;

create policy "vehicles: all own" on public.vehicles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Un service y una visita al mecánico comparten todos sus campos salvo el
-- kilometraje, así que son la misma tabla con un discriminador en vez de dos
-- tablas gemelas: un solo form, un solo CRUD, un solo link a transactions, y
-- el costo total del vehículo sale de un solo sum().
create table public.vehicle_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  vehicle_id uuid not null references public.vehicles (id) on delete cascade,
  kind text not null check (kind in ('service', 'mechanic')),
  occurred_on date not null,
  title text not null,
  description text,
  -- Solo se pide para kind='service' (es lo que hace avanzar el recordatorio
  -- del próximo service), pero se deja nullable para los dos por si una
  -- visita al mecánico también lo tiene a mano.
  odometer_km integer check (odometer_km >= 0),
  cost numeric(14, 2) not null check (cost >= 0),
  place text,
  created_at timestamptz not null default now()
);

create index vehicle_expenses_vehicle_id_idx on public.vehicle_expenses (vehicle_id);

alter table public.vehicle_expenses enable row level security;

create policy "vehicle_expenses: all own" on public.vehicle_expenses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Mismo patrón que loan_payment_id (ver 0017): la transacción de egreso que
-- genera cada gasto del vehículo cuelga de él con on delete cascade, así
-- borrar el gasto (o el vehículo entero, que ya cascadea) borra también su
-- transacción sin código extra en el cliente.
alter table public.transactions
  add column vehicle_expense_id uuid references public.vehicle_expenses (id) on delete cascade;

create index transactions_vehicle_expense_id_idx on public.transactions (vehicle_expense_id);

-- Primer uso de Supabase Storage en la app. Bucket privado: el PDF de una
-- póliza tiene datos personales, así que no se sirve por URL pública sino
-- con signed URLs de corta duración generadas en el cliente ya autenticado.
-- El aislamiento entre usuarios es por convención de path — cada archivo va
-- en '<user_id>/<vehicle_id>-<timestamp>.pdf' y las políticas de abajo
-- comparan esa primera carpeta contra auth.uid(), que es el equivalente en
-- Storage al 'auth.uid() = user_id' que usan el resto de las tablas.
insert into storage.buckets (id, name, public)
  values ('vehicle-docs', 'vehicle-docs', false)
  on conflict (id) do nothing;

create policy "vehicle-docs: all own" on storage.objects
  for all
  using (bucket_id = 'vehicle-docs' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'vehicle-docs' and (storage.foldername(name))[1] = auth.uid()::text);
