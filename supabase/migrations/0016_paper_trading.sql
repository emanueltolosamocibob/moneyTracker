-- ---------------------------------------------------------------------
-- Paper trading sobre las alertas de Telegram (ver 0015_telegram_alerts.sql
-- para la ingesta de mensajes cruda, que esto reutiliza).
--
-- `paper_positions` y `paper_decisions`, creadas más abajo, fueron
-- eliminadas en 0020_drop_paper_trading.sql (portfolio simulado descartado
-- por decisión de producto). `trade_signals` sigue viva: es la fuente de la
-- tabla "Alertas de Telegram" (api/telegram/buy-alerts.ts).
-- ---------------------------------------------------------------------

-- Una alerta de compra/venta ya parseada desde telegram_messages (ver
-- api/_lib/parseSignal.ts). No todo mensaje de telegram_messages genera una
-- fila acá: la mayoría del canal es comentario de mercado, no una alerta con
-- el formato reconocible.
create table public.trade_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  chat_id text not null,
  -- FK "blanda" a telegram_messages(chat_id, message_id) — no hay FK real
  -- porque telegram_messages no tiene esa combinación como unique salvo junto
  -- con user_id, que ya está acá aparte.
  message_id bigint not null,
  posted_at timestamptz not null,
  kind text not null check (kind in ('buy', 'sell')),
  ticker text,
  take_profit numeric(18, 6),
  stop_loss numeric(18, 6),
  possible_gain_pct numeric(10, 4),
  possible_loss_pct numeric(10, 4),
  risk_benefit numeric(10, 4),
  -- Resultado que el canal REPORTA en su alerta de venta (en USD). El
  -- análisis previo del histórico encontró casos de hasta 10 puntos de
  -- diferencia contra el precio de mercado real, así que esto se guarda para
  -- seguir contrastando reportado vs. real, no como verdad de referencia.
  reported_result_pct numeric(10, 4),
  raw_text text not null,
  created_at timestamptz not null default now(),
  unique (user_id, chat_id, message_id)
);

alter table public.trade_signals enable row level security;

create policy "trade_signals: all own" on public.trade_signals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index trade_signals_ticker_idx on public.trade_signals (user_id, ticker, kind);

-- Una posición simulada. Cada alerta de compra genera una fila por cada
-- estrategia activa (ver api/_lib/paperStrategies.ts), todas con el mismo
-- precio de entrada y el mismo notional — lo único que cambia entre
-- estrategias es cuándo se cierra. `spy_benchmark` es la excepción: mismo
-- momento de entrada y notional, pero el ticker es SPY.
create table public.paper_positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  strategy text not null,
  signal_id uuid not null references public.trade_signals (id) on delete cascade,
  ticker text not null,
  opened_at timestamptz not null,
  entry_price numeric(18, 6) not null check (entry_price > 0),
  quantity numeric(18, 6) not null check (quantity > 0),
  -- Niveles que ESTA estrategia respeta (nulos para buy_hold y para la
  -- discrecional). Copiados acá y no leídos de trade_signals porque cada
  -- estrategia calcula los suyos distinto (channel_levels usa los del canal,
  -- tp3_sl3 calcula ±3% sobre el precio de entrada propio).
  take_profit numeric(18, 6),
  stop_loss numeric(18, 6),
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_at timestamptz,
  exit_price numeric(18, 6),
  exit_reason text check (exit_reason in ('take_profit', 'stop_loss', 'channel_sell', 'llm', 'manual')),
  pnl_pct numeric(10, 4),
  created_at timestamptz not null default now(),
  unique (user_id, strategy, signal_id)
);

alter table public.paper_positions enable row level security;

create policy "paper_positions: all own" on public.paper_positions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index paper_positions_open_idx on public.paper_positions (user_id, status, strategy);

-- Bitácora de cada evaluación discrecional del LLM sobre una posición
-- abierta: qué decidió, con qué precio a la vista, y por qué. Se escribe
-- también cuando la decisión es "mantener" — si solo se registraran las
-- ventas no habría forma de auditar el criterio, que es justamente lo que
-- este experimento intenta medir.
create table public.paper_decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  position_id uuid not null references public.paper_positions (id) on delete cascade,
  decided_at timestamptz not null default now(),
  action text not null check (action in ('hold', 'sell')),
  price numeric(18, 6),
  pnl_pct numeric(10, 4),
  confidence numeric(4, 3),
  rationale text,
  -- Resumen de la búsqueda de noticias/mercado que respaldó la decisión,
  -- guardado aparte de la conclusión para poder releer la evidencia sola.
  research text,
  model text,
  created_at timestamptz not null default now()
);

alter table public.paper_decisions enable row level security;

create policy "paper_decisions: all own" on public.paper_decisions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index paper_decisions_position_idx on public.paper_decisions (position_id, decided_at desc);
