import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getUserIdFromRequest, supabaseAdmin } from '../_lib/supabaseAdmin.js'
import { getQuote } from '../_lib/priceHistory.js'
import { PAPER_NOTIONAL_USD, PAPER_STRATEGIES } from '../_lib/paperStrategies.js'
import { evaluateOpenPositions, ingestUnprocessedSignals } from '../_lib/paperTrading.js'

// GET: todo lo que la sección de portfolio simulado necesita en Inversiones,
// en una sola respuesta. POST: botón "Traer alertas y evaluar" — corre la
// misma pasada que el cron diario (catch-up de mensajes + evaluación de
// posiciones abiertas), pero solo para el usuario logueado y al toque.
//
// Los dos comparten archivo (y no dos funciones separadas) porque el plan
// Hobby de Vercel tope a 12 funciones serverless por deploy — agregar
// buy-alerts.ts (ver api/telegram/buy-alerts.ts) pasó el proyecto a 13 y
// rompió el build ("No more than 12 Serverless Functions"). GET/POST en un
// mismo handler no cuenta como dos funciones.
//
// El cálculo del GET vive del lado del servidor porque valuar las
// posiciones abiertas necesita cotizaciones de Yahoo, y ese endpoint no
// manda cabeceras CORS — no se puede pedir desde el browser. Además así
// cada ticker abierto se cotiza una sola vez por invocación, en vez de una
// request por posición.

interface StrategyStats {
  key: string
  label: string
  description: string
  closed: number
  open: number
  winRatePct: number | null
  avgRealizedPct: number | null
  avgUnrealizedPct: number | null
  // Promedio por operación mezclando cerradas (resultado real) y abiertas
  // (marcadas a mercado). Es el número comparable entre estrategias: una que
  // nunca cierra no puede quedar afuera del ranking solo por eso.
  avgTotalPct: number | null
  totalUsd: number
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await getUserIdFromRequest(req.headers.authorization)
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  if (req.method === 'POST') {
    // Antes esto era un endpoint aparte que solo evaluaba posiciones ya
    // abiertas — asumía que algo más (el listener local, o el cron de las
    // 22:30) ya había convertido mensajes nuevos de Telegram en señales.
    // Eso se rompe si el usuario usa varias PCs y ninguna tiene el listener
    // corriendo: sin él, una alerta de compra nueva se queda como texto
    // crudo hasta el cron del día siguiente. Por eso primero hace catch-up
    // (ingestUnprocessedSignals) y recién después evalúa — un click desde
    // cualquier dispositivo alcanza para todo el pipeline. Devuelve
    // `hasMore` cuando quedaron posiciones discrecionales sin evaluar en
    // esta tanda; el cliente repite hasta que llegue en false, mismo patrón
    // que el escaneo de Gmail y el sync de Telegram.
    const admin = supabaseAdmin()
    try {
      const { data: states } = await admin.from('telegram_sync_state').select('chat_id').eq('user_id', userId)
      for (const state of states ?? []) {
        await ingestUnprocessedSignals(admin, userId, state.chat_id)
      }
      const result = await evaluateOpenPositions(admin, userId)
      res.status(200).json({ result })
    } catch (err) {
      res.status(500).json({ error: (err as Error).message })
    }
    return
  }

  const admin = supabaseAdmin()

  const [{ data: positions }, { data: signals }, { data: decisions }] = await Promise.all([
    admin
      .from('paper_positions')
      .select('id, strategy, signal_id, ticker, opened_at, entry_price, quantity, take_profit, stop_loss, status, closed_at, exit_price, exit_reason, pnl_pct')
      .eq('user_id', userId),
    admin
      .from('trade_signals')
      .select('id, message_id, posted_at, kind, ticker, take_profit, stop_loss, risk_benefit, reported_result_pct, raw_text')
      .eq('user_id', userId)
      .order('posted_at', { ascending: false })
      .limit(40),
    admin
      .from('paper_decisions')
      .select('id, position_id, decided_at, action, price, pnl_pct, confidence, rationale, model')
      .eq('user_id', userId)
      .order('decided_at', { ascending: false })
      .limit(40),
  ])

  const all = positions ?? []
  const openPositions = all.filter((p) => p.status === 'open')

  // Una cotización por ticker distinto, compartida por todas las estrategias
  // que lo tengan abierto (típicamente varias, más el benchmark).
  const prices = new Map<string, number>()
  for (const ticker of new Set(openPositions.map((p) => p.ticker))) {
    const quote = await getQuote(ticker)
    if (quote) prices.set(ticker, quote.price)
  }

  function unrealizedPct(position: { ticker: string; entry_price: number }): number | null {
    const price = prices.get(position.ticker)
    if (!price) return null
    return ((price - position.entry_price) / position.entry_price) * 100
  }

  const stats: StrategyStats[] = PAPER_STRATEGIES.map((strategy) => {
    const mine = all.filter((p) => p.strategy === strategy.key)
    const closed = mine.filter((p) => p.status === 'closed' && p.pnl_pct != null)
    const open = mine.filter((p) => p.status === 'open')
    const openPcts = open.map(unrealizedPct).filter((v): v is number => v != null)
    const closedPcts = closed.map((p) => Number(p.pnl_pct))
    const everyPct = [...closedPcts, ...openPcts]
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

    return {
      key: strategy.key,
      label: strategy.label,
      description: strategy.description,
      closed: closed.length,
      open: open.length,
      winRatePct: closedPcts.length ? (closedPcts.filter((v) => v > 0).length / closedPcts.length) * 100 : null,
      avgRealizedPct: avg(closedPcts),
      avgUnrealizedPct: avg(openPcts),
      avgTotalPct: avg(everyPct),
      // Notional fijo por posición, así que el total en dólares es la suma de
      // los porcentajes aplicada a ese notional — no hay reinversión ni
      // interés compuesto en este modelo, a propósito: mezclar sizing con
      // criterio de salida haría que las estrategias dejen de ser comparables.
      totalUsd: everyPct.reduce((sum, pct) => sum + (pct / 100) * PAPER_NOTIONAL_USD, 0),
    }
  })

  res.status(200).json({
    notionalUsd: PAPER_NOTIONAL_USD,
    stats,
    positions: all.map((p) => ({ ...p, current_price: prices.get(p.ticker) ?? null })),
    signals: signals ?? [],
    decisions: decisions ?? [],
  })
}
