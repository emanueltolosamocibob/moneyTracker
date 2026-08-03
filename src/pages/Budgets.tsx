import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import type { BudgetItem, BudgetPeriod, BudgetPeriodType, Category } from '../types/database'
import { IconHistory, IconPencil, IconPlus } from '../components/icons'
import Modal from '../components/Modal'
import DateField from '../components/DateField'
import { getCategoryIcon } from '../lib/categoryIcons'

const AUTO_RENEW_MAX_ITERATIONS = 36

function formatCurrency(amount: number, currency: string) {
  return amount.toLocaleString('es-AR', { style: 'currency', currency })
}

// Mismo estilo que el monto de Transactions.tsx, pero sin la máscara de
// centavos: acá cada dígito tipeado es un peso entero, no el último par de
// centavos (los presupuestos se definen en pesos redondos).
function formatWholeAmountDigits(digits: string) {
  if (!digits) return ''
  return Number(digits).toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
}

function todayDateStr() {
  const d = new Date()
  return toDateInputStr(d)
}

function toDateInputStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Igual razonamiento que en Transactions.tsx: construir con año/mes/día
// sueltos usa medianoche local en vez de UTC, así que no se corre un día.
function parseDateLocal(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function dateInputToISOStart(dateStr: string) {
  return parseDateLocal(dateStr).toISOString()
}

function dateInputToISOEndExclusive(dateStr: string) {
  const d = parseDateLocal(dateStr)
  d.setDate(d.getDate() + 1)
  return d.toISOString()
}

function monthRangeFor(dateStr: string) {
  const [y, m] = dateStr.split('-').map(Number)
  return {
    start: toDateInputStr(new Date(y, m - 1, 1)),
    end: toDateInputStr(new Date(y, m, 0)),
  }
}

// Rango del mes siguiente al que contiene `periodStartStr` (que ya es el
// primer día de un mes, para períodos mensuales).
function monthRangeAfter(periodStartStr: string) {
  const [y, m] = periodStartStr.split('-').map(Number)
  return {
    start: toDateInputStr(new Date(y, m, 1)),
    end: toDateInputStr(new Date(y, m + 1, 0)),
  }
}

function formatDateShort(dateStr: string) {
  return parseDateLocal(dateStr).toLocaleDateString('es-AR')
}

function formatPeriodLabel(periodType: BudgetPeriodType, periodStart: string, periodEnd: string) {
  if (periodType === 'monthly') {
    const label = parseDateLocal(periodStart).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
    return label.charAt(0).toUpperCase() + label.slice(1)
  }
  return `${formatDateShort(periodStart)} – ${formatDateShort(periodEnd)}`
}

interface BudgetHistoryRow {
  period: BudgetPeriod
  totalBudgeted: number
  totalSpent: number
}

function BudgetRing({ pct, icon }: { pct: number; icon: ReactNode }) {
  const size = 64
  const stroke = 5
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const clamped = Math.min(Math.max(pct, 0), 100)
  const offset = c * (1 - clamped / 100)
  const status = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : ''

  return (
    <div className={`budget-ring-wrap ${status}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle className="budget-ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" />
        <circle
          className="budget-ring-fill"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="budget-ring-icon">{icon}</span>
    </div>
  )
}

export default function Budgets() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [categories, setCategories] = useState<Category[]>([])
  const [period, setPeriod] = useState<BudgetPeriod | null>(null)
  const [items, setItems] = useState<BudgetItem[]>([])
  const [spentTx, setSpentTx] = useState<{ category_id: string | null; amount: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [periodType, setPeriodType] = useState<BudgetPeriodType>('monthly')
  const [customStart, setCustomStart] = useState(todayDateStr)
  const [customEnd, setCustomEnd] = useState(todayDateStr)
  const [autoRenew, setAutoRenew] = useState(false)
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [pendingDeletePeriod, setPendingDeletePeriod] = useState<BudgetPeriod | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyRows, setHistoryRows] = useState<BudgetHistoryRow[]>([])

  async function load() {
    if (!user) return
    setLoading(true)
    setError(null)

    const { data: cats } = await supabase.from('categories').select('*').order('name')
    setCategories(cats ?? [])

    const todayStr = todayDateStr()
    const { data: latestData, error: latestError } = await supabase
      .from('budget_periods')
      .select('*')
      .order('period_start', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (latestError) {
      setError(latestError.message)
      setLoading(false)
      return
    }

    let current = latestData as BudgetPeriod | null

    // Reinicio automático: si el último período mensual ya venció y se pidió
    // reiniciar con los mismos montos, generamos acá (al cargar la vista) los
    // períodos que hagan falta hasta llegar al que cubre hoy. No hay cron
    // propio para esto, así que se resuelve de forma perezosa en el primer
    // load posterior al vencimiento.
    if (current && current.period_end < todayStr) {
      let last = current
      let iterations = 0
      while (last.period_type === 'monthly' && last.auto_renew && last.period_end < todayStr && iterations < AUTO_RENEW_MAX_ITERATIONS) {
        const { data: lastItems } = await supabase.from('budget_items').select('*').eq('budget_period_id', last.id)
        const range = monthRangeAfter(last.period_start)
        const { data: newPeriod, error: renewError } = await supabase
          .from('budget_periods')
          .insert({
            user_id: user.id,
            period_type: 'monthly',
            period_start: range.start,
            period_end: range.end,
            auto_renew: true,
          })
          .select()
          .single()
        if (renewError || !newPeriod) break
        if (lastItems && lastItems.length > 0) {
          await supabase.from('budget_items').insert(
            lastItems.map((it) => ({
              user_id: user.id,
              budget_period_id: newPeriod.id,
              category_id: it.category_id,
              amount: it.amount,
            })),
          )
        }
        last = newPeriod
        iterations++
      }
      current = last.period_end >= todayStr ? last : null
    }

    setPeriod(current)

    if (current) {
      const { data: itemsData } = await supabase.from('budget_items').select('*').eq('budget_period_id', current.id)
      setItems(itemsData ?? [])

      const { data: tx } = await supabase
        .from('transactions')
        .select('category_id, amount')
        .eq('type', 'expense')
        .gte('occurred_at', dateInputToISOStart(current.period_start))
        .lt('occurred_at', dateInputToISOEndExclusive(current.period_end))
      setSpentTx(tx ?? [])
    } else {
      setItems([])
      setSpentTx([])
    }

    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const totalBudgeted = useMemo(() => items.reduce((sum, it) => sum + it.amount, 0), [items])
  const totalSpent = useMemo(() => spentTx.reduce((sum, t) => sum + t.amount, 0), [spentTx])
  const totalSpentPct = totalBudgeted > 0 ? (totalSpent / totalBudgeted) * 100 : 0
  const totalSpentStatus = totalSpentPct >= 100 ? 'over' : totalSpentPct >= 80 ? 'warn' : ''

  function spentForCategory(categoryId: string) {
    return spentTx.filter((t) => t.category_id === categoryId).reduce((sum, t) => sum + t.amount, 0)
  }

  function openCreate() {
    setEditing(false)
    setPeriodType('monthly')
    setCustomStart(todayDateStr())
    setCustomEnd(todayDateStr())
    setAutoRenew(false)
    setAmounts({})
    setFormError(null)
    setModalOpen(true)
  }

  function openEdit() {
    if (!period) return
    setEditing(true)
    setPeriodType(period.period_type)
    setCustomStart(period.period_start)
    setCustomEnd(period.period_end)
    setAutoRenew(period.auto_renew)
    const nextAmounts: Record<string, string> = {}
    for (const item of items) {
      nextAmounts[item.category_id] = String(Math.round(item.amount))
    }
    setAmounts(nextAmounts)
    setFormError(null)
    setModalOpen(true)
  }

  function handleDeleteClick() {
    if (!period) return
    setModalOpen(false)
    setPendingDeletePeriod(period)
  }

  async function confirmDeletePeriod() {
    const target = pendingDeletePeriod
    if (!target) return
    setDeleting(true)
    const { error: deleteError } = await supabase.from('budget_periods').delete().eq('id', target.id)
    setDeleting(false)
    if (deleteError) {
      setError(deleteError.message)
      setPendingDeletePeriod(null)
      return
    }
    setPendingDeletePeriod(null)
    load()
  }

  async function openHistory() {
    setHistoryOpen(true)
    setHistoryLoading(true)
    const { data: periods } = await supabase.from('budget_periods').select('*').order('period_start', { ascending: false })
    const list = periods ?? []

    const rows = await Promise.all(
      list.map(async (p): Promise<BudgetHistoryRow> => {
        const [{ data: periodItems }, { data: tx }] = await Promise.all([
          supabase.from('budget_items').select('amount').eq('budget_period_id', p.id),
          supabase
            .from('transactions')
            .select('amount')
            .eq('type', 'expense')
            .gte('occurred_at', dateInputToISOStart(p.period_start))
            .lt('occurred_at', dateInputToISOEndExclusive(p.period_end)),
        ])
        return {
          period: p,
          totalBudgeted: (periodItems ?? []).reduce((sum, it) => sum + it.amount, 0),
          totalSpent: (tx ?? []).reduce((sum, t) => sum + t.amount, 0),
        }
      }),
    )

    setHistoryRows(rows)
    setHistoryLoading(false)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    setFormError(null)

    const categoryAmounts = categories
      .map((c) => ({ category_id: c.id, amount: Number(amounts[c.id]) }))
      .filter((c) => amounts[c.category_id] && c.amount > 0)

    if (categoryAmounts.length === 0) {
      setFormError('Definí un tope para al menos una categoría.')
      return
    }

    let periodStart: string
    let periodEnd: string
    if (editing && period) {
      periodStart = period.period_start
      periodEnd = period.period_end
    } else if (periodType === 'monthly') {
      const range = monthRangeFor(todayDateStr())
      periodStart = range.start
      periodEnd = range.end
    } else {
      if (customStart > customEnd) {
        setFormError('La fecha de inicio tiene que ser anterior a la de fin.')
        return
      }
      periodStart = customStart
      periodEnd = customEnd
    }

    setSaving(true)

    if (editing && period) {
      const { error: updateError } = await supabase
        .from('budget_periods')
        .update({ auto_renew: periodType === 'monthly' ? autoRenew : false })
        .eq('id', period.id)
      if (updateError) {
        setSaving(false)
        setFormError(updateError.message)
        return
      }

      const keptCategoryIds = new Set(categoryAmounts.map((c) => c.category_id))
      const removedItemIds = items.filter((it) => !keptCategoryIds.has(it.category_id)).map((it) => it.id)
      if (removedItemIds.length > 0) {
        await supabase.from('budget_items').delete().in('id', removedItemIds)
      }

      const { error: upsertError } = await supabase.from('budget_items').upsert(
        categoryAmounts.map((c) => ({
          budget_period_id: period.id,
          user_id: user.id,
          category_id: c.category_id,
          amount: c.amount,
        })),
        { onConflict: 'budget_period_id,category_id' },
      )
      if (upsertError) {
        setSaving(false)
        setFormError(upsertError.message)
        return
      }
    } else {
      const { data: newPeriod, error: insertPeriodError } = await supabase
        .from('budget_periods')
        .insert({
          user_id: user.id,
          period_type: periodType,
          period_start: periodStart,
          period_end: periodEnd,
          auto_renew: periodType === 'monthly' ? autoRenew : false,
        })
        .select()
        .single()
      if (insertPeriodError || !newPeriod) {
        setSaving(false)
        setFormError(insertPeriodError?.message ?? 'No se pudo crear el presupuesto')
        return
      }

      const { error: insertItemsError } = await supabase.from('budget_items').insert(
        categoryAmounts.map((c) => ({
          budget_period_id: newPeriod.id,
          user_id: user.id,
          category_id: c.category_id,
          amount: c.amount,
        })),
      )
      if (insertItemsError) {
        setSaving(false)
        setFormError(insertItemsError.message)
        return
      }
    }

    setSaving(false)
    setModalOpen(false)
    load()
  }

  return (
    <div>
      <div className="tx-header">
        <h2>Presupuestos</h2>
        <div className="budget-header-actions">
          <button type="button" className="gmail-scan-btn" onClick={openHistory}>
            <IconHistory size={14} />
            <span className="budget-history-btn-label-full">Presupuestos anteriores</span>
            <span className="budget-history-btn-label-short">Anteriores</span>
          </button>
          {period && (
            <button type="button" className="gmail-scan-btn" onClick={openEdit}>
              <IconPencil size={14} /> Editar
            </button>
          )}
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {loading ? (
        <p>Cargando...</p>
      ) : !period ? (
        <div className="budget-empty">
          <p>Todavía no estableciste presupuestos.</p>
          <button type="button" onClick={openCreate}>
            <IconPlus size={14} /> Crear presupuesto
          </button>
        </div>
      ) : (
        <>
          <div className="budget-summary">
            <div>
              <span>Presupuestado</span>
              <strong className="budget-summary-amount">{formatCurrency(totalBudgeted, 'ARS')}</strong>
            </div>
            <div className="budget-summary-spent">
              <span>Gastado</span>
              <span className="budget-summary-spent-row">
                <strong className={`budget-summary-amount ${totalSpentStatus}`}>{formatCurrency(totalSpent, 'ARS')}</strong>
                <span className="budget-summary-pct">({Math.round(totalSpentPct)}%)</span>
              </span>
            </div>
          </div>
          <p className="budget-period-label">{formatPeriodLabel(period.period_type, period.period_start, period.period_end)}</p>

          {items.length === 0 ? (
            <p className="empty-state">Este período todavía no tiene topes por categoría.</p>
          ) : (
            <div className="budget-grid">
              {items.map((item) => {
                const cat = categories.find((c) => c.id === item.category_id)
                const spent = spentForCategory(item.category_id)
                const pct = item.amount > 0 ? (spent / item.amount) * 100 : 0
                const status = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : ''
                return (
                  <div
                    className="budget-card dashboard-card-clickable"
                    key={item.id}
                    onClick={() => navigate(`/transactions?category=${item.category_id}`)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') navigate(`/transactions?category=${item.category_id}`)
                    }}
                  >
                    <BudgetRing pct={pct} icon={getCategoryIcon(cat?.name, cat?.icon)} />
                    <strong className={`budget-card-spent ${status}`}>{formatCurrency(spent, 'ARS')}</strong>
                    <span className="budget-card-limit">de {formatCurrency(item.amount, 'ARS')}</span>
                    <span className="budget-card-title">{cat?.name ?? '—'}</span>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {modalOpen && (
        <Modal>
          <h3>{editing ? 'Editar presupuesto' : 'Nuevo presupuesto'}</h3>
          <form className="budget-form" onSubmit={handleSubmit} noValidate>
            <div className="type-toggle" role="group" aria-label="Tipo de período">
              <button
                type="button"
                disabled={editing}
                className={periodType === 'monthly' ? 'active' : ''}
                onClick={() => setPeriodType('monthly')}
              >
                Mensual
              </button>
              <button
                type="button"
                disabled={editing}
                className={periodType === 'custom' ? 'active' : ''}
                onClick={() => setPeriodType('custom')}
              >
                Personalizado
              </button>
            </div>

            {periodType === 'monthly' ? (
              <p className="budget-form-hint">
                Período:{' '}
                {editing && period
                  ? formatPeriodLabel('monthly', period.period_start, period.period_end)
                  : formatPeriodLabel('monthly', monthRangeFor(todayDateStr()).start, monthRangeFor(todayDateStr()).end)}
              </p>
            ) : (
              <div className="budget-custom-range">
                <DateField value={customStart} disabled={editing} onChange={setCustomStart} />
                <span>–</span>
                <DateField value={customEnd} disabled={editing} onChange={setCustomEnd} />
              </div>
            )}

            <div className="budget-category-list">
              {categories.map((c) => (
                <div className="budget-category-row" key={c.id}>
                  <span className="budget-category-label">
                    {getCategoryIcon(c.name, c.icon)}
                    <span>{c.name}</span>
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    className="amount-input"
                    placeholder="$ 0"
                    value={formatWholeAmountDigits(amounts[c.id] ?? '')}
                    onChange={(e) =>
                      setAmounts((a) => ({ ...a, [c.id]: e.target.value.replace(/\D/g, '').slice(0, 12) }))
                    }
                  />
                </div>
              ))}
            </div>

            {periodType === 'monthly' && (
              <label className="budget-checkbox-row">
                <input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} />
                Reiniciar automáticamente con los mismos montos al terminar el mes
              </label>
            )}

            {formError && <p className="error">{formError}</p>}

            <div className="modal-actions">
              {editing && (
                <button type="button" className="danger modal-actions-start" onClick={handleDeleteClick}>
                  Eliminar presupuesto
                </button>
              )}
              <button type="button" onClick={() => setModalOpen(false)}>
                Cancelar
              </button>
              <button type="submit" className="primary" disabled={saving}>
                {saving ? 'Guardando...' : editing ? 'Guardar cambios' : 'Crear presupuesto'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {pendingDeletePeriod && (
        <Modal>
          <h3>Eliminar presupuesto</h3>
          <p>
            Se va a eliminar el presupuesto de{' '}
            {formatPeriodLabel(pendingDeletePeriod.period_type, pendingDeletePeriod.period_start, pendingDeletePeriod.period_end)}{' '}
            junto con todos sus topes por categoría. Esta acción no se puede deshacer.
          </p>
          <div className="modal-actions">
            <button type="button" onClick={() => setPendingDeletePeriod(null)}>
              Cancelar
            </button>
            <button type="button" className="danger" onClick={confirmDeletePeriod} disabled={deleting}>
              {deleting ? 'Eliminando...' : 'Eliminar'}
            </button>
          </div>
        </Modal>
      )}

      {historyOpen && (
        <Modal wide>
          <h3>Presupuestos anteriores</h3>
          {historyLoading ? (
            <p>Cargando...</p>
          ) : historyRows.length === 0 ? (
            <p className="empty-state">Todavía no hay presupuestos registrados.</p>
          ) : (
            <div className="tx-table-scroll">
              <table className="tx-table">
                <thead>
                  <tr>
                    <th>Período</th>
                    <th>Tipo</th>
                    <th>Presupuestado</th>
                    <th>Gastado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {historyRows.map(({ period: p, totalBudgeted: budgeted, totalSpent: spent }) => (
                    <tr key={p.id}>
                      <td>{formatPeriodLabel(p.period_type, p.period_start, p.period_end)}</td>
                      <td>{p.period_type === 'monthly' ? 'Mensual' : 'Personalizado'}</td>
                      <td className="tx-amount">{formatCurrency(budgeted, 'ARS')}</td>
                      <td className="tx-amount">{formatCurrency(spent, 'ARS')}</td>
                      <td>{period?.id === p.id && <span className="new-badge" title="Activo">●</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="modal-actions">
            <button type="button" onClick={() => setHistoryOpen(false)}>
              Cerrar
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
