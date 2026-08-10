import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getUserIdFromRequest } from '../_lib/supabaseAdmin.js'
import { getIntradaySeries, type IntradayBar } from '../_lib/priceHistory.js'

// Análisis de una rueda para un símbolo: cómo abrió (gap), qué hizo con ese
// hueco, y si el volumen valida el movimiento. Todo se calcula acá en código,
// nunca con un LLM — un modelo no sabe a cuánto cerró un papel ni cuántos
// nominales operó, los inventa (mismo criterio que el rendimiento de las
// señales de Telegram, ver CLAUDE.md).
//
// Una sola llamada intradiaria de 15m/60d alimenta todo (ver getIntradaySeries
// en priceHistory.ts). Ojo: el intradiario de Yahoo no incluye la subasta de
// cierre, así que el volumen de la rueda queda un poco por debajo del oficial
// (VIST.BA: 197k contra 209k) — sirve para comparar contra sí mismo, que es
// para lo que se usa, no como dato de volumen publicado.

const SMA_SESSIONS = 20
const WEEK_SESSIONS = 5
// Debajo de esto la apertura no cuenta como gap, es ruido de una rueda normal.
const GAP_MIN_PCT = 1.5
// Margen para considerar que el precio "no se movió" desde la apertura.
const FLAT_PCT = 0.5

interface Session {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  startTs: number
  lastTs: number
  // Volumen acumulado al cierre de cada barra, indexado por minutos
  // transcurridos desde la apertura de esa rueda. Es lo que permite comparar
  // "cuánto llevaba operado a esta misma hora" contra los días anteriores, en
  // vez de contra el día entero (a las 12:00 el volumen del día siempre parece
  // bajo si se lo compara contra ruedas completas).
  cumulative: { minute: number; volume: number }[]
}

function localDate(ts: number, gmtOffset: number) {
  return new Date((ts + gmtOffset) * 1000).toISOString().slice(0, 10)
}

function localTime(ts: number, gmtOffset: number) {
  return new Date((ts + gmtOffset) * 1000).toISOString().slice(11, 16)
}

function buildSessions(bars: IntradayBar[], gmtOffset: number): Session[] {
  const sessions: Session[] = []
  let current: Session | null = null

  for (const bar of bars) {
    const date = localDate(bar.ts, gmtOffset)
    if (!current || current.date !== date) {
      current = {
        date,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: 0,
        startTs: bar.ts,
        lastTs: bar.ts,
        cumulative: [],
      }
      sessions.push(current)
    }
    current.high = Math.max(current.high, bar.high)
    current.low = Math.min(current.low, bar.low)
    current.close = bar.close
    current.volume += bar.volume
    current.lastTs = bar.ts
    current.cumulative.push({ minute: Math.round((bar.ts - current.startTs) / 60), volume: current.volume })
  }

  return sessions
}

// Volumen que llevaba operado esa rueda a los `minute` minutos de haber
// abierto. Si la rueda es más corta (feriado a media jornada, o simplemente
// terminó antes), devuelve su total.
function volumeAtMinute(session: Session, minute: number): number {
  let volume = 0
  for (const point of session.cumulative) {
    if (point.minute > minute) break
    volume = point.volume
  }
  return volume
}

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

function pctChange(from: number, to: number): number | null {
  if (!(from > 0)) return null
  return ((to - from) / from) * 100
}

// Dónde cerró dentro del rango del día (0 = en el mínimo, 1 = en el máximo).
// Es lo que separa "subió 5%" de "subió 5% y lo devolvió sobre el cierre".
function closeLocation(session: Session): number | null {
  const range = session.high - session.low
  if (!(range > 0)) return null
  return (session.close - session.low) / range
}

type GapOutcome = 'continuation' | 'filled' | 'fade' | 'lateral'

