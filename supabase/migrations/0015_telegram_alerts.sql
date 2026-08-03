-- Alertas de compra/venta que llegan a un grupo de Telegram, sincronizadas
-- con MTProto (la API de cliente, no la Bot API) usando la cuenta del propio
-- usuario — ver api/_lib/telegramSync.ts para por qué no es un bot.

-- Los ids de Telegram son enteros de 64 bits. chat_id va como text porque
-- GramJS los devuelve como BigInt y los ids de supergrupo (-100…) no entran
-- cómodos en el number de JS; message_id sí es un entero chico y se guarda
-- como bigint porque el sync lo compara y ordena numéricamente.
create table public.telegram_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  chat_id text not null,
  message_id bigint not null,
  sent_at timestamptz not null,
  -- Nombre visible o @usuario de quien lo mandó. Nullable: en canales y
  -- algunos supergrupos el mensaje viene firmado por el chat, no por una
  -- persona.
  sender text,
  text text not null,
  created_at timestamptz not null default now(),
  -- Mismo rol que unique(user_id, source_email_id) en transactions: volver a
  -- sincronizar un tramo ya visto es un insert no-op, no un error.
  unique (user_id, chat_id, message_id)
);

create index telegram_messages_window_idx
  on public.telegram_messages (user_id, chat_id, sent_at desc);

alter table public.telegram_messages enable row level security;

create policy "telegram_messages: all own" on public.telegram_messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Una fila por (usuario, chat) sincronizado. Cumple el mismo papel que
-- gmail_connections: el cron recorre esta tabla para saber qué sincronizar,
-- y la fila la crea el primer sync manual (que sí tiene el JWT del usuario).
create table public.telegram_sync_state (
  user_id uuid not null references auth.users (id) on delete cascade,
  chat_id text not null,
  chat_title text,
  -- Cursor incremental hacia adelante: el message_id más alto ya guardado.
  last_message_id bigint,
  -- Cursor del backfill hacia atrás. El historial se trae de a tandas para
  -- no pasarse de los 300s de la función, así que hace falta recordar hasta
  -- dónde se llegó entre invocaciones. Cuando backfill_done pasa a true,
  -- este campo deja de usarse.
  backfill_cursor bigint,
  backfill_done boolean not null default false,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, chat_id)
);

alter table public.telegram_sync_state enable row level security;

create policy "telegram_sync_state: all own" on public.telegram_sync_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- El análisis es una llamada a Gemini sobre cientos de mensajes: caro y
-- lento. Se guarda el último resultado por usuario para que volver a entrar
-- a Inversiones lo muestre sin re-analizar; el botón "Analizar" es el que
-- genera uno nuevo.
create table public.telegram_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  chat_id text not null,
  -- Ventana analizada, para poder mostrar "análisis de los últimos N días"
  -- sin recalcularla a partir de las señales.
  from_date date not null,
  to_date date not null,
  message_count integer not null,
  summary text not null,
  -- Array de señales ya enriquecidas (cruce con la cartera y rendimiento
  -- contra precio posterior). Va como jsonb en vez de tabla propia porque
  -- son el resultado derivado de una corrida, no entidades que el usuario
  -- edite — se reemplazan enteras en cada análisis.
  signals jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index telegram_analyses_latest_idx
  on public.telegram_analyses (user_id, created_at desc);

alter table public.telegram_analyses enable row level security;

create policy "telegram_analyses: all own" on public.telegram_analyses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
