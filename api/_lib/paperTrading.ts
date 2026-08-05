import { supabaseAdmin } from './supabaseAdmin.js'
import { parseSignal, type ParsedSignal } from './parseSignal.js'
import { getDailyBars, getQuote, type DailyBar } from './priceHistory.js'
import { PAPER_NOTIONAL_USD, PAPER_STRATEGIES } from './paperStrategies.js'
import { evaluatePosition, summarizeBars } from './evaluatePosition.js'

type Admin = ReturnType<typeof supabaseAdmin>

interface RawMessage {
  message_id: number
  sent_at: string
  text: string
}

export interface ProcessResult {
  parsed: boolean
  kind: ParsedSignal['kind'] | null
  positionsOpened: number
  positionsClosed: number
  unpriced: boolean
}

function pnlPct(entry: number, exit: number) {
  return ((exit - entry) / entry) * 100
}

async function insertSignal(admin: Admin, userId: string, chatId: string, message: RawMessage, parsed: ParsedSignal) {
  const { data, error } = await admin
    .from('trade_signals')
    .insert({
      user_id: userId,
      chat_id: chatId,
      message_id: message.message_id,
      posted_at: message.sent_at,
      kind: parsed.kind,
      ticker: parsed.ticker,
      take_profit: parsed.takeProfit,
      stop_loss: parsed.stopLoss,
      possible_gain_pct: parsed.possibleGainPct,
      possible_loss_pct: parsed.possibleLossPct,
      risk_benefit: parsed.riskBenefit,
      reported_result_pct: parsed.reportedResultPct,
      raw_text: message.text,
    })
    .select('id')
    .single()

  // 23505 = unique(user_id, chat_id, message_id): este mensaje ya se había
  // procesado (reintento, o el catch-up del cron alcanzó algo que el
  // listener ya había mandado). No es un error, es un no-op esperado.
  if (error && error.code !== '23505') throw new Error(`No se pudo guardar la señal: ${error.message}`)
  return data ?? null
}

async function openPositionsForSignal(
  admin: Admin,
  userId: string,
  signalId: string,
  parsed: ParsedSignal,
  ticker: string,
  postedAt: string,
): Promise<{ opened: number; priced: boolean }> {
  const quote = await getQuote(ticker)
  if (!quote) {
    // Sin precio no se puede abrir nada: la señal queda guardada igual (para
    // el histórico y para que una alerta de venta futura la pueda
    // emparejar), pero no genera posiciones. Pasa con alertas de bonos, que
    // nombran especies que Yahoo no cotiza.
    console.warn(`[paper] sin cotización para ${ticker}, señal ${signalId} guardada sin posiciones`)
    return { opened: 0, priced: false }
  }

  const needsBenchmark = PAPER_STRATEGIES.some((s) => s.symbolFor(ticker) !== ticker)
  const benchmarkSymbol = needsBenchmark ? PAPER_STRATEGIES.find((s) => s.symbolFor(ticker) !== ticker)!.symbolFor(ticker) : null
  const benchmarkQuote = benchmarkSymbol ? await getQuote(benchmarkSymbol) : null

  let opened = 0
  for (const strategy of PAPER_STRATEGIES) {
    const symbol = strategy.symbolFor(ticker)
    const price = symbol === ticker ? quote.price : benchmarkQuote?.price
    if (!price) continue

    // Los niveles se calculan sobre el precio del papel de la alerta, no
    // sobre el del benchmark — el benchmark no tiene niveles propios.
    const levels = symbol === ticker ? strategy.levels(price, parsed) : null

    const { error } = await admin.from('paper_positions').insert({
      user_id: userId,
      strategy: strategy.key,
      signal_id: signalId,
      ticker: symbol,
      opened_at: postedAt,
      entry_price: price,
      quantity: PAPER_NOTIONAL_USD / price,
      take_profit: levels?.takeProfit ?? null,
      stop_loss: levels?.stopLoss ?? null,
      status: 'open',
    })

    if (!error) {
      opened += 1
    } else if (error.code !== '23505') {
      console.error(`[paper] no se pudo abrir ${strategy.key}/${symbol}:`, error)
    }
  }

  return { opened, priced: true }
}

async function closePosition(admin: Admin, position: { id: string; entry_price: number }, exitPrice: number, reason: string, closedAt: string) {
  await admin
    .from('paper_positions')
    .update({
      status: 'closed',
      closed_at: closedAt,
      exit_price: exitPrice,
      exit_reason: reason,
      pnl_pct: pnlPct(position.entry_price, exitPrice),
    })
    .eq('id', position.id)
}

