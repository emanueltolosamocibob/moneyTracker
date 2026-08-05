import type { ParsedSignal } from './parseSignal.js'

// Cada alerta de compra abre la MISMA posición simulada en todas estas
// estrategias a la vez: mismo instante de entrada, mismo precio, mismo
// notional. Lo único que cambia entre ellas es cuándo se sale.
//
// Esto es el corazón del experimento de paper trading. El análisis previo
// del histórico del canal (84 alertas, ene-ago 2026) encontró que el
// problema no estaba en qué se compraba sino en cuándo se vendía: comprar y
// no tocar dio +8,32% por operación, la regla de +3%/-3% dio -0,96% con
// costos, y el 79% de las posiciones stopeadas después superaron el
// objetivo. Con una sola estrategia corriendo no hay forma de ver eso desde
// adentro — por eso corren todas en paralelo, incluida la discrecional del
// LLM, que es la única forma de saber si su criterio aporta algo.
//
// Advertencia que el propio análisis dejó anotada: ese período no contiene
// un mercado bajista. En un mercado alcista cualquier stop pierde contra
// mantener casi por construcción, así que "los stops no sirven" no es
// todavía una conclusión, es una propiedad del régimen medido — vale seguir
// mirándolo con esta grilla corriendo en tiempo real.

// Notional fijo por posición, en dólares. Todas las estrategias entran con
// lo mismo para que la comparación sea de criterio de salida y no de sizing.
export const PAPER_NOTIONAL_USD = 1000

export interface PaperStrategy {
  key: string
  label: string
  description: string
  // Ticker que realmente se compra. Solo el benchmark lo cambia.
  symbolFor: (signalTicker: string) => string
  // Niveles fijos que esta estrategia respeta, calculados al abrir. null =
  // no tiene niveles (sale por otro mecanismo, o no sale nunca).
  levels: (entryPrice: number, signal: ParsedSignal) => { takeProfit: number | null; stopLoss: number | null } | null
  // Sale cuando el canal publica su propia alerta de venta de ese ticker.
  closesOnChannelSell: boolean
  // La decide el LLM en cada pasada de evaluación (api/_lib/evaluatePosition.ts).
  discretionary: boolean
  // Copia la salida de otra estrategia: se cierra en el mismo momento y por
  // el mismo motivo. Lo usa el benchmark para quedar exactamente en la misma
  // ventana temporal que la estrategia que está midiendo.
  mirrorOf?: string
}

export const BENCHMARK_SYMBOL = 'SPY'

export const PAPER_STRATEGIES: PaperStrategy[] = [
  {
    key: 'llm',
    label: 'Criterio del modelo',
    description:
      'El modelo evalúa cada posición abierta con precio, velas diarias y una búsqueda de noticias, y decide mantener o vender. Es la única discrecional: todas las demás existen para poder medirla contra algo.',
    symbolFor: (t) => t,
    levels: () => null,
    closesOnChannelSell: false,
    discretionary: true,
  },
  {
    key: 'buy_hold',
    label: 'Comprar y no tocar',
    description:
      'Entra en la alerta y no vende nunca. Control más duro: en el histórico auditado fue la mejor de las doce variantes probadas (+8,32% por operación).',
    symbolFor: (t) => t,
    levels: () => null,
    closesOnChannelSell: false,
    discretionary: false,
  },
  {
    key: 'tp3_sl3',
    label: 'TP +3% / SL -3%',
    description:
      'Regla fija de referencia: en el histórico dio -0,96% por operación con costos porque el rango diario promedio de este universo es 3,62% — el stop queda adentro del ruido.',
    symbolFor: (t) => t,
    levels: (entry) => ({ takeProfit: entry * 1.03, stopLoss: entry * 0.97 }),
    closesOnChannelSell: false,
    discretionary: false,
  },
  {
    key: 'channel_levels',
    label: 'Niveles del canal',
    description:
      'Opera el Take Profit y el Stop Loss exactos que declara la alerta. Mide si los niveles publicados sirven, algo distinto de si el canal los respeta (en el histórico no: hay cierres reportados en -14%, -16% y -18% contra un stop declarado de -3,78%).',
    symbolFor: (t) => t,
    levels: (_entry, signal) => ({ takeProfit: signal.takeProfit, stopLoss: signal.stopLoss }),
    closesOnChannelSell: false,
    discretionary: false,
  },
  {
    key: 'channel_exit',
    label: 'Salida del canal',
    description: 'Mantiene hasta que el canal publica su alerta de venta de ese ticker (+6,48% por operación en el histórico).',
    symbolFor: (t) => t,
    levels: () => null,
    closesOnChannelSell: true,
    discretionary: false,
  },
  {
    key: 'spy_benchmark',
    label: 'SPY (benchmark)',
    description:
      'Con cada alerta compra SPY por el mismo monto y lo sostiene la misma ventana que la posición del modelo. La diferencia contra "Criterio del modelo" es el alpha real.',
    symbolFor: () => BENCHMARK_SYMBOL,
    levels: () => null,
    closesOnChannelSell: false,
    discretionary: false,
    mirrorOf: 'llm',
  },
]

export function paperStrategyByKey(key: string): PaperStrategy | undefined {
  return PAPER_STRATEGIES.find((s) => s.key === key)
}
