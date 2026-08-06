// Precios históricos diarios, para poder decir si una señal del grupo terminó
// funcionando o no.
//
// Fuente: el endpoint de chart de Yahoo Finance. No es una API documentada ni
// tiene contrato de estabilidad, pero es la única gratis que cubre BCBA: el
// free tier de Twelve Data (el que ya usa api/investments/symbols.ts) son 3
// exchanges, todos de EE.UU., y data912 solo expone precios en vivo, no
// series. Como es una fuente frágil, todo acá devuelve null en vez de tirar —
// una señal sin precio se muestra sin evaluar, no rompe el análisis entero.

export interface DailyClose {
  date: string
  close: number
}

// OHLC completo, no solo el cierre — usado por getDailyBars más abajo.
// `resolveSeries`/`createPriceLookup` siguen trabajando solo con el cierre
// porque a la tabla de alertas de compra (api/telegram/buy-alerts.ts) no le
// hace falta más.
export interface DailyBar extends DailyClose {
  open: number
  high: number
  low: number
}

interface YahooChartResult {
  meta?: { currency?: string; regularMarketPrice?: number }
  timestamp?: number[]
  indicators?: { quote?: Array<{ open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[] }> }
}

interface YahooChartResponse {
  chart?: { error?: unknown; result?: YahooChartResult[] }
}

async function fetchYahooChart(ticker: string, params: Record<string, string>): Promise<YahooChartResult | null> {
  const qs = new URLSearchParams(params).toString()
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?${qs}`
  try {
    // Sin User-Agent de browser, Yahoo contesta 429/403 a este endpoint.
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) return null
    const json = (await res.json()) as YahooChartResponse
    return json.chart?.result?.[0] ?? null
  } catch {
    return null
  }
}

async function fetchYahoo(ticker: string, fromMs: number, toMs: number): Promise<DailyClose[] | null> {
  const bars = await fetchYahooBars(ticker, fromMs, toMs)
  return bars ? bars.map(({ date, close }) => ({ date, close })) : null
}

async function fetchYahooBars(ticker: string, fromMs: number, toMs: number): Promise<DailyBar[] | null> {
  const result = await fetchYahooChart(ticker, {
    period1: String(Math.floor(fromMs / 1000)),
    period2: String(Math.floor(toMs / 1000)),
    interval: '1d',
  })
  const timestamps = result?.timestamp
  const quote = result?.indicators?.quote?.[0]
  if (!timestamps?.length || !quote) return null

  const bars: DailyBar[] = []
  for (let i = 0; i < timestamps.length; i += 1) {
    const open = quote.open?.[i]
    const high = quote.high?.[i]
    const low = quote.low?.[i]
    const close = quote.close?.[i]
    // Los feriados y las ruedas sin operaciones vienen como null en el medio
    // del array, no ausentes — hay que saltearlos explícitamente.
    if (open == null || high == null || low == null || close == null) continue
    bars.push({ date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10), open, high, low, close })
  }
  return bars.length > 0 ? bars : null
}

// Las señales del grupo llegan como ticker suelto ("GGAL", "AAPL"), sin decir
// en qué mercado. Se prueba primero el sufijo argentino y después el ticker
// pelado, porque un grupo de alertas local nombra sobre todo papeles de acá y
// muchos tickers de ByMA existen igual en EE.UU. (GGAL, YPF, PAM son ADRs con
// el mismo nombre) — al revés, la primera coincidencia sería casi siempre la
// de Nueva York y estaríamos evaluando la señal contra el papel equivocado, en
// otra moneda.
async function resolveSeries(symbol: string, fromMs: number, toMs: number): Promise<DailyClose[] | null> {
  const clean = symbol.trim().toUpperCase()
  if (!clean) return null
  return (await fetchYahoo(`${clean}.BA`, fromMs, toMs)) ?? (await fetchYahoo(clean, fromMs, toMs))
}

export interface SignalOutcome {
  entryDate: string
  entryPrice: number
  lastDate: string
  lastPrice: number
  // Variación del precio desde la señal hasta hoy, en porcentaje. El signo es
  // siempre el del movimiento del papel — interpretarlo como acierto o error
  // depende de si la señal era de compra o de venta, y eso lo decide quien
  // llama (ver `worked`).
  changePct: number
  worked: boolean
}

// Cachea por símbolo dentro de una misma corrida: un grupo de alertas repite
// los mismos papeles decenas de veces y no tiene sentido pedir la serie de
// GGAL una vez por señal.
export function createPriceLookup(fromMs: number) {
  const cache = new Map<string, Promise<DailyClose[] | null>>()
  const toMs = Date.now()

  return async function evaluate(
    symbol: string,
    signalDate: string,
    action: 'buy' | 'sell' | 'hold',
    // Fecha hasta la que evaluar, en vez de hasta hoy — para una alerta ya
    // cerrada (el canal mandó la de venta) tiene más sentido medir el
    // rendimiento real de la operación, entrada a salida, que "cuánto se
    // movió el papel desde entonces hasta hoy" (ver buy-alerts.ts).
    asOfDate?: string,
  ): Promise<SignalOutcome | null> {
    // Una señal de "mantener" no tiene precio de entrada que evaluar.
    if (action === 'hold') return null

    let pending = cache.get(symbol)
    if (!pending) {
      pending = resolveSeries(symbol, fromMs, toMs)
      cache.set(symbol, pending)
    }
    const series = await pending
    if (!series) return null

    // Primera rueda en o después de la señal: si la alerta salió un domingo o
    // después del cierre, el precio al que realmente se podía entrar es el de
    // la rueda siguiente, no el último anterior.
    const entry = series.find((point) => point.date >= signalDate)
    // Mismo criterio que entry pero para el otro extremo: primera rueda en o
    // después de asOfDate. Si no hay ninguna todavía (ej. la venta es de hoy
    // y el mercado no cerró), cae al último punto disponible de la serie.
    const last = asOfDate ? (series.find((point) => point.date >= asOfDate) ?? series[series.length - 1]) : series[series.length - 1]
    if (!entry || !last || entry.date === last.date) return null

    const changePct = ((last.close - entry.close) / entry.close) * 100
    return {
      entryDate: entry.date,
      entryPrice: entry.close,
      lastDate: last.date,
      lastPrice: last.close,
      changePct,
      // Una señal de venta acierta cuando el papel efectivamente bajó.
      worked: action === 'buy' ? changePct > 0 : changePct < 0,
    }
  }
}

// Usado por api/investments/spy-benchmark.ts. A diferencia de resolveSeries
// de arriba (pensado para un grupo genérico que puede nombrar papeles de
// ByMA), acá se prueba el ticker pelado primero y el sufijo .BA solo como
// fallback, para tickers de EE.UU. como SPY.
function candidateSymbols(symbol: string): string[] {
  const clean = symbol.trim().toUpperCase()
  return clean.includes('.') ? [clean] : [clean, `${clean}.BA`]
}

// Velas diarias desde `since` (inclusive) hasta hoy, con un día de colchón
// hacia atrás porque Yahoo recorta por timestamp de apertura y sin margen se
// pierde la vela del propio día de entrada.
export async function getDailyBars(symbol: string, since: Date): Promise<DailyBar[]> {
  const fromMs = since.getTime() - 86_400_000
  for (const candidate of candidateSymbols(symbol)) {
    const bars = await fetchYahooBars(candidate, fromMs, Date.now())
    if (bars) return bars
  }
  return []
}
