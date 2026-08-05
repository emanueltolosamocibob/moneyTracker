import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getUserIdFromRequest, supabaseAdmin } from '../_lib/supabaseAdmin.js'
import { extractDisplayFields } from '../_lib/parseSignal.js'
import { createPriceLookup } from '../_lib/priceHistory.js'

const DEFAULT_DAYS = 90
const MAX_DAYS = 365

// Tabla de "Alertas de Telegram" en Inversiones: una fila por alerta de
// compra, con los datos tal como los declaró el canal.
//
// A diferencia de api/telegram/analyze.ts (que manda hasta MAX_MESSAGES=300
// mensajes de chat crudo a un LLM), esto lee directo de `trade_signals` —
// ya parseado por regex en la ingesta del portfolio simulado (ver
// api/_lib/parseSignal.ts), sin límite de mensajes ni costo de LLM. Corrige
// un bug real: con 300 mensajes de tope y ~13 mensajes/día de charla en el
// canal, elegir "1 año" en el selector de período no cambiaba nada — esos
// 300 mensajes más recientes son ~3 semanas, así que siempre se veía "este
// mes" sin importar la ventana pedida.
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

  const requestedDays = Number(req.query.days)
  const days = Number.isFinite(requestedDays) ? Math.min(Math.max(requestedDays, 1), MAX_DAYS) : DEFAULT_DAYS
  const fromMs = Date.now() - days * 24 * 60 * 60 * 1000

  const admin = supabaseAdmin()
  const { data: signals, error } = await admin
    .from('trade_signals')
    .select('posted_at, ticker, possible_gain_pct, stop_loss, raw_text')
    .eq('user_id', userId)
    .eq('chat_id', chatId)
    .eq('kind', 'buy')
    .gte('posted_at', new Date(fromMs).toISOString())
    .order('posted_at', { ascending: false })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  // El precio de entrada se toma a la fecha de la alerta (primera rueda en o
  // después), igual que en analyze.ts — cachea por símbolo, así que un
  // ticker que se repite en varias alertas no vuelve a pedir la serie.
  const evaluate = createPriceLookup(fromMs)

  const alerts = await Promise.all(
    (signals ?? [])
      .filter((s) => s.ticker)
      .map(async (s) => {
        const { companyName, sellBeforeDate } = extractDisplayFields(s.raw_text)
        const outcome = await evaluate(s.ticker!, s.posted_at.slice(0, 10), 'buy')
        return {
          date: s.posted_at.slice(0, 10),
          ticker: s.ticker!,
          companyName,
          possibleGainPct: s.possible_gain_pct,
          stopLoss: s.stop_loss,
          changePct: outcome?.changePct ?? null,
          sellBeforeDate,
        }
      }),
  )

  res.status(200).json({ alerts, days })
}