// Qué pasó con el hueco de apertura. Solo tiene sentido si hubo gap: con una
// apertura plana el resultado sería siempre "lateral" y no diría nada.
function gapOutcome(session: Session, prevClose: number, gapPct: number): GapOutcome | null {
  if (Math.abs(gapPct) < GAP_MIN_PCT) return null
  const up = gapPct > 0
  // "Llenar el hueco": el precio volvió al cierre anterior en algún momento.
  if (up ? session.low <= prevClose : session.high >= prevClose) return 'filled'

  const fromOpen = pctChange(session.open, session.close)
  if (fromOpen == null || Math.abs(fromOpen) < FLAT_PCT) return 'lateral'
  // Siguió en la dirección del gap sin devolverlo (Gap and Go) o retrocedió
  // contra él sin llegar a llenarlo (toma de ganancias).
  return up === fromOpen > 0 ? 'continuation' : 'fade'
}

type VolumeState = 'very_high' | 'high' | 'normal' | 'low'

function volumeState(rvol: number | null): VolumeState | null {
  if (rvol == null) return null
  if (rvol >= 2) return 'very_high'
  if (rvol >= 1.5) return 'high'
  if (rvol >= 0.8) return 'normal'
  return 'low'
}

// Yahoo da la apertura de BYMA a las 11:00, que es cuando arranca la rueda
// continua — pero la rueda empieza 10:20 con la subasta de apertura, y así la
// muestra el broker (IEB+). Se corrige solo el horario informado y el "mercado
// abierto": las velas intradiarias siguen empezando a las 11:00 porque la
// subasta no tiene barras propias en la serie, así que el volumen y el RVOL no
// cambian (se miden desde la primera barra de cada rueda, no desde este dato).
const BYMA_OPEN_MINUTES = 10 * 60 + 20

// Mismo instante, movido a una hora concreta del mismo día *del mercado*. El
// server corre en UTC, así que el día local se obtiene corriendo el epoch por
// el offset del mercado y recién ahí truncando.
function atLocalMinutes(reference: number, gmtOffset: number, minutesOfDay: number): number {
  const startOfLocalDay = Math.floor(((reference + gmtOffset) * 1000) / 86_400_000) * 86_400_000
  return startOfLocalDay / 1000 + minutesOfDay * 60 - gmtOffset
}

