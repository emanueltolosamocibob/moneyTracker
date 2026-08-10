import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { InvestmentMarket } from '../types/database'
import { openTickerTabs, tradingViewUrl } from '../lib/tradingView'
import { IconPencil } from './icons'
import Modal from './Modal'

// Análisis de la rueda de un símbolo: cómo abrió (gap), qué hizo con ese
// hueco, y si el volumen valida el movimiento. Se abre con doble click, tanto
// desde una tarjeta de Cartera actual como desde una fila de Alertas de
// Telegram — de ahí que el bloque de contexto (posición propia / datos de la
// alerta) sea un prop y no algo que el componente sepa armar solo.
//
// Todos los números vienen calculados de api/investments/symbol-analysis.ts;
// acá no se recalcula nada, solo se formatea y se traduce a etiquetas.

interface HourlyVolume {
  label: string
  volume: number
  avg: number | null
}

interface WeekRow {
  date: string
  open: number
  close: number
  changePct: number | null
  gapPct: number | null
  volume: number
  volVsSma: number | null
  clv: number | null
}

interface Analysis {
  available: true
  symbol: string
  ticker: string
  currency: string | null
  exchange: string | null
  timezone: string | null
  market: { isOpen: boolean; opensAt: string | null; closesAt: string | null; minutesToClose: number | null }
  session: {
    date: string
    isToday: boolean
    asOf: string
    open: number
    high: number
    low: number
    last: number
    prevClose: number | null
    changePct: number | null
    gapPct: number | null
    gapOutcome: 'continuation' | 'filled' | 'fade' | 'lateral' | null
    clv: number | null
    elapsedMinutes: number
  }
  volume: {
    today: number
    sma: number | null
    smaSessions: number
    sameTimeAvg: number | null
    rvolFull: number | null
    rvolSameTime: number | null
    state: 'very_high' | 'high' | 'normal' | 'low' | null
    hourly: HourlyVolume[]
  }
  week: WeekRow[]
}

interface Props {
  symbol: string
  market?: InvestmentMarket
  name?: string | null
  // Tenencia propia, para el bloque "Tu posición" — el resultado no realizado
  // se calcula contra el último precio que trae el análisis, así que no puede
  // venir ya resuelto desde afuera.
  position?: { quantity: number; avgPrice: number }
  contextTitle?: string
  contextRows?: { label: string; value: ReactNode }[]
  onEdit?: () => void
  editLabel?: string
  onClose: () => void
}

const GAP_OUTCOME_LABEL: Record<NonNullable<Analysis['session']['gapOutcome']>, string> = {
  continuation: 'Gap and Go',
  filled: 'Hueco llenado',
  fade: 'Retroceso sin llenar',
  lateral: 'Lateralización',
}

const VOLUME_STATE_LABEL: Record<NonNullable<Analysis['volume']['state']>, string> = {
  very_high: 'Muy alto',
  high: 'Alto',
  normal: 'Normal',
  low: 'Flojo',
}

