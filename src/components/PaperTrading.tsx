import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import type { PaperSummary, PaperPosition, PaperDecision } from '../types/database'
import { IconRefresh, IconTrendingUp } from './icons'

// Tope de vueltas de cada loop (sync y evaluación): el server acota cuánto
// hace por invocación y devuelve hasMore mientras quede trabajo, mismo
// patrón que el escaneo de Gmail — esto solo evita un loop infinito si el
// server devolviera hasMore para siempre por un bug.
const MAX_ROUNDS = 50

function formatUsd(amount: number) {
  return amount.toLocaleString('es-AR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatPct(pct: number | null) {
  if (pct == null) return '—'
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
}

function pctClass(pct: number | null) {
  if (pct == null) return ''
  return pct >= 0 ? 'income' : 'negative'
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('es-AR')
}

function daysSince(dateStr: string) {
  return Math.max(0, Math.round((Date.now() - new Date(dateStr).getTime()) / 86_400_000))
}

export default function PaperTrading() {
  const { user } = useAuth()
  const [summary, setSummary] = useState<PaperSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [evaluating, setEvaluating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function authHeader() {
    const { data } = await supabase.auth.getSession()
    return { Authorization: `Bearer ${data.session?.access_token}` }
  }

  async function load() {
    if (!user) return
    setLoading(true)
    setError(null)
    try {
      const headers = await authHeader()
      const res = await fetch('/api/paper/summary', { headers })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'No se pudo cargar el portfolio simulado')
      setSummary(json as PaperSummary)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  async function fetchLoop(url: string, headers: Record<string, string>) {
    let hasMore = true
    let rounds = 0
    while (hasMore && rounds < MAX_ROUNDS) {
      rounds += 1
      const res = await fetch(url, { method: 'POST', headers })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `Falló ${url}`)
      hasMore = json.result?.hasMore ?? false
    }
  }

  // Este único botón hace todo el pipeline manual: trae mensajes nuevos de
  // Telegram, los convierte en señales/posiciones, y evalúa lo que ya está
  // abierto. Antes "Evaluar ahora" solo hacía el último paso, asumiendo que
  // el listener local (o el cron de la noche) ya se habían encargado del
  // resto — pero eso deja de servir si el usuario cambia entre varias PCs y
  // ninguna tiene el listener corriendo. Con este botón alcanza, desde
  // cualquier dispositivo, sin depender de un proceso siempre prendido.
  async function handleEvaluate() {
    setEvaluating(true)
    setError(null)
    try {
      const headers = await authHeader()
      await fetchLoop('/api/telegram/sync', headers)
      // POST a /api/paper/summary, no un endpoint /evaluate aparte: el plan
      // Hobby de Vercel tope a 12 funciones serverless, así que "evaluar" y
      // "traer el resumen" comparten archivo (GET/POST) — ver el comentario
      // en api/paper/summary.ts.
      await fetchLoop('/api/paper/summary', headers)
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setEvaluating(false)
    }
  }

  const stats = useMemo(() => {
    if (!summary) return []
    // El criterio del modelo primero (es lo que este experimento mide),
    // después el resto ordenado por desempeño total — mezclando realizado y
    // no realizado, así una estrategia que nunca cierra no queda afuera del
    // ranking solo por eso.
    return [...summary.stats].sort((a, b) => {
      if (a.key === 'llm') return -1
      if (b.key === 'llm') return 1
      return (b.avgTotalPct ?? -Infinity) - (a.avgTotalPct ?? -Infinity)
    })
  }, [summary])

  const openPositions = useMemo(() => {
    const list = (summary?.positions ?? []).filter((p): p is PaperPosition => p.status === 'open')
    return list.sort((a, b) => b.opened_at.localeCompare(a.opened_at))
  }, [summary])

  const decisions = useMemo(() => summary?.decisions ?? [], [summary])
  const positionById = useMemo(() => new Map((summary?.positions ?? []).map((p) => [p.id, p])), [summary])

  return (
    <section className="tg-section">
      <div className="tx-header">
        <h3>Portfolio simulado</h3>
        <div className="tg-actions">
          <button
            type="button"
            className="gmail-scan-btn"
            onClick={handleEvaluate}
            disabled={evaluating}
            title="Trae mensajes nuevos de Telegram, abre posiciones para alertas de compra nuevas y evalúa las que ya están abiertas"
          >
            <IconTrendingUp size={16} /> {evaluating ? 'Trayendo alertas y evaluando...' : 'Traer alertas y evaluar'}
          </button>
          <button type="button" className="gmail-scan-btn" onClick={load} disabled={loading} title="Solo vuelve a leer lo que ya está guardado, sin tocar Telegram ni el modelo">
            <IconRefresh /> Actualizar
          </button>
        </div>
      </div>
      <p className="tg-meta">
        Cada alerta de compra abre la misma posición (US$ {summary?.notionalUsd ?? 1000} simulados) en varias estrategias a la vez, incluida
        SPY como benchmark — es lo único que permite saber si el criterio del modelo aporta algo. Sin dinero real. "Traer alertas y evaluar" hace
        todo el proceso manual (sirve desde cualquier PC, sin depender de que el listener esté corriendo); "Actualizar" solo refresca la pantalla.
      </p>

      {error && <p className="error">{error}</p>}

      {loading ? (
        <p>Cargando...</p>
      ) : !summary || stats.every((s) => s.closed === 0 && s.open === 0) ? (
        <p className="empty-state">Todavía no llegó ninguna alerta de compra al portfolio simulado.</p>
      ) : (
        <>
          <div className="tx-table-scroll">
            <table className="tx-table">
              <thead>
                <tr>
                  <th>Estrategia</th>
                  <th>Abiertas</th>
                  <th>Cerradas</th>
                  <th className="tx-amount-header">% acierto</th>
                  <th className="tx-amount-header">Prom. realizado</th>
                  <th className="tx-amount-header">Prom. total</th>
                  <th className="tx-amount-header">Total simulado</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr key={s.key} title={s.description}>
                    <td>
                      {s.label}
                      {s.key === 'llm' && <span className="tg-badge">modelo</span>}
                    </td>
                    <td>{s.open}</td>
                    <td>{s.closed}</td>
                    <td className="tx-amount">{s.winRatePct == null ? '—' : `${s.winRatePct.toFixed(0)}%`}</td>
                    <td className={`tx-amount ${pctClass(s.avgRealizedPct)}`}>{formatPct(s.avgRealizedPct)}</td>
                    <td className={`tx-amount ${pctClass(s.avgTotalPct)}`}>{formatPct(s.avgTotalPct)}</td>
                    <td className={`tx-amount ${pctClass(s.avgTotalPct)}`}>{formatUsd(s.totalUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>Posiciones abiertas</h3>
          {openPositions.length === 0 ? (
            <p className="empty-state">No hay posiciones abiertas.</p>
          ) : (
            <div className="tx-table-scroll">
              <table className="tx-table">
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th>Estrategia</th>
                    <th>Abierta</th>
                    <th className="tx-amount-header">Entrada</th>
                    <th className="tx-amount-header">Actual</th>
                    <th className="tx-amount-header">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {openPositions.map((p) => {
                    const pnl = p.current_price ? ((p.current_price - p.entry_price) / p.entry_price) * 100 : null
                    return (
                      <tr key={p.id}>
                        <td className="tx-amount">{p.ticker}</td>
                        <td>{stats.find((s) => s.key === p.strategy)?.label ?? p.strategy}</td>
                        <td>
                          {formatDate(p.opened_at)} <span className="tg-muted">({daysSince(p.opened_at)}d)</span>
                        </td>
                        <td className="tx-amount">{formatUsd(p.entry_price)}</td>
                        <td className="tx-amount">{p.current_price != null ? formatUsd(p.current_price) : <span className="tg-muted">sin cotizar</span>}</td>
                        <td className={`tx-amount ${pctClass(pnl)}`}>{formatPct(pnl)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {decisions.length > 0 && (
            <>
              <h3>Últimas decisiones del modelo</h3>
              <div className="tx-table-scroll">
                <table className="tx-table">
                  <thead>
                    <tr>
                      <th>Cuándo</th>
                      <th>Ticker</th>
                      <th>Acción</th>
                      <th className="tx-amount-header">P&L</th>
                      <th>Razonamiento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {decisions.map((d: PaperDecision) => (
                      <tr key={d.id}>
                        <td>{formatDate(d.decided_at)}</td>
                        <td className="tx-amount">{positionById.get(d.position_id)?.ticker ?? '—'}</td>
                        <td className={d.action === 'sell' ? 'tg-action-sell' : 'tg-action-hold'}>{d.action === 'sell' ? 'Vender' : 'Mantener'}</td>
                        <td className={`tx-amount ${pctClass(d.pnl_pct)}`}>{formatPct(d.pnl_pct)}</td>
                        <td className="tg-rationale" title={d.rationale ?? ''}>
                          {d.rationale ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}
