import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getUserIdFromRequest, supabaseAdmin } from '../_lib/supabaseAdmin.js'
import { extractDisplayFields } from '../_lib/parseSignal.js'
import { createPriceLookup, getTodayChangePct, type TodayChange } from '../_lib/priceHistory.js'

const DEFAULT_DAYS = 90
const MAX_DAYS = 365

// Tabla de "Alertas de Telegram" en Inversiones: una fila por alerta de
// compra, con los datos tal como los declaró el canal. Lee directo de
// `trade_signals` — ya parseado por regex al sincronizar (ver
// api/_lib/signalIngest.ts y api/_lib/parseSignal.ts) — sin costo de LLM.
//
// PATCH acá mismo en vez de un archivo nuevo (api/telegram/edit-alert.ts):
// el plan Hobby de Vercel tope a 12 funciones (ver CLAUDE.md) y no vale la
// pena gastar una función más por un método HTTP.
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
  if (req.method === 'POST') {
    await handlePost(req, res, userId, chatId)
    return
  }
  if (req.method === 'DELETE') {
    await handleDelete(req, res, userId, chatId)
    return
  }

  await handleGet(req, res, userId, chatId)
}

// Alerta de compra cargada a mano (botón "+ Agregar alerta"), sin mensaje
// real de Telegram detrás — ver 0019_trade_signal_manual_flag.sql. message_id
// negativo porque los ids reales de Telegram siempre son positivos (evita
// pisar uno real) y raw_text se arma en el mismo formato que ya sabe leer
// extractDisplayFields, para no tener que duplicar esa lógica acá.
async function handlePost(req: VercelRequest, res: VercelResponse, userId: string, chatId: string) {
  const { date, ticker, companyName, possibleGainPct, stopLossPct } = req.body ?? {}
  if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: 'Fecha inválida.' })
    return
  }
  const tickerClean = typeof ticker === 'string' ? ticker.trim().toUpperCase() : ''
  if (!tickerClean) {
    res.status(400).json({ error: 'El símbolo no puede estar vacío.' })
    return
  }
  const companyClean = typeof companyName === 'string' ? companyName.trim() : ''

  const admin = supabaseAdmin()
  const rawText = `🟢ALERTA DE COMPRA🟢 ${companyClean || tickerClean} ($${tickerClean}) [Cargada manualmente]`

  const { error: insertError } = await admin.from('trade_signals').insert({
    user_id: userId,
    chat_id: chatId,
    message_id: -Date.now(),
    posted_at: `${date}T12:00:00.000Z`,
    kind: 'buy',
    ticker: tickerClean,
    possible_gain_pct: possibleGainPct === '' || possibleGainPct == null ? null : Number(possibleGainPct),
    possible_loss_pct: stopLossPct === '' || stopLossPct == null ? null : Number(stopLossPct),
    raw_text: rawText,
    is_manual: true,
  })

  if (insertError) {
    res.status(500).json({ error: insertError.message })
    return
  }

  res.status(200).json({ ok: true })
}

// Solo borra lo que ya es de este usuario y sigue siendo una alerta de compra.
async function handleDelete(req: VercelRequest, res: VercelResponse, userId: string, chatId: string) {
  const id = typeof req.query.id === 'string' ? req.query.id : null
  if (!id) {
    res.status(400).json({ error: 'Falta el id de la alerta.' })
    return
  }

  const admin = supabaseAdmin()
  const { error: deleteError } = await admin
    .from('trade_signals')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .eq('chat_id', chatId)
    .eq('kind', 'buy')

  if (deleteError) {
    res.status(500).json({ error: deleteError.message })
    return
  }

  res.status(200).json({ ok: true })
}

