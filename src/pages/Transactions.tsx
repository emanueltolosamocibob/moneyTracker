import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import type { Category, IncomeSource, PaymentMethod, Transaction, TransactionType } from '../types/database'
import { IconChevronDown, IconPlus, IconRefresh, IconX } from '../components/icons'
import Select from '../components/Select'
import Modal from '../components/Modal'
import DateField from '../components/DateField'
import { getCategoryIcon } from '../lib/categoryIcons'

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  credit_card: 'Crédito',
  debit_card: 'Débito',
  transfer: 'Transferencia',
  cash: 'Efectivo',
  other: 'Otro',
}

type PageSize = number | 'all'
const PAGE_SIZE_OPTIONS: PageSize[] = [20, 50, 100, 'all']
const FETCH_LIMIT = 500

function PaymentMethodCell({ t }: { t: Transaction }) {
  if (!t.payment_method) return <>—</>
  const label = PAYMENT_METHOD_LABELS[t.payment_method]
  const isCard = t.payment_method === 'credit_card' || t.payment_method === 'debit_card'
  if (!isCard || !t.card_last4) return <>{label}</>
  return (
    <span className="tx-payment-method-inner">
      <span>{label}</span>
      <span className="tx-card-digits">•• {t.card_last4}</span>
    </span>
  )
}

function formatCurrency(amount: number, currency: string) {
  return amount.toLocaleString('es-AR', { style: 'currency', currency })
}

// Máscara de monto tipo "POS": el usuario solo tipea dígitos, los últimos
// dos son siempre los centavos (1290 -> $12,90; 129000 -> $1.290,00).
function centsToNumber(digits: string) {
  return Number(digits || '0') / 100
}

function formatAmountDigits(digits: string) {
  if (!digits) return ''
  return formatCurrency(centsToNumber(digits), 'ARS')
}

function numberToCentsDigits(amount: number) {
  return Math.round(amount * 100).toString()
}

function todayDateInput() {
  return new Date().toISOString().slice(0, 10)
}

// new Date('YYYY-MM-DD') parsea como medianoche UTC, no local — con Argentina
// en UTC-3 eso corre la fecha un día para atrás al mostrarla de vuelta con
// toLocaleDateString. Construyendo con año/mes/día sueltos, Date usa
// medianoche local, así que el viaje de ida y vuelta conserva la fecha que
// eligió el usuario.
function dateInputToISO(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toISOString()
}

// Inversa de dateInputToISO: toma la fecha guardada (occurred_at) y la
// vuelve a un <input type="date"> usando el calendario local, por la misma
// razón (evitar que el día se corra por el desfasaje UTC/Argentina).
function isoToDateInput(iso: string) {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function currentMonthStart() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

// [inicio del mes, inicio del mes siguiente) — mismo patrón de rango
// exclusivo que usa Budgets.tsx para no engancharse un día del mes de al
// lado por corte de huso horario.
function monthRangeISO(monthStart: Date) {
  const start = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1)
  const end = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1)
  return { startISO: start.toISOString(), endISO: end.toISOString() }
}

