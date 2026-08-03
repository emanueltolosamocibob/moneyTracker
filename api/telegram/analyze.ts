import type { VercelRequest, VercelResponse } from '@vercel/node'
import { generateObject } from 'ai'
import { google } from '@ai-sdk/google'
import { z } from 'zod'
import { getUserIdFromRequest, supabaseAdmin } from '../_lib/supabaseAdmin.js'
import { throttleGeminiCall } from '../_lib/categorize.js'
import { createPriceLookup, type SignalOutcome } from '../_lib/priceHistory.js'

const DEFAULT_DAYS = 90
const MAX_DAYS = 365

// Un grupo de alertas es sobre todo charla: memes, preguntas, "gracias
// maestro". Mandar todo a Gemini se come la cuota de tokens por minuto
// (250K/min en el free tier) sin agregar señal. Se toman los más recientes de
// la ventana y se trunca cada uno — una alerta real entra de sobra en 500
// caracteres; lo que se corta son las parrafadas de análisis largo.
const MAX_MESSAGES = 300
const MAX_CHARS_PER_MESSAGE = 500

const signalSchema = z.object({
  symbol: z.string().describe('Ticker del activo, en mayúsculas, sin sufijo de mercado (ej. GGAL, AAPL, YPFD)'),
  action: z.enum(['buy', 'sell', 'hold']),
  date: z.string().describe('Fecha de la alerta en formato YYYY-MM-DD, tomada del mensaje que la contiene'),
  target_price: z.number().nullable().describe('Precio objetivo si la alerta lo menciona, si no null'),
  stop_loss: z.number().nullable().describe('Stop loss si la alerta lo menciona, si no null'),
  rationale: z.string().describe('En una línea, el motivo que da el mensaje. Si no da ninguno, decilo.'),
  confidence: z.number().min(0).max(1).describe('Qué tan claro es que esto era una recomendación concreta y no un comentario al pasar'),
})

const analysisSchema = z.object({
  summary: z
    .string()
    .describe(
      'Resumen en prosa, 3 a 5 oraciones, en español rioplatense: sesgo general del grupo (más comprador o más vendedor), papeles más mencionados, temas recurrentes y cualquier cambio de tono a lo largo del período.',
    ),
  signals: z.array(signalSchema),
})

type Signal = z.infer<typeof signalSchema>

interface EnrichedSignal extends Signal {
  // true si el símbolo está en la cartera del usuario (investment_lots con
  // remaining_quantity > 0). Es lo que separa "esto te toca" de "esto es un
  // papel que no tenés".
  in_portfolio: boolean
  outcome: SignalOutcome | null
}

// Botón "Analizar" del bloque de alertas en Inversiones. Corre sobre los
// mensajes que ya están en la base (los trae el sync, ver
// api/_lib/telegramSync.ts) — no habla con Telegram.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

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

  const requestedDays = Number(req.body?.days)
  const days = Number.isFinite(requestedDays) ? Math.min(Math.max(requestedDays, 1), MAX_DAYS) : DEFAULT_DAYS
  const fromMs = Date.now() - days * 24 * 60 * 60 * 1000
  const fromIso = new Date(fromMs).toISOString()

  const admin = supabaseAdmin()

  const [{ data: messages, error: messagesError }, { data: lots, error: lotsError }] = await Promise.all([
    admin
      .from('telegram_messages')
      .select('message_id, sent_at, sender, text')
      .eq('user_id', userId)
      .eq('chat_id', chatId)
      .gte('sent_at', fromIso)
      .order('sent_at', { ascending: false })
      .limit(MAX_MESSAGES),
    admin.from('investment_lots').select('symbol, remaining_quantity').eq('user_id', userId),
  ])

  if (messagesError || lotsError) {
    res.status(500).json({ error: messagesError?.message ?? lotsError?.message ?? 'Error al leer los datos.' })
    return
  }

  if (!messages || messages.length === 0) {
    res.status(400).json({ error: `No hay mensajes sincronizados en los últimos ${days} días.` })
    return
  }

  // Al LLM se le pasan en orden cronológico aunque la query los haya traído
  // al revés (el `limit` tiene que quedarse con los más nuevos, no con los
  // más viejos de la ventana): leer la conversación hacia adelante es lo que
  // le permite detectar cambios de tono.
  const chronological = [...messages].reverse()
  const transcript = chronological
    .map((m) => `[${m.sent_at.slice(0, 10)}] ${m.sender ?? 'anónimo'}: ${m.text.slice(0, MAX_CHARS_PER_MESSAGE)}`)
    .join('\n')

  const portfolio = new Set(
    (lots ?? []).filter((l) => Number(l.remaining_quantity) > 0).map((l) => l.symbol.toUpperCase()),
  )

  try {
    await throttleGeminiCall()
    const { object } = await generateObject({
      model: google('gemini-3.5-flash-lite'),
      schema: analysisSchema,
      prompt: `Abajo está el historial de un grupo de Telegram donde se mandan alertas de compra y venta de acciones (mercado argentino y del exterior). Cada línea trae la fecha, el remitente y el texto.

Extraé todas las recomendaciones concretas de compra o venta de un activo puntual. Reglas:
- Una recomendación necesita un ticker identificable. Si el mensaje habla del mercado en general, ignoralo.
- La fecha de la señal es la del mensaje que la contiene, no la de hoy.
- Charla, preguntas, agradecimientos, memes y noticias sin recomendación no son señales.
- Si el mismo papel se recomienda varias veces en fechas distintas, son señales distintas, una por fecha.
- Poné confidence bajo cuando la recomendación es ambigua ("ojo con GGAL") y alto cuando es explícita ("compro GGAL a 7800, stop 7400").

Los activos que ya tiene el usuario en cartera son: ${portfolio.size > 0 ? Array.from(portfolio).join(', ') : '(ninguno)'}. No cambia qué señales extraer, es solo contexto para el resumen.

---
${transcript}
---`,
    })

    // El rendimiento se calcula acá y no en el LLM a propósito: un modelo no
    // sabe a cuánto cerró un papel, lo inventaría. La ventana de precios
    // arranca en el mismo punto que la de mensajes para que la señal más
    // vieja también tenga precio de entrada.
    const evaluate = createPriceLookup(fromMs)
    const signals: EnrichedSignal[] = []
    for (const signal of object.signals) {
      const symbol = signal.symbol.trim().toUpperCase()
      signals.push({
        ...signal,
        symbol,
        in_portfolio: portfolio.has(symbol),
        outcome: await evaluate(symbol, signal.date, signal.action),
      })
    }

    const analysis = {
      user_id: userId,
      chat_id: chatId,
      from_date: fromIso.slice(0, 10),
      to_date: new Date().toISOString().slice(0, 10),
      message_count: messages.length,
      summary: object.summary,
      signals,
    }

    // Guardar el resultado es lo que hace que volver a entrar a Inversiones no
    // dispare otra llamada a Gemini: la UI lee el último análisis y el botón
    // es el único que genera uno nuevo.
    const { data: saved, error: saveError } = await admin
      .from('telegram_analyses')
      .insert(analysis)
      .select('*')
      .single()

    if (saveError) {
      // El análisis ya está hecho y pagado; que no se haya podido cachear no
      // es razón para no devolvérselo al usuario.
      console.error('[telegram-analyze] no se pudo guardar el análisis:', saveError)
      res.status(200).json({ analysis: { ...analysis, created_at: new Date().toISOString() } })
      return
    }

    res.status(200).json({ analysis: saved })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
}
