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

interface YahooChartResponse {
  chart?: {
    error?: unknown
    result?: Array<{
      meta?: { currency?: string }
      timestamp?: number[]
      indicators?: { quote?: Array<{ close?: (number | null)[] }> }
    }>
  }
}

async function fetchYahoo(ticker: string, fromMs: number, toMs: number): Promise<DailyClose[] | null> {
  const period1 = Math.floor(fromMs / 1000)
  const period2 = Math.floor(toMs / 1000)
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d`

  try {
    // Sin User-Agent de browser, Yahoo contesta 429/403 a este endpoint.
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) return null
    const json = (await res.json()) as YahooChartResponse
    const result = json.chart?.result?.[0]
    const timestamps = result?.timestamp
    const closes = result?.indicators?.quote?.[0]?.close
    if (!timestamps?.length || !closes?.length) return null

    const series: DailyClose[] = []
    for (let i = 0; i < timestamps.length; i += 1) {
      const close = closes[i]
      // Los feriados y las ruedas sin operaciones vienen como null en el
      // medio del array, no ausentes — hay que saltearlos explícitamente.
      if (close == null) continue
      series.push({ date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10), close })
    }
    return series.length > 0 ? series : null
  } catch {
    return null
  }
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
    const last = series[series.length - 1]
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
