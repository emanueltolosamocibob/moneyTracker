import { generateObject, generateText, stepCountIs } from 'ai'
import { google } from '@ai-sdk/google'
import { z } from 'zod'
import { throttleGeminiCall } from './categorize.js'
import type { DailyBar } from './priceHistory.js'

// La única estrategia discrecional del paper trading (ver paperStrategies.ts).
// Se corre sobre cada posición abierta y decide mantener o vender.
//
// Dos llamadas a Gemini por posición evaluada: una búsqueda de noticias del
// papel, y una decisión estructurada con esa búsqueda como contexto. Mismo
// patrón de dos pasadas que categorize.ts, y por el mismo motivo — el modelo
// solo no tiene con qué distinguir una caída por ruido de una por una
// noticia concreta.

const decisionSchema = z.object({
  action: z.enum(['hold', 'sell']).describe('hold = mantener la posición, sell = cerrarla ahora'),
  confidence: z.number().min(0).max(1),
  rationale: z
    .string()
    .describe(
      'Dos o tres oraciones en español explicando la decisión, mencionando explícitamente qué evidencia la sostiene (precio, noticia concreta, o ninguna).',
    ),
})

export interface PositionContext {
  ticker: string
  entryPrice: number
  currentPrice: number
  pnlPct: number
  openedAt: string
  daysHeld: number
  // Máximo y mínimo alcanzados desde la entrada, en % sobre el precio de
  // entrada. Sin esto el modelo solo ve la foto de hoy y no puede distinguir
  // "viene subiendo" de "se dio vuelta".
  maxGainPct: number
  maxDrawdownPct: number
  // Rango diario promedio del papel desde la entrada, en %. Es el dato que le
  // faltaba a la regla +3%/-3% original: un movimiento menor a esto no es
  // una señal, es el ruido normal del papel.
  avgDailyRangePct: number
  // Niveles que declaraba la alerta original del canal — información, no
  // orden: esta estrategia no está obligada a respetarlos (para eso existe
  // channel_levels).
  signalTakeProfit: number | null
  signalStopLoss: number | null
  // El canal ya publicó su alerta de venta para este ticker.
  channelSold: boolean
}

export interface PositionDecision {
  action: 'hold' | 'sell'
  confidence: number
  rationale: string
  research: string | null
  model: string
}

const MODEL = 'gemini-3.5-flash-lite'

export function summarizeBars(entryPrice: number, bars: DailyBar[]) {
  if (bars.length === 0) return { maxGainPct: 0, maxDrawdownPct: 0, avgDailyRangePct: 0 }
  let maxHigh = -Infinity
  let minLow = Infinity
  let rangeSum = 0
  for (const bar of bars) {
    if (bar.high > maxHigh) maxHigh = bar.high
    if (bar.low < minLow) minLow = bar.low
    // Rango del día sobre el cierre del propio día: es la medida de ruido que
    // el análisis previo usó para mostrar que un stop de 3% caía adentro del
    // movimiento normal (promedio del universo: 3,62%).
    if (bar.close > 0) rangeSum += ((bar.high - bar.low) / bar.close) * 100
  }
  return {
    maxGainPct: ((maxHigh - entryPrice) / entryPrice) * 100,
    maxDrawdownPct: ((minLow - entryPrice) / entryPrice) * 100,
    avgDailyRangePct: rangeSum / bars.length,
  }
}

async function researchTicker(ticker: string): Promise<string | null> {
  try {
    await throttleGeminiCall()
    const { text } = await generateText({
      model: google(MODEL),
      tools: { web_search: google.tools.googleSearch({}) },
      // Mismo tope que researchMerchant en categorize.ts: cada step es una
      // llamada aparte que el SDK dispara sin pasar por el throttle, así que
      // un stopWhen alto ráfaga la cuota. 2 alcanza para "buscar + responder".
      stopWhen: stepCountIs(2),
      prompt: `Buscá noticias recientes (últimos 7 días) sobre la acción ${ticker}. Interesa: resultados trimestrales o fechas de balance próximas, cambios de recomendación de analistas, noticias regulatorias o de la industria, y cualquier evento que explique un movimiento fuerte del precio. Respondé en español, en 4-6 líneas, solo hechos con su fecha. Si no encontrás nada relevante de los últimos días, decilo explícitamente en vez de rellenar con contexto genérico.`,
    })
    return text
  } catch (err) {
    // Best-effort igual que researchMerchant: si la búsqueda falla, el modelo
    // decide solo con el precio. Queda registrado como research null, así en
    // la bitácora se ve que esa decisión se tomó a ciegas.
    console.error(`[paper] researchTicker falló para ${ticker}:`, err)
    return null
  }
}

export async function evaluatePosition(ctx: PositionContext): Promise<PositionDecision> {
  const research = await researchTicker(ctx.ticker)

  await throttleGeminiCall()
  const { object } = await generateObject({
    model: google(MODEL),
    schema: decisionSchema,
    prompt: `Sos el gestor de una posición en un portafolio SIMULADO (sin dinero real). Decidí si se mantiene o se vende ahora.

Posición:
- Papel: ${ctx.ticker}
- Abierta el ${ctx.openedAt} (hace ${ctx.daysHeld} días) a ${ctx.entryPrice.toFixed(2)} USD
- Precio actual: ${ctx.currentPrice.toFixed(2)} USD (${ctx.pnlPct >= 0 ? '+' : ''}${ctx.pnlPct.toFixed(2)}%)
- Máximo alcanzado desde la entrada: ${ctx.maxGainPct >= 0 ? '+' : ''}${ctx.maxGainPct.toFixed(2)}%
- Peor momento desde la entrada: ${ctx.maxDrawdownPct.toFixed(2)}%
- Rango diario promedio del papel desde la entrada: ${ctx.avgDailyRangePct.toFixed(2)}%
${ctx.signalTakeProfit != null ? `- La alerta original marcaba Take Profit en ${ctx.signalTakeProfit} USD` : ''}
${ctx.signalStopLoss != null ? `- La alerta original marcaba Stop Loss en ${ctx.signalStopLoss} USD` : ''}
${ctx.channelSold ? '- El canal que originó la alerta ya publicó su alerta de venta de este papel.' : ''}

${research ? `Búsqueda de noticias recientes:\n${research}` : 'No se pudo traer noticias recientes: decidí solo con el precio, y decilo en el razonamiento.'}

Criterios:
- Un movimiento de precio menor al rango diario promedio del papel NO es información: es ruido. No vendas por eso.
- Vender tiene que apoyarse en algo concreto: una noticia, un deterioro sostenido, o que la tesis original ya se cumplió. "Bajó un poco" no es una razón.
- Mantener también es una decisión activa: si mantenés, decí qué esperás.
- No hay costo de mantener más allá del riesgo. Sí hay costo de rotar: cada entrada/salida cuesta ~0,6% en comisiones y spread.
- Si la única razón para vender es que el precio tocó un número redondo, mantené.`,
  })

  return { ...object, research, model: MODEL }
}
