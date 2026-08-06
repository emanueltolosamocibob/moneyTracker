import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import type { TelegramSyncState } from '../types/database'
import { IconDownload, IconPlus, IconRefresh } from './icons'
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
type PeriodMode = 'preset' | 'custom'

interface BuyAlert {
  id: string
  date: string
  ticker: string
  companyName: string | null
  possibleGainPct: number | null
  stopLossPct: number | null
  changePct: number | null
  // 'manual' cuando changePct viene de un resultado cargado a mano (para
  // cuando Yahoo no tiene serie del símbolo y el cálculo automático da
  // null); 'computed' cuando sale de createPriceLookup; null si no hay nada.
  changePctSource: 'manual' | 'computed' | null
  // Valor crudo del resultado manual, independiente de si ganó en changePct
  // — precarga el campo del modal de edición.
  manualResultPct: number | null
  // Fecha efectiva de cierre (null mientras sigue abierta) — no la fecha
  // "sugerida" que trae la propia alerta de compra.
  sellDate: string | null
  // 'signal' cuando sellDate viene de una alerta de venta real del canal
  // (prioridad); 'manual' cuando viene de manualSellDate, cargada a mano
  // desde el modal de edición; null si sigue abierta.
  sellDateSource: 'signal' | 'manual' | null
  // Valor crudo del cierre manual, independiente de cuál gane en sellDate —
  // es lo que precarga el campo del modal de edición.
  manualSellDate: string | null
  // 'closed' cuando hay sellDate (real o manual); 'open' si no — ver
  // api/telegram/buy-alerts.ts.
  status: 'open' | 'closed'
  // true si se cargó a mano (botón "+ Agregar alerta"), sin mensaje real de
  // Telegram detrás.
  isManual: boolean
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

// Mismo parseo local que formatDate (no new Date(dateStr) directo, que
// interpreta la fecha en UTC y puede dar un día de diferencia según el huso
// horario del navegador).
function daysBetween(buyDate: string, sellDate: string) {
  const [y1, m1, d1] = buyDate.slice(0, 10).split('-').map(Number)
  const [y2, m2, d2] = sellDate.slice(0, 10).split('-').map(Number)
  const start = new Date(y1, m1 - 1, d1)
  const end = new Date(y2, m2 - 1, d2)
  return Math.round((end.getTime() - start.getTime()) / 86_400_000)
}

export default function TelegramAlerts() {
  const { user } = useAuth()
  const [syncState, setSyncState] = useState<TelegramSyncState | null>(null)
  const [buyAlerts, setBuyAlerts] = useState<BuyAlert[] | null>(null)
  const [periodMode, setPeriodMode] = useState<PeriodMode>('preset')
  const [days, setDays] = useState(90)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [alertsLoading, setAlertsLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Alerta en edición — se abre con doble click sobre su fila (mismo gesto
  // que Loans.tsx usa para editar una cuota).
  const [editingAlert, setEditingAlert] = useState<BuyAlert | null>(null)
  const [editDate, setEditDate] = useState('')
  const [editTicker, setEditTicker] = useState('')
  const [editGainPct, setEditGainPct] = useState('')
  const [editStopLossPct, setEditStopLossPct] = useState('')
  const [editSellDate, setEditSellDate] = useState('')
  const [editResultPct, setEditResultPct] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Confirmación de borrado — se abre desde "Eliminar alerta" en el modal de
  // edición, no directo, a diferencia de otros borrados manuales de la app
  // que no avisan (ver CLAUDE.md).
  const [pendingDeleteAlert, setPendingDeleteAlert] = useState<BuyAlert | null>(null)
  const [deletingAlert, setDeletingAlert] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Alta manual — botón "+ Agregar alerta".
  const [addOpen, setAddOpen] = useState(false)
  const [addDate, setAddDate] = useState('')
  const [addTicker, setAddTicker] = useState('')
  const [addCompany, setAddCompany] = useState('')
  const [addGainPct, setAddGainPct] = useState('')
  const [addStopLossPct, setAddStopLossPct] = useState('')
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  async function authHeader() {
    const { data } = await supabase.auth.getSession()
    return { Authorization: `Bearer ${data.session?.access_token}` }
  }

  async function load() {
    if (!user) return
    const { data: state } = await supabase.from('telegram_sync_state').select('*').maybeSingle()
    setSyncState((state as TelegramSyncState) ?? null)
  }

  // Tabla de alertas de compra: se lee directo de trade_signals (ya parseado
  // por regex al ingerir, ver api/telegram/buy-alerts.ts) — sin costo de LLM,
  // se recarga sola al cambiar el período. En modo "Personalizado" no dispara
  // hasta tener las dos fechas puestas, para no pegarle al server con una
  // punta sola.
  async function loadBuyAlerts() {
    if (!user) return
    if (periodMode === 'custom' && (!customFrom || !customTo)) return
    setAlertsLoading(true)
    try {
      const headers = await authHeader()
      const query = periodMode === 'custom' ? `from=${customFrom}&to=${customTo}` : `days=${days}`
      const res = await fetch(`/api/telegram/buy-alerts?${query}`, { headers })
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
  }, [user, periodMode, days, customFrom, customTo])

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
    setEditSellDate(alert.manualSellDate ?? '')
    setEditResultPct(alert.manualResultPct != null ? String(alert.manualResultPct) : '')
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
          manualSellDate: editSellDate === '' ? null : editSellDate,
          resultPct: editResultPct === '' ? null : Number(editResultPct),
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

  function handleDeleteAlertClick() {
    if (!editingAlert) return
    setPendingDeleteAlert(editingAlert)
    setEditingAlert(null)
    setDeleteError(null)
  }

  async function handleConfirmDeleteAlert() {
    if (!pendingDeleteAlert) return
    setDeletingAlert(true)
    setDeleteError(null)
    try {
      const headers = await authHeader()
      const res = await fetch(`/api/telegram/buy-alerts?id=${encodeURIComponent(pendingDeleteAlert.id)}`, {
        method: 'DELETE',
        headers,
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'No se pudo eliminar la alerta.')
      setPendingDeleteAlert(null)
      await loadBuyAlerts()
    } catch (err) {
      setDeleteError((err as Error).message)
    } finally {
      setDeletingAlert(false)
    }
  }

  function openAddAlert() {
    setAddDate('')
    setAddTicker('')
    setAddCompany('')
    setAddGainPct('')
    setAddStopLossPct('')
    setAddError(null)
    setAddOpen(true)
  }

  async function handleAddAlertSubmit(e: FormEvent) {
    e.preventDefault()
    setAddError(null)

    const tickerClean = addTicker.trim().toUpperCase()
    if (!addDate) {
      setAddError('Ingresá una fecha.')
      return
    }
    if (!tickerClean) {
      setAddError('El símbolo no puede estar vacío.')
      return
    }

    setAddSaving(true)
    try {
      const headers = await authHeader()
      const res = await fetch('/api/telegram/buy-alerts', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: addDate,
          ticker: tickerClean,
          companyName: addCompany.trim() || null,
          possibleGainPct: addGainPct === '' ? null : Number(addGainPct),
          stopLossPct: addStopLossPct === '' ? null : Number(addStopLossPct),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'No se pudo agregar la alerta.')
      setAddOpen(false)
      await loadBuyAlerts()
    } catch (err) {
      setAddError((err as Error).message)
    } finally {
      setAddSaving(false)
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

  return (
    <section className="tg-section">
      <div className="tx-header">
        <h3>Alertas de Telegram</h3>
        <div className="tg-actions">
          <button type="button" className="gmail-scan-btn" onClick={handleSync} disabled={syncing}>
            <IconRefresh /> {syncing ? 'Sincronizando...' : 'Sincronizar'}
          </button>
          <button type="button" className="gmail-scan-btn" onClick={openAddAlert}>
            <IconPlus size={14} /> Agregar alerta
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
        <div className="type-toggle tg-period" role="group" aria-label="Período">
          {PERIODS.map((p) => (
            <button
              key={p.days}
              type="button"
              className={periodMode === 'preset' && days === p.days ? 'active' : ''}
              onClick={() => {
                setPeriodMode('preset')
                setDays(p.days)
              }}
            >
              {p.label}
            </button>
          ))}
          <button type="button" className={periodMode === 'custom' ? 'active' : ''} onClick={() => setPeriodMode('custom')}>
            Personalizado
          </button>
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

      {periodMode === 'custom' && (
        <div className="budget-custom-range">
          <DateField value={customFrom} onChange={setCustomFrom} />
          <span>–</span>
          <DateField value={customTo} onChange={setCustomTo} />
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {syncState && (
        <p className="tg-meta">
          {syncState.chat_title ?? syncState.chat_id}
          {syncState.last_synced_at && ` · última sincronización ${formatDate(syncState.last_synced_at)}`}
          {/* Mientras el backfill no termine, la tabla solo ve el tramo ya
              traído — vale la pena decirlo antes de que parezca que faltan
              alertas. */}
          {!syncState.backfill_done && ' · historial incompleto, seguí sincronizando'}
        </p>
      )}

      {periodMode === 'custom' && (!customFrom || !customTo) ? (
        <p className="empty-state">Elegí las dos fechas del rango para ver las alertas.</p>
      ) : alertsLoading ? (
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
                <th className="tx-amount-header">Días</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {filteredAlerts.map((alert) => (
                <tr key={alert.id} onDoubleClick={() => openEditAlert(alert)}>
                  <td>{formatDate(alert.date)}</td>
                  <td className="tx-amount">
                    {alert.ticker}
                    {alert.isManual && <span className="tg-badge">Manual</span>}
                  </td>
                  <td className="tg-company">{alert.companyName ?? <span className="tg-muted">—</span>}</td>
                  <td className="tx-amount">{alert.possibleGainPct != null ? `+${alert.possibleGainPct.toFixed(2)}%` : '—'}</td>
                  <td className="tx-amount tg-stoploss">{alert.stopLossPct != null ? `-${alert.stopLossPct.toFixed(2)}%` : '—'}</td>
                  <td className="tx-amount">
                    {alert.changePct != null ? (
                      <span
                        className={alert.changePct >= 0 ? 'tg-hit' : 'tg-miss'}
                        title={alert.changePctSource === 'manual' ? 'Cargado a mano' : undefined}
                      >
                        {formatPct(alert.changePct)}
                        {alert.changePctSource === 'manual' && '*'}
                      </span>
                    ) : (
                      <span className="tg-muted" title="No se consiguió serie de precios para este símbolo">
                        —
                      </span>
                    )}
                  </td>
                  <td>{alert.sellDate ? formatDate(alert.sellDate) : <span className="tg-muted">—</span>}</td>
                  <td className="tx-amount">{alert.sellDate ? daysBetween(alert.date, alert.sellDate) : <span className="tg-muted">—</span>}</td>
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
            {editingAlert.sellDateSource === 'signal' ? (
              <p className="budget-form-hint">
                Cerrada por una alerta de venta real del canal ({editingAlert.sellDate && formatDate(editingAlert.sellDate)}) — no
                editable acá.
              </p>
            ) : (
              <>
                <p className="budget-form-hint">
                  Fecha de venta (manual) — marcá la alerta como cerrada si vendiste sin que el canal mandara su propia alerta.
                </p>
                <DateField value={editSellDate} onChange={setEditSellDate} />
                {editSellDate && (
                  <button type="button" className="gmail-scan-btn" onClick={() => setEditSellDate('')}>
                    Quitar fecha de venta
                  </button>
                )}
              </>
            )}
            {(editingAlert.sellDateSource === 'signal' || editSellDate) && (
              <>
                <p className="budget-form-hint">
                  Resultado (%) — cargalo a mano si Yahoo Finance no tiene la serie de este símbolo y "% desde la alerta" quedó
                  vacío.
                </p>
                <input
                  type="number"
                  step="0.01"
                  placeholder="Resultado (%)"
                  value={editResultPct}
                  onChange={(e) => setEditResultPct(e.target.value)}
                />
                {editResultPct && (
                  <button type="button" className="gmail-scan-btn" onClick={() => setEditResultPct('')}>
                    Quitar resultado manual
                  </button>
                )}
              </>
            )}
            {editError && <p className="error">{editError}</p>}
            <div className="modal-actions">
              <button type="button" className="danger modal-actions-start" onClick={handleDeleteAlertClick}>
                Eliminar alerta
              </button>
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

      {pendingDeleteAlert && (
        <Modal>
          <h3>Eliminar alerta</h3>
          <p>
            Se va a eliminar la alerta de compra de &quot;{pendingDeleteAlert.ticker}&quot; del {formatDate(pendingDeleteAlert.date)}.
            Esta acción no se puede deshacer.
          </p>
          {deleteError && <p className="error">{deleteError}</p>}
          <div className="modal-actions">
            <button type="button" onClick={() => setPendingDeleteAlert(null)}>
              Cancelar
            </button>
            <button type="button" className="danger" disabled={deletingAlert} onClick={handleConfirmDeleteAlert}>
              {deletingAlert ? 'Eliminando...' : 'Eliminar'}
            </button>
          </div>
        </Modal>
      )}

      {addOpen && (
        <Modal>
          <h3>Agregar alerta</h3>
          <form className="budget-form" onSubmit={handleAddAlertSubmit} noValidate>
            <DateField value={addDate} onChange={setAddDate} />
            <input
              type="text"
              placeholder="Símbolo"
              value={addTicker}
              onChange={(e) => setAddTicker(e.target.value.toUpperCase())}
            />
            <input type="text" placeholder="Compañía (opcional)" value={addCompany} onChange={(e) => setAddCompany(e.target.value)} />
            <input
              type="number"
              step="0.01"
              placeholder="Ganancia estimada (%)"
              value={addGainPct}
              onChange={(e) => setAddGainPct(e.target.value)}
            />
            <input
              type="number"
              step="0.01"
              placeholder="Stop loss (%)"
              value={addStopLossPct}
              onChange={(e) => setAddStopLossPct(e.target.value)}
            />
            {addError && <p className="error">{addError}</p>}
            <div className="modal-actions">
              <button type="button" onClick={() => setAddOpen(false)}>
                Cancelar
              </button>
              <button type="submit" className="primary" disabled={addSaving}>
                {addSaving ? 'Guardando...' : 'Agregar'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  )
}
