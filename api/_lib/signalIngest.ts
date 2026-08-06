import { supabaseAdmin } from './supabaseAdmin.js'
import { parseSignal, type ParsedSignal } from './parseSignal.js'

type Admin = ReturnType<typeof supabaseAdmin>

interface RawMessage {
  message_id: number
  sent_at: string
  text: string
}

export interface ProcessResult {
  parsed: boolean
  kind: ParsedSignal['kind'] | null
}

// Guarda la señal parseada en trade_signals, la fuente que lee la tabla de
// "Alertas de Telegram" (api/telegram/buy-alerts.ts).
async function insertSignal(admin: Admin, userId: string, chatId: string, message: RawMessage, parsed: ParsedSignal) {
  const { error } = await admin.from('trade_signals').insert({
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

  // 23505 = unique(user_id, chat_id, message_id): este mensaje ya se había
  // procesado (reintento, o el cron alcanzó algo que otra corrida ya había
  // guardado). No es un error, es un no-op esperado.
  if (error && error.code !== '23505') throw new Error(`No se pudo guardar la señal: ${error.message}`)
}

export async function processMessage(admin: Admin, userId: string, chatId: string, message: RawMessage): Promise<ProcessResult> {
  const parsed = parseSignal(message.text)
  if (!parsed) return { parsed: false, kind: null }
  await insertSignal(admin, userId, chatId, message, parsed)
  return { parsed: true, kind: parsed.kind }
}

// Convierte en trade_signals los mensajes de telegram_messages que todavía
// no tienen una fila propia. Es regex puro (parseSignal), sin costo de LLM,
// así que se corre entero en cada sync en vez de necesitar un patrón
// hasMore/batch como el resto de la ingesta.
export async function ingestUnprocessedSignals(admin: Admin, userId: string, chatId: string) {
  const { data: seen } = await admin.from('trade_signals').select('message_id').eq('user_id', userId).eq('chat_id', chatId)
  const seenIds = new Set((seen ?? []).map((s) => s.message_id))

  const { data: messages } = await admin
    .from('telegram_messages')
    .select('message_id, sent_at, text')
    .eq('user_id', userId)
    .eq('chat_id', chatId)
    .order('sent_at', { ascending: true })
    .limit(5000)

  const pending = (messages ?? []).filter((m) => !seenIds.has(m.message_id))

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
