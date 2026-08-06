-- Elimina el portfolio simulado (paper trading) por decisión de producto:
-- las decisiones discrecionales del LLM resultaron sistemáticamente en
-- "vender" por no poder traer noticias del papel, y el experimento de
-- comparar estrategias en paralelo no daba una señal útil. Queda solo un
-- benchmark del SPY (api/investments/spy-benchmark.ts), sin tabla propia —
-- se calcula al vuelo contra Yahoo Finance en cada carga.
--
-- `trade_signals` (0016_paper_trading.sql) NO se toca: sigue siendo la
-- fuente de la tabla "Alertas de Telegram" (api/telegram/buy-alerts.ts), que
-- no depende de nada de esto.
drop table if exists public.paper_decisions;
drop table if exists public.paper_positions;