// El ticker de una tenencia en pesos es el CEDEAR (SÍMBOLO.BA) y el de una en
// dólares el papel original — al revés se analizaría el papel equivocado, en
// otra moneda (mismo problema que resolveSeries documenta para GGAL/YPF/PAM).
// El otro queda igual como fallback por si el primero no tiene serie.
function candidates(symbol: string, market: string): string[] {
  const clean = symbol.trim().toUpperCase()
  if (!clean) return []
  if (clean.includes('.')) return [clean]
  return market === 'world' ? [clean, `${clean}.BA`] : [`${clean}.BA`, clean]
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await getUserIdFromRequest(req.headers.authorization)
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const symbol = typeof req.query.symbol === 'string' ? req.query.symbol : ''
  const market = typeof req.query.market === 'string' ? req.query.market : 'ar'
  const tickers = candidates(symbol, market)
  if (tickers.length === 0) {
    res.status(400).json({ error: 'Falta el símbolo' })
    return
  }

  const series = await getIntradaySeries(tickers)
  const sessions = series ? buildSessions(series.bars, series.gmtOffset) : []
  if (!series || sessions.length === 0) {
    // Fuente frágil por diseño (ver priceHistory.ts): sin serie se avisa, no
    // se rompe.
    res.status(200).json({ available: false, symbol: symbol.toUpperCase() })
    return
  }

  const current = sessions[sessions.length - 1]
  const history = sessions.slice(0, -1)
  const smaWindow = history.slice(-SMA_SESSIONS)
  const previous = history[history.length - 1] ?? null

  const sma = average(smaWindow.map((s) => s.volume))
  const elapsedMinutes = current.cumulative[current.cumulative.length - 1]?.minute ?? 0
  const sameTimeAvg = average(smaWindow.map((s) => volumeAtMinute(s, elapsedMinutes)))

  const rvolFull = sma != null && sma > 0 ? current.volume / sma : null
  const rvolSameTime = sameTimeAvg != null && sameTimeAvg > 0 ? current.volume / sameTimeAvg : null

  const prevClose = previous?.close ?? null
  const gapPct = prevClose != null ? pctChange(prevClose, current.open) : null

  // Perfil hora por hora de la rueda en curso contra el promedio de esa misma
  // hora en las ruedas anteriores — es lo que deja ver si el volumen se cargó
  // temprano (institucionales entrando) o recién sobre el cierre.
  const hourlyMap = new Map<string, { volume: number; samples: number[] }>()
  for (const session of [...smaWindow, current]) {
    const isCurrent = session === current
    const perHour = new Map<string, number>()
    let previousVolume = 0
    for (const point of session.cumulative) {
      const hour = `${localTime(session.startTs + point.minute * 60, series.gmtOffset).slice(0, 2)}:00`
      perHour.set(hour, (perHour.get(hour) ?? 0) + (point.volume - previousVolume))
      previousVolume = point.volume
    }
    for (const [hour, volume] of perHour) {
      let entry = hourlyMap.get(hour)
      if (!entry) {
        entry = { volume: 0, samples: [] }
        hourlyMap.set(hour, entry)
      }
      if (isCurrent) entry.volume = volume
      else entry.samples.push(volume)
    }
  }
  const hourly = Array.from(hourlyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, entry]) => ({ label, volume: entry.volume, avg: average(entry.samples) }))

  // Últimas ruedas: cada una contra su propio cierre anterior y su propia
  // media de volumen (no la de hoy), que es lo que hace comparable la columna
  // "vs media" entre filas.
  const weekStart = Math.max(sessions.length - WEEK_SESSIONS, 0)
  const week = sessions.slice(weekStart).map((session, index) => {
    const absoluteIndex = weekStart + index
    const before = sessions.slice(Math.max(absoluteIndex - SMA_SESSIONS, 0), absoluteIndex)
    const sessionSma = average(before.map((s) => s.volume))
    const sessionPrevClose = sessions[absoluteIndex - 1]?.close ?? null
    return {
      date: session.date,
      open: session.open,
      close: session.close,
      changePct: sessionPrevClose != null ? pctChange(sessionPrevClose, session.close) : null,
      gapPct: sessionPrevClose != null ? pctChange(sessionPrevClose, session.open) : null,
      volume: session.volume,
      volVsSma: sessionSma != null && sessionSma > 0 ? session.volume / sessionSma : null,
      clv: closeLocation(session),
    }
  })

  const nowSeconds = Math.floor(Date.now() / 1000)
  const regularStart =
    series.regularStart != null && series.ticker.endsWith('.BA')
      ? atLocalMinutes(series.regularStart, series.gmtOffset, BYMA_OPEN_MINUTES)
      : series.regularStart
  const isOpen = regularStart != null && series.regularEnd != null && nowSeconds >= regularStart && nowSeconds < series.regularEnd

  res.status(200).json({
    available: true,
    symbol: symbol.toUpperCase(),
    ticker: series.ticker,
    currency: series.currency,
    exchange: series.exchangeName,
    timezone: series.timezone,
    market: {
      isOpen,
      opensAt: regularStart != null ? localTime(regularStart, series.gmtOffset) : null,
      closesAt: series.regularEnd != null ? localTime(series.regularEnd, series.gmtOffset) : null,
      minutesToClose: isOpen && series.regularEnd != null ? Math.round((series.regularEnd - nowSeconds) / 60) : null,
    },
    session: {
      date: current.date,
      isToday: current.date === localDate(nowSeconds, series.gmtOffset),
      asOf: localTime(current.lastTs, series.gmtOffset),
      open: current.open,
      high: current.high,
      low: current.low,
      last: current.close,
      prevClose,
      changePct: prevClose != null ? pctChange(prevClose, current.close) : null,
      gapPct,
      gapOutcome: prevClose != null && gapPct != null ? gapOutcome(current, prevClose, gapPct) : null,
      clv: closeLocation(current),
      elapsedMinutes,
    },
    volume: {
      today: current.volume,
      sma,
      smaSessions: smaWindow.length,
      sameTimeAvg,
      rvolFull,
      rvolSameTime,
      state: volumeState(rvolSameTime ?? rvolFull),
      hourly,
    },
    week,
  })
}