// El canal publicó su alerta de venta: cierra únicamente las posiciones de la
// estrategia que sigue al canal al pie de la letra. Las demás siguen
// abiertas — que el canal salga es justamente una de las decisiones que este
// experimento está midiendo, no un hecho que haya que copiar en todas.
async function closeChannelExits(admin: Admin, userId: string, ticker: string, soldAt: string): Promise<number> {
  const channelStrategies = PAPER_STRATEGIES.filter((s) => s.closesOnChannelSell).map((s) => s.key)
  if (channelStrategies.length === 0) return 0

  const { data: positions } = await admin
    .from('paper_positions')
    .select('id, entry_price')
    .eq('user_id', userId)
    .eq('ticker', ticker)
    .eq('status', 'open')
    .in('strategy', channelStrategies)

  if (!positions?.length) return 0

  const quote = await getQuote(ticker)
  if (!quote) {
    console.warn(`[paper] alerta de venta de ${ticker} sin cotización: no se cerró nada`)
    return 0
  }

  for (const position of positions) {
    await closePosition(admin, position, quote.price, 'channel_sell', soldAt)
  }
  return positions.length
}

// Núcleo compartido por las dos rutas de ingesta: el listener local en
// tiempo real (un mensaje a la vez, ver api/paper/ingest-message.ts) y el
// catch-up del cron (varios mensajes ya guardados por telegramSync.ts que el
// listener no vio porque estaba apagado, ver ingestUnprocessedSignals).
export async function processMessage(admin: Admin, userId: string, chatId: string, message: RawMessage): Promise<ProcessResult> {
  const parsed = parseSignal(message.text)
  if (!parsed) return { parsed: false, kind: null, positionsOpened: 0, positionsClosed: 0, unpriced: false }

  const signal = await insertSignal(admin, userId, chatId, message, parsed)
  // signal es null cuando el insert chocó por duplicado (23505): ya se
  // había procesado este mensaje, no hay nada más que hacer.
  if (!signal || !parsed.ticker) {
    return { parsed: true, kind: parsed.kind, positionsOpened: 0, positionsClosed: 0, unpriced: false }
  }

  if (parsed.kind === 'buy') {
    const { opened, priced } = await openPositionsForSignal(admin, userId, signal.id, parsed, parsed.ticker, message.sent_at)
    return { parsed: true, kind: 'buy', positionsOpened: opened, positionsClosed: 0, unpriced: !priced }
  }

  const closed = await closeChannelExits(admin, userId, parsed.ticker, message.sent_at)
  return { parsed: true, kind: 'sell', positionsOpened: 0, positionsClosed: closed, unpriced: false }
}

// Catch-up: procesa los mensajes de telegram_messages que todavía no tienen
// una fila en trade_signals. Cubre el caso de que el backfill/cron haya
// traído mensajes mientras el listener local estaba apagado — sin esto,
// esos mensajes quedarían guardados como texto crudo pero nunca se
// convertirían en señales ni abrirían posiciones.
export async function ingestUnprocessedSignals(admin: Admin, userId: string, chatId: string, limit = 200) {
  const { data: seen } = await admin.from('trade_signals').select('message_id').eq('user_id', userId).eq('chat_id', chatId)
  const seenIds = new Set((seen ?? []).map((s) => s.message_id))

  const { data: messages } = await admin
    .from('telegram_messages')
    .select('message_id, sent_at, text')
    .eq('user_id', userId)
    .eq('chat_id', chatId)
    .order('sent_at', { ascending: true })
    .limit(2000)

  const pending = (messages ?? []).filter((m) => !seenIds.has(m.message_id)).slice(0, limit)

  let processed = 0
  let buys = 0
  let sells = 0
  for (const message of pending) {
    const result = await processMessage(admin, userId, chatId, message)
    if (result.parsed) {
      processed += 1
      if (result.kind === 'buy') buys += 1
      if (result.kind === 'sell') sells += 1
    }
  }
  return { scanned: pending.length, processed, buys, sells }
}

// ---------------------------------------------------------------------
// Evaluación de posiciones abiertas
// ---------------------------------------------------------------------

interface OpenPosition {
  id: string
  strategy: string
  signal_id: string
  ticker: string
  opened_at: string
  entry_price: number
  take_profit: number | null
  stop_loss: number | null
}

