import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import type { TelegramAnalysis, TelegramSyncState } from '../types/database'
import { IconDownload, IconRefresh, IconTrendingUp } from './icons'
import Modal from './Modal'
import DateField from './DateField'

const PERIODS = [
  { days: 30, label: '30 días' },
  { days: 90, label: '90 días' },
  { days: 365, label: '1 año' },
]

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'open', label: 'Abiertas' },
  { value: 'closed', label: 'Cerradas' },
]

type StatusFilter = 'all' | 'open' | 'closed'

interface BuyAlert {
  id: string
  date: string
  ticker: string
  companyName: string | null
  possibleGainPct: number | null
  stopLossPct: number | null
  changePct: number | null
  // Fecha de la alerta de venta que cerró esta compra (null mientras sigue
  // abierta) — no la fecha "sugerida" que trae la propia alerta de compra.
  sellDate: string | null
  // 'closed' cuando el canal ya mandó una alerta de venta para este símbolo
  // después de esta compra; 'open' mientras solo hubo la de compra — ver
  // api/telegram/buy-alerts.ts.
  status: 'open' | 'closed'
}

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
  const [buyAlerts, setBuyAlerts] = useState<BuyAlert[] | null>(null)
  const [days, setDays] = useState(90)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [loading, setLoading] = useState(true)
  const [alertsLoading, setAlertsLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState(0)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Alerta en edición — se abre con doble click sobre su fila (mismo gesto
  // que Loans.tsx usa para editar una cuota).
  const [editingAlert, setEditingAlert] = useState<BuyAlert | null>(null)
  const [editDate, setEditDate] = useState('')
  const [editTicker, setEditTicker] = useState('')
  const [editGainPct, setEditGainPct] = useState('')
  const [editStopLossPct, setEditStopLossPct] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  async function authHeader() {
    const { data } = await supabase.auth.getSession()
    return { Authorization: `Bearer ${data.session?.access_token}` }
  }

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

  // Tabla de alertas de compra: se lee directo de trade_signals (ya parseado
  // por regex al ingerir, ver api/telegram/buy-alerts.ts), no del análisis
  // del LLM — sin el límite de 300 mensajes que hacía que "1 año" mostrara
  // siempre lo mismo que "30 días". Se recarga sola al cambiar el período,
  // sin costo de LLM.
  async function loadBuyAlerts() {
    if (!user) return
    setAlertsLoading(true)
    try {
      const headers = await authHeader()
      const res = await fetch(`/api/telegram/buy-alerts?days=${days}`, { headers })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'No se pudieron cargar las alertas')
      setBuyAlerts(json.alerts as BuyAlert[])
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setAlertsLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  useEffect(() => {
    loadBuyAlerts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, days])

  const filteredAlerts = useMemo(() => {
    if (!buyAlerts) return null
    if (statusFilter === 'all') return buyAlerts
    return buyAlerts.filter((a) => a.status === statusFilter)
  }, [buyAlerts, statusFilter])

  function openEditAlert(alert: BuyAlert) {
    setEditingAlert(alert)
    setEditDate(alert.date)
    setEditTicker(alert.ticker)
    setEditGainPct(alert.possibleGainPct != null ? String(alert.possibleGainPct) : '')
    setEditStopLossPct(alert.stopLossPct != null ? String(alert.stopLossPct) : '')
    setEditError(null)
  }

  async function handleEditAlertSubmit(e: FormEvent) {
    e.preventDefault()
    if (!editingAlert) return
    setEditError(null)

    const tickerClean = editTicker.trim().toUpperCase()
    if (!editDate) {
      setEditError('Ingresá una fecha.')
      return
    }
    if (!tickerClean) {
      setEditError('El símbolo no puede estar vacío.')
      return
    }

    setEditSaving(true)
    try {
      const headers = await authHeader()
      const res = await fetch('/api/telegram/buy-alerts', {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingAlert.id,
          date: editDate,
          ticker: tickerClean,
          possibleGainPct: editGainPct === '' ? null : Number(editGainPct),
          stopLossPct: editStopLossPct === '' ? null : Number(editStopLossPct),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'No se pudo guardar la alerta.')
      setEditingAlert(null)
      await loadBuyAlerts()
    } catch (err) {
      setEditError((err as Error).message)
    } finally {
      setEditSaving(false)
    }
  }

  // "Exportar PDF" vía el diálogo de impresión del navegador (Guardar como
  // PDF) en vez de sumar una librería como jspdf solo para esto — .tg-print
  // (ver index.css) oculta todo lo demás de la página en @media print y deja
  // la tabla a ancho completo.
  function handleExportPdf() {
    window.print()
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
      await loadBuyAlerts()
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
          <button
            type="button"
            className="gmail-scan-btn"
            onClick={handleExportPdf}
            disabled={!buyAlerts || buyAlerts.length === 0}
          >
            <IconDownload size={16} /> Exportar PDF
          </button>
        </div>
      </div>

      <div className="tg-filters">
        <div className="type-toggle tg-period" role="group" aria-label="Período a analizar">
          {PERIODS.map((p) => (
            <button key={p.days} type="button" className={days === p.days ? 'active' : ''} onClick={() => setDays(p.days)}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="type-toggle tg-period" role="group" aria-label="Filtrar por estado">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={statusFilter === f.value ? 'active' : ''}
              onClick={() => setStatusFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
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
      ) : (
        analysis && (
          <div className="tg-summary">
            <p>{analysis.summary}</p>
            <p className="tg-meta">
              {analysis.message_count} mensajes · {formatDate(analysis.from_date)} a {formatDate(analysis.to_date)}
            </p>
          </div>
        )
      )}

      {alertsLoading ? (
        <p>Cargando alertas...</p>
      ) : !buyAlerts || buyAlerts.length === 0 ? (
        <p className="empty-state">
          {syncState ? 'No hay alertas de compra en este período.' : 'Sincronizá el grupo de alertas para empezar.'}
        </p>
      ) : !filteredAlerts || filteredAlerts.length === 0 ? (
        <p className="empty-state">No hay alertas {statusFilter === 'open' ? 'abiertas' : 'cerradas'} en este período.</p>
      ) : (
        <div className="tx-table-scroll tg-print">
          <table className="tx-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Símbolo</th>
                <th>Compañía</th>
                <th className="tx-amount-header">Ganancia estimada</th>
                <th className="tx-amount-header">Stop loss</th>
                <th className="tx-amount-header">% desde la alerta</th>
                <th>Fecha de venta</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {filteredAlerts.map((alert) => (
                <tr key={alert.id} onDoubleClick={() => openEditAlert(alert)}>
                  <td>{formatDate(alert.date)}</td>
                  <td className="tx-amount">{alert.ticker}</td>
                  <td className="tg-company">{alert.companyName ?? <span className="tg-muted">—</span>}</td>
                  <td className="tx-amount">{alert.possibleGainPct != null ? `+${alert.possibleGainPct.toFixed(2)}%` : '—'}</td>
                  <td className="tx-amount tg-stoploss">{alert.stopLossPct != null ? `-${alert.stopLossPct.toFixed(2)}%` : '—'}</td>
                  <td className="tx-amount">
                    {alert.changePct != null ? (
                      <span className={alert.changePct >= 0 ? 'tg-hit' : 'tg-miss'}>{formatPct(alert.changePct)}</span>
                    ) : (
                      <span className="tg-muted" title="No se consiguió serie de precios para este símbolo">
                        —
                      </span>
                    )}
                  </td>
                  <td>{alert.sellDate ? formatDate(alert.sellDate) : <span className="tg-muted">—</span>}</td>
                  <td>
                    <span className={`tg-status-badge ${alert.status === 'open' ? 'tg-status-open' : 'tg-status-closed'}`}>
                      {alert.status === 'open' ? 'Abierta' : 'Cerrada'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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

      {editingAlert && (
        <Modal>
          <h3>Editar alerta — {editingAlert.ticker}</h3>
          <form className="budget-form" onSubmit={handleEditAlertSubmit} noValidate>
            <DateField value={editDate} onChange={setEditDate} />
            <input
              type="text"
              placeholder="Símbolo"
              value={editTicker}
              onChange={(e) => setEditTicker(e.target.value.toUpperCase())}
            />
            <input
              type="number"
              step="0.01"
              placeholder="Ganancia estimada (%)"
              value={editGainPct}
              onChange={(e) => setEditGainPct(e.target.value)}
            />
            <input
              type="number"
              step="0.01"
              placeholder="Stop loss (%)"
              value={editStopLossPct}
              onChange={(e) => setEditStopLossPct(e.target.value)}
            />
            {editError && <p className="error">{editError}</p>}
            <div className="modal-actions">
              <button type="button" onClick={() => setEditingAlert(null)}>
                Cancelar
              </button>
              <button type="submit" className="primary" disabled={editSaving}>
                {editSaving ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  )
}
