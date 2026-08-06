import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getUserIdFromRequest, supabaseAdmin } from '../_lib/supabaseAdmin.js'
import { extractDisplayFields } from '../_lib/parseSignal.js'
import { createPriceLookup } from '../_lib/priceHistory.js'

const DEFAULT_DAYS = 90
const MAX_DAYS = 365

// Tabla de "Alertas de Telegram" en Inversiones: una fila por alerta de
// compra, con los datos tal como los declaró el canal. Lee directo de
// `trade_signals` — ya parseado por regex en la ingesta del portfolio
// simulado (ver api/_lib/parseSignal.ts) — sin costo de LLM.
//
// PATCH acá mismo en vez de un archivo nuevo (api/telegram/edit-alert.ts):
// el plan Hobby de Vercel tope a 12 funciones y ya está al límite (ver
// CLAUDE.md) — un método HTTP más sobre la misma ruta, mismo patrón que
// api/paper/summary.ts (GET+POST) cuando pasó lo mismo.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await getUserIdFromRequest(req.headers.authorization)
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!chatId) {
    res.status(400).json({ error: 'Falta configurar TELEGRAM_CHAT_ID.' })
    return
  }

  if (req.method === 'PATCH') {
    await handlePatch(req, res, userId, chatId)
    return
  }

  await handleGet(req, res, userId, chatId)
}

async function handlePatch(req: VercelRequest, res: VercelResponse, userId: string, chatId: string) {
  const { id, date, ticker, possibleGainPct, stopLossPct, manualSellDate } = req.body ?? {}
  if (!id || typeof id !== 'string') {
    res.status(400).json({ error: 'Falta el id de la alerta.' })
    return
  }
  if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: 'Fecha inválida.' })
    return
  }
  const tickerClean = typeof ticker === 'string' ? ticker.trim().toUpperCase() : ''
  if (!tickerClean) {
    res.status(400).json({ error: 'El símbolo no puede estar vacío.' })
    return
  }
  // '' o null borra el cierre manual (vuelve a Abierta, salvo que exista una
  // alerta de venta real — ver handleGet). No se valida contra esa alerta
  // real acá: guardar una fecha manual cuando ya hay una de verdad no rompe
  // nada, simplemente queda sin usarse porque la real tiene prioridad.
  if (manualSellDate != null && manualSellDate !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(manualSellDate)) {
    res.status(400).json({ error: 'Fecha de venta inválida.' })
    return
  }

  const admin = supabaseAdmin()

  // Solo se edita lo que ya es de este usuario y sigue siendo una alerta de
  // compra — mantiene la hora original del mensaje, solo cambia el día
  // (editar la hora no tiene sentido acá, la UI solo pide una fecha).
  const { data: existing, error: fetchError } = await admin
    .from('trade_signals')
    .select('posted_at')
    .eq('id', id)
    .eq('user_id', userId)
    .eq('chat_id', chatId)
    .eq('kind', 'buy')
    .maybeSingle()

  if (fetchError) {
    res.status(500).json({ error: fetchError.message })
    return
  }
  if (!existing) {
    res.status(404).json({ error: 'No se encontró la alerta.' })
    return
  }

  const timeOfDay = existing.posted_at.slice(10)
  const newPostedAt = `${date}${timeOfDay}`

  const { error: updateError } = await admin
    .from('trade_signals')
    .update({
      posted_at: newPostedAt,
      ticker: tickerClean,
      possible_gain_pct: possibleGainPct === '' || possibleGainPct == null ? null : Number(possibleGainPct),
      possible_loss_pct: stopLossPct === '' || stopLossPct == null ? null : Number(stopLossPct),
      manual_sell_date: manualSellDate === '' || manualSellDate == null ? null : manualSellDate,
    })
    .eq('id', id)
    .eq('user_id', userId)

  if (updateError) {
    res.status(500).json({ error: updateError.message })
    return
  }

  res.status(200).json({ ok: true })
}

