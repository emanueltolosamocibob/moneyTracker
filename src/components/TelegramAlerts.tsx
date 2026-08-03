import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import type { TelegramAnalysis, TelegramSignal, TelegramSyncState } from '../types/database'
import { IconRefresh, IconTrendingUp } from './icons'
import Modal from './Modal'

const PERIODS = [
  { days: 30, label: '30 días' },
  { days: 90, label: '90 días' },
  { days: 365, label: '1 año' },
]

const ACTION_LABEL: Record<TelegramSignal['action'], string> = {
  buy: 'Compra',
  sell: 'Venta',
  hold: 'Mantener',
}

// Mismo umbral que needs_review en las transacciones de Gmail: por debajo de
// esto la extracción es dudosa y se marca, no se esconde.
const LOW_CONFIDENCE = 0.6

// Tope de vueltas del loop de sincronización. El backfill de un grupo con años
// de historial son muchas invocaciones (ver MAX_PAGES_PER_RUN en
// telegramSync.ts); esto solo evita un loop infinito si el server empieza a
// devolver hasMore para siempre por un bug.
const MAX_SYNC_ROUNDS = 200

function formatDate(dateStr: string) {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-AR')
}

function formatPct(pct: number) {
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`
}

export default function TelegramAlerts() {
  const { user } = useAuth()
  const [syncState, setSyncState] = useState<TelegramSyncState | null>(null)
  const [analysis, setAnalysis] = useState<TelegramAnalysis | null>(null)
  const [days, setDays] = useState(90)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState(0)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    if (!user) return
    setLoading(true)
    const [{ data: state }, { data: analyses }] = await Promise.all([
      supabase.from('telegram_sync_state').select('*').maybeSingle(),
      supabase.from('telegram_analyses').select('*').order('created_at', { ascending: false }).limit(1),
    ])
    setSyncState((state as TelegramSyncState) ?? null)
    setAnalysis((analyses?.[0] as TelegramAnalysis) ?? null)
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  async function authHeader() {
    const { data } = await supabase.auth.getSession()
    return { Authorization: `Bearer ${data.session?.access_token}` }
  }

  async function handleSync() {
    setSyncing(true)
    setError(null)
    setSyncProgress(0)
    let total = 0
    try {
      const headers = await authHeader()
      // El server corta cada invocación por cantidad de páginas y por tiempo,
      // así que una sincronización completa son varias llamadas encadenadas —
      // mismo patrón que el botón de Gmail en Transacciones.
      let hasMore = true
      let rounds = 0
      while (hasMore && rounds < MAX_SYNC_ROUNDS) {
        rounds += 1
        const res = await fetch('/api/telegram/sync', { method: 'POST', headers })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'No se pudo sincronizar Telegram')
        total += json.result?.inserted ?? 0
        hasMore = json.result?.hasMore ?? false
        setSyncProgress(total)
      }
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSyncing(false)
    }
  }

  async function handleAnalyze() {
    setAnalyzing(true)
    setError(null)
    try {
      const headers = await authHeader()
      const res = await fetch('/api/telegram/analyze', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ days }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'No se pudo analizar las alertas')
      setAnalysis(json.analysis as TelegramAnalysis)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setAnalyzing(false)
    }
  }

  const signals = useMemo(() => {
    const list = analysis?.signals ?? []
    // Más recientes primero: una alerta de ayer importa más que una de hace
    // ocho meses, aunque la de ocho meses tenga rendimiento más interesante.
    return [...list].sort((a, b) => b.date.localeCompare(a.date))
  }, [analysis])

  const scoreboard = useMemo(() => {
    const evaluated = signals.filter((s) => s.outcome)
    return { total: evaluated.length, hits: evaluated.filter((s) => s.outcome?.worked).length }
  }, [signals])

  return (
    <section className="tg-section">
      <div className="tx-header">
        <h3>Alertas de Telegram</h3>
        <div className="tg-actions">
          <button type="button" className="gmail-scan-btn" onClick={handleSync} disabled={syncing || analyzing}>
            <IconRefresh /> {syncing ? 'Sincronizando...' : 'Sincronizar'}
          </button>
          <button type="button" className="gmail-scan-btn" onClick={handleAnalyze} disabled={syncing || analyzing}>
            <IconTrendingUp size={16} /> {analyzing ? 'Analizando...' : 'Analizar'}
          </button>
        </div>
      </div>

      <div className="type-toggle tg-period" role="group" aria-label="Período a analizar">
        {PERIODS.map((p) => (
          <button key={p.days} type="button" className={days === p.days ? 'active' : ''} onClick={() => setDays(p.days)}>
            {p.label}
          </button>
        ))}
      </div>

      {error && <p className="error">{error}</p>}

      {syncState && (
        <p className="tg-meta">
          {syncState.chat_title ?? syncState.chat_id}
          {syncState.last_synced_at && ` · última sincronización ${formatDate(syncState.last_synced_at)}`}
          {/* Mientras el backfill no termine, el análisis solo ve el tramo ya
              traído — vale la pena decirlo antes de que saque conclusiones de
              medio historial. */}
          {!syncState.backfill_done && ' · historial incompleto, seguí sincronizando'}
        </p>
      )}

      {loading ? (
        <p>Cargando...</p>
      ) : !analysis ? (
        <p className="empty-state">
          {syncState
            ? 'Todavía no generaste un análisis. Elegí un período y tocá Analizar.'
            : 'Sincronizá el grupo de alertas para empezar.'}
        </p>
      ) : (
        <>
          <div className="tg-summary">
            <p>{analysis.summary}</p>
            <p className="tg-meta">
              {analysis.message_count} mensajes · {formatDate(analysis.from_date)} a {formatDate(analysis.to_date)}
              {scoreboard.total > 0 && ` · ${scoreboard.hits} de ${scoreboard.total} señales evaluadas acertaron`}
            </p>
          </div>

          {signals.length === 0 ? (
            <p className="empty-state">No se detectaron señales de compra o venta en este período.</p>
          ) : (
            <div className="tx-table-scroll">
              <table className="tx-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Símbolo</th>
                    <th>Acción</th>
                    <th>Objetivo</th>
                    <th>Desde la señal</th>
                    <th>Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {signals.map((signal, i) => (
                    <tr key={`${signal.symbol}-${signal.date}-${i}`}>
                      <td>{formatDate(signal.date)}</td>
                      <td>
                        {/* Mismo indicador que las transacciones de baja
                            confianza, por consistencia. */}
                        {signal.confidence < LOW_CONFIDENCE && (
                          <span className="review-dot" title="El modelo no está seguro de que esto sea una recomendación" />
                        )}
                        <span className="tx-amount">{signal.symbol}</span>
                        {signal.in_portfolio && <span className="tg-badge">en cartera</span>}
                      </td>
                      <td className={`tg-action tg-action-${signal.action}`}>{ACTION_LABEL[signal.action]}</td>
                      <td className="tx-amount">{signal.target_price ?? '—'}</td>
                      <td className="tx-amount">
                        {signal.outcome ? (
                          <span className={signal.outcome.worked ? 'tg-hit' : 'tg-miss'}>
                            {formatPct(signal.outcome.changePct)}
                          </span>
                        ) : (
                          <span
                            className="tg-muted"
                            title={
                              signal.action === 'hold'
                                ? 'Las señales de mantener no tienen precio de entrada que evaluar'
                                : 'No se consiguió serie de precios para este símbolo'
                            }
                          >
                            —
                          </span>
                        )}
                      </td>
                      <td className="tg-rationale" title={signal.rationale}>
                        {signal.rationale}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {syncing && (
        <Modal>
          <div className="modal-panel-sync">
            <IconRefresh size={28} />
            <p>
              Sincronizando con Telegram...
              {syncProgress > 0 && (
                <>
                  <br />
                  {syncProgress} mensajes hasta ahora
                </>
              )}
            </p>
          </div>
        </Modal>
      )}

      {analyzing && (
        <Modal>
          <div className="modal-panel-sync">
            <IconTrendingUp size={28} />
            <p>Analizando alertas...</p>
          </div>
        </Modal>
      )}
    </section>
  )
}