export interface EvaluateResult {
  openPositions: number
  ruleExits: number
  mirrorExits: number
  evaluated: number
  llmExits: number
  unpriced: number
  hasMore: boolean
}

// Cuántas posiciones discrecionales se evalúan por invocación. Cada una
// cuesta 2 llamadas a Gemini espaciadas ~4,5s (throttleGeminiCall en
// categorize.ts), o sea ~9s por posición: con 5 la función queda cómoda bajo
// el límite de 300s de Vercel. El llamador repite mientras `hasMore` siga en
// true, mismo patrón que scanGmailForUser.ts.
const LLM_BATCH_SIZE = 5

// Las estrategias de regla se resuelven contra velas diarias cerradas, y se
// saltea a propósito la vela del propio día de entrada: entramos a mitad de
// rueda, con el precio ya adentro del rango de ese día, así que contar su
// máximo y su mínimo daría salidas que en la realidad no se pudieron tomar
// (y, sobre todo, dispararía stops con movimientos anteriores a la compra).
function findRuleExit(
  bars: DailyBar[],
  openedDate: string,
  takeProfit: number | null,
  stopLoss: number | null,
): { price: number; reason: 'take_profit' | 'stop_loss'; date: string } | null {
  for (const bar of bars) {
    if (bar.date <= openedDate) continue
    // El stop se evalúa primero: cuando una misma vela toca los dos niveles
    // no hay forma de saber cuál pasó antes, y asumir el peor caso es la
    // única opción que no infla el resultado de las estrategias con stop.
    if (stopLoss != null && bar.low <= stopLoss) return { price: stopLoss, reason: 'stop_loss', date: bar.date }
    if (takeProfit != null && bar.high >= takeProfit) return { price: takeProfit, reason: 'take_profit', date: bar.date }
  }
  return null
}

// Las velas diarias no tienen hora; se cierra al horario de cierre de
// EE.UU. para que el orden temporal contra otras posiciones del mismo día
// sea determinista.
function closeTimestamp(date: string) {
  return `${date}T20:00:00.000Z`
}