async function handleGet(req: VercelRequest, res: VercelResponse, userId: string, chatId: string) {
  const requestedDays = Number(req.query.days)
  const days = Number.isFinite(requestedDays) ? Math.min(Math.max(requestedDays, 1), MAX_DAYS) : DEFAULT_DAYS
  const fromMs = Date.now() - days * 24 * 60 * 60 * 1000

  const admin = supabaseAdmin()
  const { data: signals, error } = await admin
    .from('trade_signals')
    .select('id, posted_at, ticker, possible_gain_pct, possible_loss_pct, raw_text, manual_sell_date')
    .eq('user_id', userId)
    .eq('chat_id', chatId)
    .eq('kind', 'buy')
    .gte('posted_at', new Date(fromMs).toISOString())
    .order('posted_at', { ascending: false })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  // Para "abierta"/"cerrada" hace falta ver también las alertas de venta, y
  // no solo dentro de la ventana pedida: una compra de hace 89 días con venta
  // hace 2 tiene que verse cerrada aunque se esté mirando "30 días". Por eso
  // esta segunda consulta no filtra por fecha, solo trae lo mínimo (ticker,
  // kind, posted_at) de todo el historial del canal.
  const { data: allSignals, error: allError } = await admin
    .from('trade_signals')
    .select('ticker, kind, posted_at')
    .eq('user_id', userId)
    .eq('chat_id', chatId)
    .not('ticker', 'is', null)
    .order('posted_at', { ascending: true })

  if (allError) {
    res.status(500).json({ error: allError.message })
    return
  }

  // Recorre el historial completo por símbolo en orden cronológico: cada
  // compra abre una posición (si ya había una abierta, una nueva compra del
  // mismo símbolo no abre una segunda, se toma como ampliar la misma), cada
  // venta cierra la posición abierta más reciente de ese símbolo. Guarda,
  // para cada compra que quedó cerrada, el posted_at de la venta que la
  // cerró — eso es lo que se muestra como "Fecha de venta" en la tabla.
  const closedBuyToSellDate = new Map<string, string>()
  const eventsByTicker = new Map<string, { kind: string; posted_at: string }[]>()
  for (const s of allSignals ?? []) {
    const list = eventsByTicker.get(s.ticker!) ?? []
    list.push({ kind: s.kind, posted_at: s.posted_at })
    eventsByTicker.set(s.ticker!, list)
  }
  for (const [ticker, events] of eventsByTicker) {
    let openBuyAt: string | null = null
    for (const ev of events) {
      if (ev.kind === 'buy') {
        if (!openBuyAt) openBuyAt = ev.posted_at
      } else if (ev.kind === 'sell' && openBuyAt) {
        closedBuyToSellDate.set(`${ticker}|${openBuyAt}`, ev.posted_at)
        openBuyAt = null
      }
    }
  }

  // El precio de entrada se toma a la fecha de la alerta (primera rueda en o
  // después) — cachea por símbolo, así que un ticker que se repite en varias
  // alertas no vuelve a pedir la serie.
  const evaluate = createPriceLookup(fromMs)

  const alerts = await Promise.all(
    (signals ?? [])
      .filter((s) => s.ticker)
      .map(async (s) => {
        const { companyName } = extractDisplayFields(s.raw_text)
        // Una alerta de venta real del canal manda sobre el cierre manual
        // (ver 0018_trade_signal_manual_sell_date.sql) — si en algún momento
        // llega la de verdad, la manual queda de respaldo sin usarse.
        const autoSellDate = closedBuyToSellDate.get(`${s.ticker}|${s.posted_at}`)?.slice(0, 10) ?? null
        const sellDate = autoSellDate ?? s.manual_sell_date ?? null
        const sellDateSource: 'signal' | 'manual' | null = autoSellDate ? 'signal' : sellDate ? 'manual' : null
        // Cerrada: "% desde la alerta" mide la operación real, entrada a
        // venta, no hasta hoy. Abierta: sigue siendo hasta hoy (asOfDate
        // undefined), que es el comportamiento que ya tenía.
        const outcome = await evaluate(s.ticker!, s.posted_at.slice(0, 10), 'buy', sellDate ?? undefined)
        return {
          id: s.id,
          date: s.posted_at.slice(0, 10),
          ticker: s.ticker!,
          companyName,
          possibleGainPct: s.possible_gain_pct,
          stopLossPct: s.possible_loss_pct,
          changePct: outcome?.changePct ?? null,
          sellDate,
          sellDateSource,
          manualSellDate: s.manual_sell_date,
          status: sellDate ? 'closed' : 'open',
        }
      }),
  )

  res.status(200).json({ alerts, days })
}
