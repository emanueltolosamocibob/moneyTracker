-- Permite cerrar una alerta de compra a mano desde el modal de edición de
-- "Alertas de Telegram" (ver api/telegram/buy-alerts.ts PATCH), para el caso
-- en que el usuario vendió sin que el canal mandara su propia alerta de
-- venta. Solo tiene sentido en filas kind='buy' — si más adelante llega una
-- alerta de venta real para el mismo símbolo, esa tiene prioridad para
-- mostrar "Fecha de venta" (ver closedBuyToSellDate en buy-alerts.ts), esta
-- columna queda de respaldo sin usarse.
alter table public.trade_signals
  add column manual_sell_date date;
