import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import type { Category, IncomeSource, PaymentMethod, Transaction, TransactionType } from '../types/database'
import { IconPlus, IconRefresh, IconX } from '../components/icons'
import Select from '../components/Select'
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

export default function Transactions() {
  const { user } = useAuth()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [incomeSources, setIncomeSources] = useState<IncomeSource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [amountDigits, setAmountDigits] = useState('')
  const [merchant, setMerchant] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [incomeSourceId, setIncomeSourceId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('')
  const [cardLast4, setCardLast4] = useState('')
  const [type, setType] = useState<TransactionType>('expense')
  const [saving, setSaving] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [amountError, setAmountError] = useState<string | null>(null)

  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState<PageSize>(20)

  const isCardPayment = paymentMethod === 'credit_card' || paymentMethod === 'debit_card'

  async function load() {
    setLoading(true)
    const [{ data: tx, error: txError }, { data: cats }, { data: sources }] = await Promise.all([
      supabase.from('transactions').select('*').order('occurred_at', { ascending: false }).limit(FETCH_LIMIT),
      supabase.from('categories').select('*').order('name'),
      supabase.from('income_sources').select('*').order('name'),
    ])
    if (txError) setError(txError.message)
    setTransactions(tx ?? [])
    setCategories(cats ?? [])
    setIncomeSources(sources ?? [])
    setLoading(false)
    setPage(0)

    // "Nueva" solo se muestra la primera vez: una vez que ya la renderizamos
    // acá, la marcamos vista para que no vuelva a aparecer en la próxima carga.
    const unseenIds = (tx ?? []).filter((t) => !t.seen).map((t) => t.id)
    if (unseenIds.length > 0) {
      supabase.from('transactions').update({ seen: true }).in('id', unseenIds)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const totals = useMemo(() => {
    const income = transactions.filter((t) => t.type === 'income').reduce((sum, t) => sum + t.amount, 0)
    const expense = transactions.filter((t) => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0)
    return { income, expense, net: income - expense }
  }, [transactions])

  const pageCount = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(transactions.length / pageSize))
  const pagedTransactions =
    pageSize === 'all' ? transactions : transactions.slice(page * pageSize, page * pageSize + pageSize)

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
      occurred_at: new Date().toISOString(),
      type,
      source: 'manual',
      needs_review: isIncome ? !incomeSourceId : !categoryId,
      payment_method: isIncome ? null : paymentMethod || null,
      card_last4: !isIncome && isCardPayment && cardLast4 ? cardLast4 : null,
      // El usuario la acaba de tipear: no es "nueva" a los ojos del indicador
      // naranja, que es solo para lo que trae el escaneo de Gmail.
      seen: true,
    })
    setSaving(false)
    if (insertError) {
      setError(insertError.message)
      return
    }
    setAmountDigits('')
    setMerchant('')
    setCategoryId('')
    setIncomeSourceId('')
    setPaymentMethod('')
    setCardLast4('')
    setType('expense')
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

  async function handleDeleteTransaction(id: string) {
    const { error: deleteError } = await supabase.from('transactions').delete().eq('id', id)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    setTransactions((prev) => prev.filter((t) => t.id !== id))
  }

  async function handleScanGmail() {
    setScanning(true)
    setError(null)
    try {
      const { data } = await supabase.auth.getSession()
      const res = await fetch('/api/gmail/scan', {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.session?.access_token}` },
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'No se pudo escanear Gmail')
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setScanning(false)
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

      <form className="tx-form" onSubmit={handleAdd} noValidate>
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
              options={categories.map((c) => ({ value: c.id, label: c.name, icon: getCategoryIcon(c.name) }))}
              onCreate={handleCreateCategory}
              createLabel="Agregar categoría"
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
                <th>Monto</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pagedTransactions.map((t) => {
                const cat = categories.find((c) => c.id === t.category_id)
                const source = incomeSources.find((s) => s.id === t.income_source_id)
                return (
                  <tr key={t.id}>
                    <td>
                      {!t.seen && (
                        <span className="new-badge" title="Nueva">
                          !
                        </span>
                      )}
                      {new Date(t.occurred_at).toLocaleDateString('es-AR')}
                    </td>
                    <td className="tx-merchant">
                      {t.needs_review && <span className="review-dot" title="Necesita revisión" />}
                      {t.merchant ?? source?.name ?? '—'}
                    </td>
                    <td className="tx-category">
                      {cat ? (
                        <span className="tx-category-inner">
                          {getCategoryIcon(cat.name)} {cat.name}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="tx-payment-method">
                      <PaymentMethodCell t={t} />
                    </td>
                    <td className={`tx-amount ${t.type === 'income' ? 'income' : ''}`}>
                      {t.type === 'expense' ? '-' : '+'}
                      {formatCurrency(t.amount, t.currency)}
                    </td>
                    <td className="tx-actions">
                      <button
                        type="button"
                        className="tx-delete-btn"
                        aria-label="Eliminar transacción"
                        onClick={() => handleDeleteTransaction(t.id)}
                      >
                        <IconX size={14} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>

          <div className="tx-summary">
            <div>
              <span>Ingresos</span>
              <strong className="tx-amount income">{formatCurrency(totals.income, 'ARS')}</strong>
            </div>
            <div>
              <span>Egresos</span>
              <strong className="tx-amount">{formatCurrency(totals.expense, 'ARS')}</strong>
            </div>
            <div className="tx-summary-net">
              <span>Neto</span>
              <strong className={`tx-amount ${totals.net < 0 ? 'negative' : ''}`}>
                {formatCurrency(totals.net, 'ARS')}
              </strong>
            </div>
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
    </div>
  )
}