function formatMonthLabel(monthStart: Date) {
  const label = monthStart.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function isSameMonth(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
}

export default function Transactions() {
  const { user } = useAuth()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [incomeSources, setIncomeSources] = useState<IncomeSource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [amountDigits, setAmountDigits] = useState('')
  const [occurredAt, setOccurredAt] = useState(todayDateInput)
  const [merchant, setMerchant] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [incomeSourceId, setIncomeSourceId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('')
  const [cardLast4, setCardLast4] = useState('')
  const [type, setType] = useState<TransactionType>('expense')
  const [saving, setSaving] = useState(false)
  const [scanning, setScanning] = useState(false)
  // Cantidad de transacciones nuevas insertadas en el último scan (null =
  // no se mostró el diálogo de resultado todavía, o ya se cerró).
  const [scanInsertedCount, setScanInsertedCount] = useState<number | null>(null)
  // Total acumulado mientras el scan sigue en tandas (ver handleScanGmail) —
  // se muestra en el modal de "Sincronizando..." para no dar la sensación de
  // que se colgó en un catch-up largo.
  const [scanProgress, setScanProgress] = useState<number | null>(null)
  const [amountError, setAmountError] = useState<string | null>(null)

  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState<PageSize>(20)
  // Mes que se está mostrando — cada cambio dispara load() de nuevo, que
  // trae de la base solo las transacciones de ese mes (no un fetch general
  // con límite fijo como antes).
  const [selectedMonth, setSelectedMonth] = useState(currentMonthStart)
  const [searchParams, setSearchParams] = useSearchParams()
  // Llega prellenado desde las tarjetas de presupuesto de Budgets.tsx (link
  // a /transactions?category=<id>) — se lee una sola vez al montar y después
  // se limpia de la URL para que no quede "pegado" si el usuario navega de
  // vuelta a esta pestaña por el menú.
  const [categoryFilterId, setCategoryFilterId] = useState(() => searchParams.get('category') ?? '')

  useEffect(() => {
    if (searchParams.has('category')) {
      setSearchParams((prev) => {
        prev.delete('category')
        return prev
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Acordeón del form en mobile (ver media query en index.css): en desktop
  // el form siempre está visible y este estado se ignora vía CSS.
  const [formOpen, setFormOpen] = useState(false)
  // Transacción de Gmail pendiente de confirmar borrado (ver handleDeleteTransaction).
  const [pendingDelete, setPendingDelete] = useState<Transaction | null>(null)

  // Transacción abierta en el modal de edición (ver openEdit/handleEditSubmit).
  const [editingTx, setEditingTx] = useState<Transaction | null>(null)
  const [editAmountDigits, setEditAmountDigits] = useState('')
  const [editOccurredAt, setEditOccurredAt] = useState('')
  const [editMerchant, setEditMerchant] = useState('')
  const [editCategoryId, setEditCategoryId] = useState('')
  const [editIncomeSourceId, setEditIncomeSourceId] = useState('')
  const [editPaymentMethod, setEditPaymentMethod] = useState<PaymentMethod | ''>('')
  const [editCardLast4, setEditCardLast4] = useState('')
  const [editType, setEditType] = useState<TransactionType>('expense')
  const [editSaving, setEditSaving] = useState(false)
  const [editAmountError, setEditAmountError] = useState<string | null>(null)

  const isCardPayment = paymentMethod === 'credit_card' || paymentMethod === 'debit_card'
  const isEditCardPayment = editPaymentMethod === 'credit_card' || editPaymentMethod === 'debit_card'

  async function load() {
    setLoading(true)
    const { startISO, endISO } = monthRangeISO(selectedMonth)
    const [{ data: tx, error: txError }, { data: cats }, { data: sources }] = await Promise.all([
      supabase
        .from('transactions')
        .select('*')
        .gte('occurred_at', startISO)
        .lt('occurred_at', endISO)
        .order('occurred_at', { ascending: false })
        .limit(FETCH_LIMIT),
      supabase.from('categories').select('*').order('name'),
      supabase.from('income_sources').select('*').order('name'),
    ])
    if (txError) setError(txError.message)
    setTransactions(tx ?? [])
    setCategories(cats ?? [])
    setIncomeSources(sources ?? [])
    setLoading(false)
    setPage(0)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth])

  // "Interno" son transferencias entre las propias cuentas del usuario (ver
  // handleInlineCategoryChange y el mismo criterio aplicado en
  // scanGmailForUser.ts) — no son ni ingreso ni gasto real, así que no
  // cuentan para ninguno de los totales.
  const totals = useMemo(() => {
    const relevant = transactions.filter((t) => {
      const cat = categories.find((c) => c.id === t.category_id)
      return cat?.name !== 'Interno'
    })
    const income = relevant.filter((t) => t.type === 'income').reduce((sum, t) => sum + t.amount, 0)
    const expenseARS = relevant
      .filter((t) => t.type === 'expense' && t.currency === 'ARS')
      .reduce((sum, t) => sum + t.amount, 0)
    const expenseUSD = relevant
      .filter((t) => t.type === 'expense' && t.currency === 'USD')
      .reduce((sum, t) => sum + t.amount, 0)
    return { income, expense: expenseARS, expenseUSD, net: income - expenseARS }
  }, [transactions, categories])

  const visibleTransactions = categoryFilterId
    ? transactions.filter((t) => t.category_id === categoryFilterId)
    : transactions

  const pageCount = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(visibleTransactions.length / pageSize))
  const pagedTransactions =
    pageSize === 'all' ? visibleTransactions : visibleTransactions.slice(page * pageSize, page * pageSize + pageSize)

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    setAmountError(null)
    if (!amountDigits) {
      setAmountError('Rellená este campo.')
      return
    }
    if (!user) return
    setSaving(true)
    const isIncome = type === 'income'
    const { error: insertError } = await supabase.from('transactions').insert({
      user_id: user.id,
      amount: centsToNumber(amountDigits),
      currency: 'ARS',
      merchant: isIncome ? null : merchant || null,
      category_id: isIncome ? null : categoryId || null,
      income_source_id: isIncome ? incomeSourceId || null : null,
      occurred_at: dateInputToISO(occurredAt),
      type,
      source: 'manual',
      needs_review: isIncome ? !incomeSourceId : !categoryId,
      payment_method: isIncome ? null : paymentMethod || null,
      card_last4: !isIncome && isCardPayment && cardLast4 ? cardLast4 : null,
    })
    setSaving(false)
    if (insertError) {
      setError(insertError.message)
      return
    }
    setAmountDigits('')
    setOccurredAt(todayDateInput())
    setMerchant('')
    setCategoryId('')
    setIncomeSourceId('')
    setPaymentMethod('')
    setCardLast4('')
    setType('expense')
    setFormOpen(false)
    load()
  }

  async function handleCreateCategory(name: string) {
    if (!user) return
    const { data, error: insertError } = await supabase
      .from('categories')
      .insert({ user_id: user.id, name, is_default: false })
      .select()
      .single()
    if (insertError || !data) {
      setError(insertError?.message ?? 'No se pudo crear la categoría')
      return
    }
    setCategories((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    setCategoryId(data.id)
  }

  async function handleCreateIncomeSource(name: string) {
    if (!user) return
    const { data, error: insertError } = await supabase
      .from('income_sources')
      .insert({ user_id: user.id, name })
      .select()
      .single()
    if (insertError || !data) {
      setError(insertError?.message ?? 'No se pudo crear la fuente de ingreso')
      return
    }
    setIncomeSources((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    setIncomeSourceId(data.id)
  }

  function handleDeleteFromEdit(t: Transaction) {
    setEditingTx(null)
    handleDeleteTransaction(t)
  }

  function handleDeleteTransaction(t: Transaction) {
    // El scan es incremental (last_scanned_at avanza en cada corrida
    // exitosa) — borrar esta fila no hace que el mail vuelva a entrar en
    // la ventana de escaneo, así que se pierde para siempre salvo que se
    // resetee la conexión a mano. Para manuales, borra directo sin avisar.
    if (t.source === 'gmail') {
      setPendingDelete(t)
      return
    }
    void deleteTransaction(t)
  }

  // Cambio de categoría directo desde la tabla, sin pasar por el modal de
  // edición — actualiza optimistamente el estado local en vez de recargar
  // todo (evita el parpadeo de la tabla por un cambio de un solo campo).
  async function handleInlineCategoryChange(t: Transaction, newCategoryId: string) {
    const { error: updateError } = await supabase
      .from('transactions')
      .update({ category_id: newCategoryId || null, needs_review: !newCategoryId })
      .eq('id', t.id)
    if (updateError) {
      setError(updateError.message)
      return
    }
    setTransactions((prev) =>
      prev.map((tx) =>
        tx.id === t.id ? { ...tx, category_id: newCategoryId || null, needs_review: !newCategoryId } : tx,
      ),
    )

    // Misma normalización que api/_lib/parseEmailTemplate.ts (trim +
    // mayúsculas + espacios colapsados) — una corrección manual acá
    // alimenta la misma caché comercio->categoría que usa el scan de Gmail,
    // así que el próximo mail de este comercio ya sale bien categorizado
    // sin gastar Gemini.
    if (t.merchant && newCategoryId && user) {
      const merchantKey = t.merchant.trim().toUpperCase().replace(/\s+/g, ' ')
      await supabase
        .from('merchant_categories')
        .upsert(
          { user_id: user.id, merchant_key: merchantKey, category_id: newCategoryId, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,merchant_key' },
        )
    }
  }

  async function deleteTransaction(t: Transaction) {
    const { error: deleteError } = await supabase.from('transactions').delete().eq('id', t.id)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    setTransactions((prev) => prev.filter((tx) => tx.id !== t.id))
  }

  function openEdit(t: Transaction) {
    setEditingTx(t)
    setEditAmountDigits(numberToCentsDigits(t.amount))
    setEditOccurredAt(isoToDateInput(t.occurred_at))
    setEditMerchant(t.merchant ?? '')
    setEditCategoryId(t.category_id ?? '')
    setEditIncomeSourceId(t.income_source_id ?? '')
    setEditPaymentMethod(t.payment_method ?? '')
    setEditCardLast4(t.card_last4 ?? '')
    setEditType(t.type)
    setEditAmountError(null)
  }

  async function handleEditSubmit(e: FormEvent) {
    e.preventDefault()
    setEditAmountError(null)
    if (!editAmountDigits) {
      setEditAmountError('Rellená este campo.')
      return
    }
    if (!editingTx) return
    setEditSaving(true)
    const isIncome = editType === 'income'
    const { error: updateError } = await supabase
      .from('transactions')
      .update({
        amount: centsToNumber(editAmountDigits),
        merchant: isIncome ? null : editMerchant || null,
        category_id: isIncome ? null : editCategoryId || null,
        income_source_id: isIncome ? editIncomeSourceId || null : null,
        occurred_at: dateInputToISO(editOccurredAt),
        type: editType,
        needs_review: isIncome ? !editIncomeSourceId : !editCategoryId,
        payment_method: isIncome ? null : editPaymentMethod || null,
        card_last4: !isIncome && isEditCardPayment && editCardLast4 ? editCardLast4 : null,
      })
      .eq('id', editingTx.id)
    setEditSaving(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    setEditingTx(null)
    load()
  }

  function goToPrevMonth() {
    setSelectedMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))
  }

  function goToNextMonth() {
    setSelectedMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))
  }

  async function handleScanGmail() {
    setScanning(true)
    setError(null)
    setScanProgress(0)
    let totalInserted = 0
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      // El backend procesa de a tandas chicas (ver BATCH_SIZE en
      // scanGmailForUser.ts) para no pasarse del timeout de la función ni
      // ráfagar la cuota de Gemini en un catch-up grande — acá repetimos la
      // llamada mientras el servidor diga que queda más por procesar en la
      // ventana actual.
      let hasMore = true
      let safety = 0
      while (hasMore && safety < 100) {
        safety += 1
        const res = await fetch('/api/gmail/scan', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'No se pudo escanear Gmail')
        totalInserted += json.result?.inserted ?? 0
        hasMore = json.result?.hasMore ?? false
        setScanProgress(totalInserted)
      }
      setScanInsertedCount(totalInserted)
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setScanning(false)
      setScanProgress(null)
    }
  }

  return (
    <div>
      <div className="tx-header">
        <h2>Transacciones</h2>
        <button type="button" className="gmail-scan-btn" onClick={handleScanGmail} disabled={scanning}>
          <IconRefresh /> {scanning ? 'Sincronizando...' : 'Sincronizar'}
        </button>
      </div>

      <div className="tx-summary">
        <div>
          <span>Ingresos</span>
          <strong className="tx-amount income">{formatCurrency(totals.income, 'ARS')}</strong>
        </div>
        <div>
          <span>Egresos</span>
          <strong className="tx-amount">
            {formatCurrency(totals.expense, 'ARS')}
            {totals.expenseUSD > 0 &&
              ` + USD ${totals.expenseUSD.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </strong>
        </div>
        <div className="tx-summary-net">
          <span>Neto</span>
          <strong className={`tx-amount ${totals.net < 0 ? 'negative' : ''}`}>
            {formatCurrency(totals.net, 'ARS')}
          </strong>
        </div>
      </div>

      <button
        type="button"
        className={`tx-form-toggle${formOpen ? ' open' : ''}`}
        onClick={() => setFormOpen((o) => !o)}
        aria-expanded={formOpen}
      >
        <IconPlus size={14} /> Nueva transacción
        <IconChevronDown size={16} />
      </button>

      <form className={`tx-form${formOpen ? ' open' : ''}`} onSubmit={handleAdd} noValidate>
        <div className="type-toggle" role="group" aria-label="Tipo de movimiento">
          <button type="button" className={type === 'expense' ? 'active' : ''} onClick={() => setType('expense')}>
            Egreso
          </button>
          <button
            type="button"
            className={type === 'income' ? 'active income' : ''}
            onClick={() => setType('income')}
          >
            Ingreso
          </button>
        </div>
        <DateField value={occurredAt} onChange={setOccurredAt} />
        <div className="tx-field">
          <input
            type="text"
            inputMode="numeric"
            className="amount-input"
            placeholder="Monto"
            value={formatAmountDigits(amountDigits)}
            onChange={(e) => {
              setAmountDigits(e.target.value.replace(/\D/g, '').slice(0, 12))
              if (amountError) setAmountError(null)
            }}
          />
          {amountError && <span className="field-error">{amountError}</span>}
        </div>
        {type === 'income' ? (
          <Select
            value={incomeSourceId}
            onChange={setIncomeSourceId}
            placeholder="Fuente de ingreso"
            options={incomeSources.map((s) => ({ value: s.id, label: s.name }))}
            onCreate={handleCreateIncomeSource}
            createLabel="Agregar fuente"
          />
        ) : (
          <>
            <input
              type="text"
              placeholder="Comercio"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
            />
            <Select
              value={categoryId}
              onChange={setCategoryId}
              placeholder="Sin categoría"
              options={categories.map((c) => ({ value: c.id, label: c.name, icon: getCategoryIcon(c.name, c.icon) }))}
            />
            <Select
              value={paymentMethod}
              onChange={(v) => setPaymentMethod(v as PaymentMethod | '')}
              placeholder="Medio de pago"
              options={(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((pm) => ({
                value: pm,
                label: PAYMENT_METHOD_LABELS[pm],
              }))}
            />
            {isCardPayment && (
              <input
                type="text"
                placeholder="Últimos 4 dígitos"
                maxLength={4}
                pattern="[0-9]{4}"
                value={cardLast4}
                onChange={(e) => setCardLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
              />
            )}
          </>
        )}
        <button type="submit" disabled={saving}>
          {saving ? (
            'Guardando...'
          ) : (
            <>
              <IconPlus /> Agregar
            </>
          )}
        </button>
      </form>

      <div className="tx-controls">
        <div className="tx-month-nav">
          <button type="button" aria-label="Mes anterior" onClick={goToPrevMonth}>
            ‹
          </button>
          <span>{formatMonthLabel(selectedMonth)}</span>
          <button
            type="button"
            aria-label="Mes siguiente"
            disabled={isSameMonth(selectedMonth, currentMonthStart())}
            onClick={goToNextMonth}
          >
            ›
          </button>
        </div>
        <div className="tx-controls-right">
          <span className="tx-counter">Transacciones: {visibleTransactions.length}</span>
          <Select
            value={categoryFilterId}
            onChange={(v) => {
              setCategoryFilterId(v)
              setPage(0)
            }}
            placeholder="Todas las categorías"
            options={categories.map((c) => ({ value: c.id, label: c.name, icon: getCategoryIcon(c.name, c.icon) }))}
          />
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {loading ? (
        <p>Cargando...</p>
      ) : transactions.length === 0 ? (
        <p className="empty-state">
          Todavía no hay transacciones. Se van a cargar automáticamente cuando
          conectemos el escaneo de Gmail, o podés agregarlas a mano arriba.
        </p>
      ) : (
        <>
          <div className="tx-table-scroll">
          <table className="tx-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Comercio</th>
                <th>Categoría</th>
                <th>Medio de pago</th>
                <th className="tx-amount-header">Monto</th>
              </tr>
            </thead>
            <tbody>
              {pagedTransactions.map((t) => {
                const source = incomeSources.find((s) => s.id === t.income_source_id)
                return (
                  <tr key={t.id} onDoubleClick={() => openEdit(t)}>
                    <td>{new Date(t.occurred_at).toLocaleDateString('es-AR')}</td>
                    <td className="tx-merchant">
                      {t.needs_review && <span className="review-dot" title="Necesita revisión" />}
                      {t.merchant ?? source?.name ?? '—'}
                    </td>
                    <td className="tx-category">
                      {t.type === 'income' ? (
                        '—'
                      ) : (
                        <Select
                          value={t.category_id ?? ''}
                          onChange={(v) => handleInlineCategoryChange(t, v)}
                          placeholder="Sin categoría"
                          options={categories.map((c) => ({
                            value: c.id,
                            label: c.name,
                            icon: getCategoryIcon(c.name, c.icon),
                          }))}
                        />
                      )}
                    </td>
                    <td className="tx-payment-method">
                      <PaymentMethodCell t={t} />
                    </td>
                    <td className={`tx-amount ${t.type === 'income' ? 'income' : ''}`}>
                      {t.type === 'expense' ? '-' : '+'}
                      {formatCurrency(t.amount, t.currency)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>

          <div className="tx-pagination">
            <div className="tx-pagination-size">
              <span>Mostrar</span>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <button
                  key={size}
                  type="button"
                  className={pageSize === size ? 'active' : ''}
                  onClick={() => {
                    setPageSize(size)
                    setPage(0)
                  }}
                >
                  {size === 'all' ? 'Todo' : size}
                </button>
              ))}
            </div>
            {pageSize !== 'all' && (
              <div className="tx-pagination-nav">
                <button type="button" aria-label="Página anterior" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                  ‹
                </button>
                <span>
                  Página {page + 1} de {pageCount}
                </span>
                <button
                  type="button"
                  aria-label="Página siguiente"
                  disabled={page >= pageCount - 1}
                  onClick={() => setPage((p) => p + 1)}
                >
                  ›
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {editingTx && (
        <Modal>
          <h3>Editar transacción</h3>
          <form className="tx-edit-form" onSubmit={handleEditSubmit} noValidate>
            <DateField value={editOccurredAt} onChange={setEditOccurredAt} />
            <div className="tx-field">
              <input
                type="text"
                inputMode="numeric"
                className="amount-input"
                placeholder="Monto"
                value={formatAmountDigits(editAmountDigits)}
                onChange={(e) => {
                  setEditAmountDigits(e.target.value.replace(/\D/g, '').slice(0, 12))
                  if (editAmountError) setEditAmountError(null)
                }}
              />
              {editAmountError && <span className="field-error">{editAmountError}</span>}
            </div>
            {editType === 'income' ? (
              <Select
                value={editIncomeSourceId}
                onChange={setEditIncomeSourceId}
                placeholder="Fuente de ingreso"
                options={incomeSources.map((s) => ({ value: s.id, label: s.name }))}
                onCreate={handleCreateIncomeSource}
                createLabel="Agregar fuente"
              />
            ) : (
              <>
                <input
                  type="text"
                  placeholder="Comercio"
                  value={editMerchant}
                  onChange={(e) => setEditMerchant(e.target.value)}
                />
                <Select
                  value={editCategoryId}
                  onChange={setEditCategoryId}
                  placeholder="Sin categoría"
                  options={categories.map((c) => ({ value: c.id, label: c.name, icon: getCategoryIcon(c.name, c.icon) }))}
                  onCreate={handleCreateCategory}
                  createLabel="Agregar categoría"
                />
                <Select
                  value={editPaymentMethod}
                  onChange={(v) => setEditPaymentMethod(v as PaymentMethod | '')}
                  placeholder="Medio de pago"
                  options={(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((pm) => ({
                    value: pm,
                    label: PAYMENT_METHOD_LABELS[pm],
                  }))}
                />
                {isEditCardPayment && (
                  <input
                    type="text"
                    placeholder="Últimos 4 dígitos"
                    maxLength={4}
                    pattern="[0-9]{4}"
                    value={editCardLast4}
                    onChange={(e) => setEditCardLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  />
                )}
              </>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="danger modal-actions-start"
                onClick={() => handleDeleteFromEdit(editingTx)}
              >
                <IconX size={14} /> Eliminar transacción
              </button>
              <button type="button" onClick={() => setEditingTx(null)}>
                Cancelar
              </button>
              <button type="submit" className="primary" disabled={editSaving}>
                {editSaving ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {pendingDelete && (
        <Modal>
          <h3>Eliminar transacción de Gmail</h3>
          <p>
            Esta transacción vino de un mail de Gmail. Si la eliminás, no se va a volver a sincronizar sola — el
            escaneo no vuelve a mirar mails ya procesados.
          </p>
          <div className="modal-actions">
            <button type="button" onClick={() => setPendingDelete(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => {
                const t = pendingDelete
                setPendingDelete(null)
                void deleteTransaction(t)
              }}
            >
              Eliminar
            </button>
          </div>
        </Modal>
      )}

      {scanning && (
        <Modal>
          <div className="modal-panel-sync">
            <IconRefresh size={28} />
            <p>
              Sincronizando con Gmail...
              {!!scanProgress && <><br />{scanProgress} nuevas hasta ahora</>}
            </p>
          </div>
        </Modal>
      )}

      {scanInsertedCount !== null && (
        <Modal>
          <h3>Sincronización completa</h3>
          <p>
            {scanInsertedCount === 0
              ? 'No se encontraron transacciones nuevas.'
              : scanInsertedCount === 1
                ? 'Se encontró 1 transacción nueva.'
                : `Se encontraron ${scanInsertedCount} transacciones nuevas.`}
          </p>
          <div className="modal-actions">
            <button type="button" className="primary" onClick={() => setScanInsertedCount(null)}>
              Cerrar
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
