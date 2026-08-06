-- Marca las alertas de compra cargadas a mano desde la tabla de "Alertas de
-- Telegram" (ver api/telegram/buy-alerts.ts POST), para poder mostrar el tag
-- "Manual" y distinguirlas de las que llegaron del canal real. No tienen un
-- mensaje real de Telegram detrás: message_id se genera como un negativo
-- (los ids reales de Telegram siempre son positivos), y raw_text se arma a
-- mano en el mismo formato que ya sabe parsear extractDisplayFields.
alter table public.trade_signals
  add column is_manual boolean not null default false;