export async function evaluateOpenPositions(admin: Admin, userId: string): Promise<EvaluateResult> {
  const { data: positions } = await admin
    .from('paper_positions')
    .select('id, strategy, signal_id, ticker, opened_at, entry_price, take_profit, stop_loss')
    .eq('user_id', userId)
    .eq('status', 'open')
    .order('opened_at', { ascending: true })

  const open = (positions ?? []) as OpenPosition[]
  const result: EvaluateResult = { openPositions: open.length, ruleExits: 0, mirrorExits: 0, evaluated: 0, llmExits: 0, unpriced: 0, hasMore: false }
  if (open.length === 0) return result

  const strategyOf = new Map(PAPER_STRATEGIES.map((s) => [s.key, s] as const))

  // Un solo pedido de velas por ticker, desde la entrada más vieja que siga
  // abierta: varias estrategias (y varias alertas del mismo papel) comparten
  // exactamente la misma serie.
  const barsByTicker = new Map<string, DailyBar[]>()
  for (const position of open) {
    if (barsByTicker.has(position.ticker)) continue
    const earliest = open.filter((p) => p.ticker === position.ticker).reduce((min, p) => (p.opened_at < min ? p.opened_at : min), position.opened_at)
    barsByTicker.set(position.ticker, await getDailyBars(position.ticker, new Date(earliest)))
  }

  const closedNow = new Set<string>()

  // --- 1. Estrategias de regla: deterministas y sin costo de LLM ---
  for (const position of open) {
    const strategy = strategyOf.get(position.strategy)
    if (!strategy || strategy.discretionary || strategy.mirrorOf) continue
    if (position.take_profit == null && position.stop_loss == null) continue

    const bars = barsByTicker.get(position.ticker) ?? []
    const exit = findRuleExit(bars, position.opened_at.slice(0, 10), position.take_profit, position.stop_loss)
    if (!exit) continue

    await closePosition(admin, position, exit.price, exit.reason, closeTimestamp(exit.date))
    closedNow.add(position.id)
    result.ruleExits += 1
  }

  // --- 2. Estrategia discrecional: el modelo mira cada posición ---
  const discretionary = open.filter((p) => strategyOf.get(p.strategy)?.discretionary && !closedNow.has(p.id))
  const batch = discretionary.slice(0, LLM_BATCH_SIZE)
  result.hasMore = discretionary.length > batch.length

  // Un ticker cuya alerta de venta ya publicó el canal: información que el
  // modelo debería tener a la vista, aunque no esté obligado a copiarla.
  const { data: sellSignals } = await admin.from('trade_signals').select('ticker').eq('user_id', userId).eq('kind', 'sell')
  const soldByChannel = new Set((sellSignals ?? []).map((s) => s.ticker).filter(Boolean))

  for (const position of batch) {
    const bars = barsByTicker.get(position.ticker) ?? []
    const quote = await getQuote(position.ticker)
    const currentPrice = quote?.price ?? bars.at(-1)?.close
    if (!currentPrice) {
      // Sin precio confiable la posición queda abierta. Cerrar a ciegas
      // inventaría el resultado del experimento.
      result.unpriced += 1
      continue
    }

    const barsSinceEntry = bars.filter((b) => b.date > position.opened_at.slice(0, 10))
    const summary = summarizeBars(position.entry_price, barsSinceEntry)
    const daysHeld = Math.max(0, Math.round((Date.now() - new Date(position.opened_at).getTime()) / 86_400_000))

    const { data: signal } = await admin.from('trade_signals').select('take_profit, stop_loss').eq('id', position.signal_id).maybeSingle()

    let decision
    try {
      decision = await evaluatePosition({
        ticker: position.ticker,
        entryPrice: position.entry_price,
        currentPrice,
        pnlPct: pnlPct(position.entry_price, currentPrice),
        openedAt: position.opened_at.slice(0, 10),
        daysHeld,
        maxGainPct: summary.maxGainPct,
        maxDrawdownPct: summary.maxDrawdownPct,
        avgDailyRangePct: summary.avgDailyRangePct,
        signalTakeProfit: signal?.take_profit ?? null,
        signalStopLoss: signal?.stop_loss ?? null,
        channelSold: soldByChannel.has(position.ticker),
      })
    } catch (err) {
      // Quedarse sin cuota de Gemini a mitad del loop no debe abortar la
      // corrida entera ni, mucho menos, cerrar posiciones por defecto.
      console.error(`[paper] evaluación falló para ${position.ticker}:`, err)
      continue
    }

    result.evaluated += 1

    // La decisión se registra siempre, también cuando es mantener: sin las
    // decisiones de "hold" la bitácora no permite auditar el criterio.
    await admin.from('paper_decisions').insert({
      user_id: userId,
      position_id: position.id,
      action: decision.action,
      price: currentPrice,
      pnl_pct: pnlPct(position.entry_price, currentPrice),
      confidence: decision.confidence,
      rationale: decision.rationale,
      research: decision.research,
      model: decision.model,
    })

    if (decision.action === 'sell') {
      await closePosition(admin, position, currentPrice, 'llm', new Date().toISOString())
      closedNow.add(position.id)
      result.llmExits += 1
    }
  }

  // --- 3. Espejos: el benchmark se cierra cuando se cierra su par ---
  // Después de las otras dos etapas, para que una salida decidida en esta
  // misma corrida ya arrastre a su benchmark y las dos ventanas temporales
  // queden idénticas.
  for (const position of open) {
    const strategy = strategyOf.get(position.strategy)
    if (!strategy?.mirrorOf || closedNow.has(position.id)) continue

    const { data: twin } = await admin
      .from('paper_positions')
      .select('status, closed_at')
      .eq('user_id', userId)
      .eq('signal_id', position.signal_id)
      .eq('strategy', strategy.mirrorOf)
      .maybeSingle()
    if (!twin || twin.status !== 'closed') continue

    const quote = await getQuote(position.ticker)
    const price = quote?.price ?? barsByTicker.get(position.ticker)?.at(-1)?.close
    if (!price) {
      result.unpriced += 1
      continue
    }

    await closePosition(admin, position, price, 'llm', twin.closed_at ?? new Date().toISOString())
    result.mirrorExits += 1
  }

  console.log(
    `[paper] evaluación user=${userId}: ${result.openPositions} abiertas, ${result.ruleExits} salidas por regla, ` +
      `${result.evaluated} evaluadas por el modelo (${result.llmExits} ventas), ${result.mirrorExits} benchmarks cerrados ` +
      `(sin_precio=${result.unpriced} hasMore=${result.hasMore})`,
  )
  return result
}