async function handlePatch(req: VercelRequest, res: VercelResponse, userId: string, chatId: string) {
  const { id, date, ticker, possibleGainPct, stopLossPct, manualSellDate, resultPct } = req.body ?? {}
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
      // Reusa reported_result_pct: en una fila kind='sell' es el % que el
      // canal reportó en su propio mensaje de venta; en kind='buy' (esta
      // ruta solo edita compras) nunca lo pobló el parser, así que queda
      // libre para el resultado real cargado a mano cuando Yahoo no tiene
      // serie para el símbolo y el cálculo automático da null (ver
      // handleGet) — no hizo falta agregar una columna nueva.
      reported_result_pct: resultPct === '' || resultPct == null ? null : Number(resultPct),
    })
    .eq('id', id)
    .eq('user_id', userId)

  if (updateError) {
    res.status(500).json({ error: updateError.message })
    return
  }

  res.status(200).json({ ok: true })
}

function parseDateParam(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

async function handleGet(req: VercelRequest, res: VercelResponse, userId: string, chatId: string) {
  // Rango personalizado (from/to, YYYY-MM-DD) tiene prioridad sobre days: lo
  // manda el selector "Personalizado" del frontend cuando el usuario elige
  // fechas puntuales en vez de uno de los períodos fijos.
  const fromParam = parseDateParam(req.query.from)
  const toParam = parseDateParam(req.query.to)

  let days: number | null = null
  let fromMs: number
  let toMs: number | null = null

  if (fromParam && toParam) {
    fromMs = new Date(`${fromParam}T00:00:00.000Z`).getTime()
    toMs = new Date(`${toParam}T23:59:59.999Z`).getTime()
  } else {
    const requestedDays = Number(req.query.days)
    days = Number.isFinite(requestedDays) ? Math.min(Math.max(requestedDays, 1), MAX_DAYS) : DEFAULT_DAYS
    fromMs = Date.now() - days * 24 * 60 * 60 * 1000
  }

  const admin = supabaseAdmin()
  let signalsQuery = admin
    .from('trade_signals')
    .select('id, posted_at, ticker, possible_gain_pct, possible_loss_pct, raw_text, manual_sell_date, reported_result_pct, is_manual')
    .eq('user_id', userId)
    .eq('chat_id', chatId)
    .eq('kind', 'buy')
    .gte('posted_at', new Date(fromMs).toISOString())
  if (toMs != null) signalsQuery = signalsQuery.lte('posted_at', new Date(toMs).toISOString())

  const { data: signals, error } = await signalsQuery.order('posted_at', { ascending: false })

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

  // % en el día (contra la apertura de hoy) — solo tiene sentido para
  // alertas abiertas, pero se pide por ticker una sola vez acá igual que
  // `evaluate` cachea por símbolo dentro de esta misma corrida.
  const todayChangeCache = new Map<string, Promise<TodayChange | null>>()
  function todayChangeFor(ticker: string) {
    let pending = todayChangeCache.get(ticker)
    if (!pending) {
      pending = getTodayChangePct(ticker)
      todayChangeCache.set(ticker, pending)
    }
    return pending
  }

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
        // Un resultado cargado a mano (ver handlePatch) manda sobre el
        // calculado con Yahoo — para cuando ese cálculo automático da null
        // (símbolo sin serie ahí) pero el usuario sabe el resultado real.
        const changePctSource: 'manual' | 'computed' | null =
          s.reported_result_pct != null ? 'manual' : outcome?.changePct != null ? 'computed' : null
        // Cerrada: la rueda de hoy no es parte de la operación, no vale la
        // pena pedirla.
        const todayChange = sellDate ? null : await todayChangeFor(s.ticker!)
        return {
          id: s.id,
          date: s.posted_at.slice(0, 10),
          ticker: s.ticker!,
          companyName,
          possibleGainPct: s.possible_gain_pct,
          stopLossPct: s.possible_loss_pct,
          changePct: s.reported_result_pct ?? outcome?.changePct ?? null,
          changePctSource,
          manualResultPct: s.reported_result_pct,
          sellDate,
          sellDateSource,
          manualSellDate: s.manual_sell_date,
          status: sellDate ? 'closed' : 'open',
          isManual: s.is_manual,
          todayChangePct: todayChange?.changePct ?? null,
        }
      }),
  )

  res.status(200).json({ alerts, days, from: fromParam, to: toParam })
}