function formatNumber(value: number, decimals = 2) {
  return value.toLocaleString('es-AR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function formatPrice(value: number, currency: string | null) {
  if (!currency) return formatNumber(value)
  return value.toLocaleString('es-AR', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatPct(value: number, decimals = 2) {
  return `${value > 0 ? '+' : ''}${formatNumber(value, decimals)}%`
}

function formatVolume(value: number) {
  return Math.round(value).toLocaleString('es-AR')
}

function formatRatio(value: number) {
  return `${formatNumber(value, 2)}x`
}

function formatDate(dateStr: string) {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-AR')
}

function signClass(value: number | null | undefined) {
  if (value == null) return 'tg-muted'
  return value >= 0 ? 'tg-hit' : 'tg-miss'
}

// Lecturas en texto, derivadas de los mismos umbrales que las etiquetas — sin
// LLM y sin recomendar nada: describen lo que hizo el papel, la decisión de
// operar o no queda del lado del usuario.
function buildReadings(data: Analysis): string[] {
  const { session, volume, market } = data
  const readings: string[] = []
  const rvol = volume.rvolSameTime ?? volume.rvolFull
  const up = session.changePct != null && session.changePct > 0

  if (rvol != null) {
    const scale = formatRatio(rvol)
    if (volume.state === 'very_high' || volume.state === 'high') {
      readings.push(
        up
          ? `Suba validada por volumen: ${scale} lo que opera en promedio a esta misma hora — hay tamaño comprando.`
          : `La baja opera con volumen alto (${scale} lo normal a esta hora): es salida real, no falta de interés.`,
      )
    } else if (volume.state === 'low') {
      readings.push(
        up
          ? `Suba sin volumen (${scale} lo normal a esta hora): poco confiable mientras no aparezca tamaño.`
          : `Movimiento con poco volumen (${scale} lo normal a esta hora): más ruido que convicción.`,
      )
    }
  }

  if (session.gapOutcome === 'continuation') {
    readings.push('Abrió con hueco y no lo devolvió en todo el día — el patrón de Gap and Go.')
  } else if (session.gapOutcome === 'filled') {
    readings.push('El hueco de apertura se llenó: el precio volvió al cierre anterior en algún momento de la rueda.')
  } else if (session.gapOutcome === 'fade') {
    readings.push('Retrocedió desde la apertura sin llegar a llenar el hueco — toma de ganancias sobre el gap.')
  } else if (session.gapOutcome === 'lateral') {
    readings.push('Abrió con hueco y lateralizó: ni lo devolvió ni lo extendió.')
  }

  if (session.clv != null) {
    if (session.clv >= 0.7) readings.push('Cerró en la parte alta del rango del día: los compradores aguantaron hasta el final.')
    else if (session.clv <= 0.3) readings.push('Cerró en la parte baja del rango: lo vendieron sobre el cierre.')
  }

  if (market.isOpen && market.minutesToClose != null && market.minutesToClose <= 90) {
    const isByma = data.ticker.endsWith('.BA')
    readings.push(
      `Faltan ${market.minutesToClose} minutos para el cierre${
        isByma ? ` (${market.closesAt ?? '17:00'}, más el pre-cierre de 5 minutos)` : ''
      }.`,
    )
  }

  return readings
}

export default function SymbolAnalysis({
  symbol,
  market = 'ar',
  name,
  position,
  contextTitle,
  contextRows,
  onEdit,
  editLabel = 'Editar',
  onClose,
}: Props) {
  const [data, setData] = useState<Analysis | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const { data: sessionData } = await supabase.auth.getSession()
        const token = sessionData.session?.access_token
        const res = await fetch(
          `/api/investments/symbol-analysis?symbol=${encodeURIComponent(symbol)}&market=${encodeURIComponent(market)}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} },
        )
        const json = await res.json()
        if (cancelled) return
        if (!res.ok) throw new Error(json.error ?? 'No se pudo cargar el análisis')
        if (!json.available) {
          setError(`No hay serie de precios de ${symbol} en Yahoo Finance, así que no se puede analizar la rueda.`)
          return
        }
        setData(json as Analysis)
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [symbol, market])

  const rvol = data ? (data.volume.rvolSameTime ?? data.volume.rvolFull) : null
  const hourlyMax = data ? Math.max(1, ...data.volume.hourly.flatMap((h) => [h.volume, h.avg ?? 0])) : 1
  const readings = data ? buildReadings(data) : []

  return (
    <Modal wide scroll>
      <div className="sa-header">
        <div className="sa-title">
          <a
            href={tradingViewUrl(symbol)}
            target="_blank"
            rel="noopener noreferrer"
            className="sa-symbol"
            title="Abre el papel y su CEDEAR en TradingView"
            onClick={(e) => openTickerTabs(e, symbol)}
          >
            {symbol}
          </a>
          {name && <span className="sa-name">{name}</span>}
        </div>
        {onEdit && (
          <button type="button" className="gmail-scan-btn sa-edit-btn" onClick={onEdit}>
            <IconPencil size={14} /> {editLabel}
          </button>
        )}
      </div>

      {loading && <p>Analizando la rueda...</p>}
      {error && <p className="error">{error}</p>}

      {data && !loading && (
        <div className="sa-body">
          {/* 1 — Contexto de rueda */}
          <div className="sa-market">
            <span className={`tg-status-badge ${data.market.isOpen ? 'tg-status-open' : 'tg-status-closed'}`}>
              {data.market.isOpen ? 'Mercado abierto' : 'Mercado cerrado'}
            </span>
            <span className="sa-market-meta">
              {data.exchange ?? data.ticker}
              {data.market.opensAt && data.market.closesAt
                ? ` · rueda ${data.market.opensAt}–${data.market.closesAt}`
                : data.market.closesAt && ` · cierra ${data.market.closesAt}`}
              {data.market.isOpen && data.market.minutesToClose != null && ` · faltan ${data.market.minutesToClose} min`}
              {` · datos al ${formatDate(data.session.date)} ${data.session.asOf}`}
            </span>
          </div>

          {/* 2 — La apertura y el gap */}
          <section className="sa-block">
            <h4>{data.session.isToday ? 'La rueda de hoy' : `La rueda del ${formatDate(data.session.date)}`}</h4>
            <div className="sa-stat-grid">
              <div className="sa-stat">
                <span className="sa-stat-label">Último</span>
                <strong>{formatPrice(data.session.last, data.currency)}</strong>
              </div>
              <div className="sa-stat">
                <span className="sa-stat-label">Var. del día</span>
                <strong className={signClass(data.session.changePct)}>
                  {data.session.changePct != null ? formatPct(data.session.changePct) : '—'}
                </strong>
              </div>
              <div className="sa-stat">
                <span className="sa-stat-label">Gap de apertura</span>
                <strong className={signClass(data.session.gapPct)}>
                  {data.session.gapPct != null ? formatPct(data.session.gapPct) : '—'}
                </strong>
              </div>
              <div className="sa-stat">
                <span className="sa-stat-label">Qué hizo con el hueco</span>
                <strong>{data.session.gapOutcome ? GAP_OUTCOME_LABEL[data.session.gapOutcome] : 'Sin gap'}</strong>
              </div>
              <div className="sa-stat">
                <span className="sa-stat-label">Cierre en el rango</span>
                <strong>{data.session.clv != null ? `${Math.round(data.session.clv * 100)}%` : '—'}</strong>
              </div>
              <div className="sa-stat">
                <span className="sa-stat-label">Rango del día</span>
                <strong>
                  {formatPrice(data.session.low, data.currency)} – {formatPrice(data.session.high, data.currency)}
                </strong>
              </div>
            </div>
          </section>

          {/* 3 — Volumen */}
          <section className="sa-block">
            <h4>Volumen</h4>
            <div className="sa-stat-grid">
              <div className="sa-stat">
                <span className="sa-stat-label">Operado en la rueda</span>
                <strong>{formatVolume(data.volume.today)}</strong>
              </div>
              <div className="sa-stat">
                <span className="sa-stat-label">Media {data.volume.smaSessions} ruedas</span>
                <strong>{data.volume.sma != null ? formatVolume(data.volume.sma) : '—'}</strong>
              </div>
              <div className="sa-stat">
                <span className="sa-stat-label">Esperado a esta hora</span>
                <strong>{data.volume.sameTimeAvg != null ? formatVolume(data.volume.sameTimeAvg) : '—'}</strong>
              </div>
              <div className="sa-stat">
                <span className="sa-stat-label">Volumen relativo (RVOL)</span>
                <strong className={rvol != null && rvol >= 1.5 ? 'tg-hit' : rvol != null && rvol < 0.8 ? 'tg-miss' : undefined}>
                  {rvol != null ? formatRatio(rvol) : '—'}
                  {data.volume.state && ` · ${VOLUME_STATE_LABEL[data.volume.state]}`}
                </strong>
              </div>
            </div>

            {data.volume.hourly.length > 0 && (
              <div className="sa-hours">
                {data.volume.hourly.map((hour) => (
                  <div key={hour.label} className="sa-hour">
                    <span className="sa-hour-label">{hour.label}</span>
                    <span className="sa-hour-bars">
                      <span className="sa-hour-bar sa-hour-today" style={{ width: `${(hour.volume / hourlyMax) * 100}%` }} />
                      <span className="sa-hour-bar sa-hour-avg" style={{ width: `${((hour.avg ?? 0) / hourlyMax) * 100}%` }} />
                    </span>
                    <span className="sa-hour-value">{formatVolume(hour.volume)}</span>
                  </div>
                ))}
                <p className="sa-legend">
                  <span className="sa-legend-key sa-hour-today" /> esta rueda
                  <span className="sa-legend-key sa-hour-avg" /> promedio de las {data.volume.smaSessions} anteriores
                </p>
              </div>
            )}

            {readings.length > 0 && (
              <ul className="sa-readings">
                {readings.map((reading) => (
                  <li key={reading}>{reading}</li>
                ))}
              </ul>
            )}
          </section>

          {/* 4 — Última semana */}
          <section className="sa-block">
            <h4>Últimas {data.week.length} ruedas</h4>
            <div className="tx-table-scroll">
              <table className="tx-table sa-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th className="tx-amount-header">Var.</th>
                    <th className="tx-amount-header">Gap</th>
                    <th className="tx-amount-header">Cierre</th>
                    <th className="tx-amount-header">Volumen</th>
                    <th className="tx-amount-header">vs media</th>
                    <th className="tx-amount-header">En el rango</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.week].reverse().map((row) => (
                    <tr key={row.date}>
                      <td>{formatDate(row.date)}</td>
                      <td className={`tx-amount ${signClass(row.changePct)}`}>
                        {row.changePct != null ? formatPct(row.changePct) : '—'}
                      </td>
                      <td className={`tx-amount ${signClass(row.gapPct)}`}>{row.gapPct != null ? formatPct(row.gapPct) : '—'}</td>
                      <td className="tx-amount">{formatPrice(row.close, data.currency)}</td>
                      <td className="tx-amount">{formatVolume(row.volume)}</td>
                      <td className={`tx-amount ${row.volVsSma != null && row.volVsSma >= 1.5 ? 'tg-hit' : ''}`}>
                        {row.volVsSma != null ? formatRatio(row.volVsSma) : '—'}
                      </td>
                      <td className="tx-amount">{row.clv != null ? `${Math.round(row.clv * 100)}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* 5 — Contexto propio: la tenencia o la alerta */}
          {(position || (contextRows && contextRows.length > 0)) && (
            <section className="sa-block">
              <h4>{contextTitle ?? 'Tu posición'}</h4>
              <div className="sa-stat-grid">
                {position && (
                  <>
                    <div className="sa-stat">
                      <span className="sa-stat-label">Cantidad</span>
                      <strong>{position.quantity}</strong>
                    </div>
                    <div className="sa-stat">
                      <span className="sa-stat-label">Precio promedio</span>
                      <strong>{formatPrice(position.avgPrice, data.currency)}</strong>
                    </div>
                    <div className="sa-stat">
                      <span className="sa-stat-label">Valor actual</span>
                      <strong>{formatPrice(position.quantity * data.session.last, data.currency)}</strong>
                    </div>
                    <div className="sa-stat">
                      <span className="sa-stat-label">Resultado no realizado</span>
                      <strong className={signClass(data.session.last - position.avgPrice)}>
                        {formatPrice((data.session.last - position.avgPrice) * position.quantity, data.currency)}
                        {position.avgPrice > 0 &&
                          ` · ${formatPct(((data.session.last - position.avgPrice) / position.avgPrice) * 100)}`}
                      </strong>
                    </div>
                  </>
                )}
                {contextRows?.map((row) => (
                  <div key={row.label} className="sa-stat">
                    <span className="sa-stat-label">{row.label}</span>
                    <strong>{row.value}</strong>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 6 — Todos los números, los captados y los calculados */}
          <section className="sa-block">
            <h4>Resumen de números</h4>
            <dl className="sa-summary">
              <div>
                <dt>Cierre anterior</dt>
                <dd>{data.session.prevClose != null ? formatPrice(data.session.prevClose, data.currency) : '—'}</dd>
              </div>
              <div>
                <dt>Apertura</dt>
                <dd>{formatPrice(data.session.open, data.currency)}</dd>
              </div>
              <div>
                <dt>Máximo</dt>
                <dd>{formatPrice(data.session.high, data.currency)}</dd>
              </div>
              <div>
                <dt>Mínimo</dt>
                <dd>{formatPrice(data.session.low, data.currency)}</dd>
              </div>
              <div>
                <dt>Último</dt>
                <dd>{formatPrice(data.session.last, data.currency)}</dd>
              </div>
              <div>
                <dt>Variación del día</dt>
                <dd>{data.session.changePct != null ? formatPct(data.session.changePct) : '—'}</dd>
              </div>
              <div>
                <dt>Gap de apertura</dt>
                <dd>{data.session.gapPct != null ? formatPct(data.session.gapPct) : '—'}</dd>
              </div>
              <div>
                <dt>Cierre en el rango</dt>
                <dd>{data.session.clv != null ? `${Math.round(data.session.clv * 100)}%` : '—'}</dd>
              </div>
              <div>
                <dt>Volumen de la rueda</dt>
                <dd>{formatVolume(data.volume.today)}</dd>
              </div>
              <div>
                <dt>Media de volumen ({data.volume.smaSessions} ruedas)</dt>
                <dd>{data.volume.sma != null ? formatVolume(data.volume.sma) : '—'}</dd>
              </div>
              <div>
                <dt>Volumen esperado a esta hora</dt>
                <dd>{data.volume.sameTimeAvg != null ? formatVolume(data.volume.sameTimeAvg) : '—'}</dd>
              </div>
              <div>
                <dt>RVOL a esta hora</dt>
                <dd>{data.volume.rvolSameTime != null ? formatRatio(data.volume.rvolSameTime) : '—'}</dd>
              </div>
              <div>
                <dt>RVOL rueda completa</dt>
                <dd>{data.volume.rvolFull != null ? formatRatio(data.volume.rvolFull) : '—'}</dd>
              </div>
              <div>
                <dt>Minutos operados</dt>
                <dd>{data.session.elapsedMinutes}</dd>
              </div>
              <div>
                <dt>Símbolo consultado</dt>
                <dd>{data.ticker}</dd>
              </div>
              <div>
                <dt>Moneda</dt>
                <dd>{data.currency ?? '—'}</dd>
              </div>
            </dl>
            <p className="sa-disclaimer">
              Precios y volúmenes de Yahoo Finance, diferidos y sin la subasta de cierre — sirven para comparar el papel contra sí
              mismo, no como dato oficial de mercado.
            </p>
          </section>
        </div>
      )}

      <div className="modal-actions">
        <button type="button" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </Modal>
  )
}
