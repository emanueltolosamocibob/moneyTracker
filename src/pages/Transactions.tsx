import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import type { Category, PaymentMethod, Transaction, TransactionType } from '../types/database'
import { IconPlus } from '../components/icons'
import Select from '../components/Select'
import { getCategoryIcon } from '../lib/categoryIcons'

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  credit_card: 'Crédito',
  debit_card: 'Débito',
  transfer: 'Transferencia',
  cash: 'Efectivo',
  other: 'Otro',
}

function formatPaymentMethod(t: Transaction) {
  if (!t.payment_method) return '—'
  const label = PAYMENT_METHOD_LABELS[t.payment_method]
  const isCard = t.payment_method === 'credit_card' || t.payment_method === 'debit_card'
  return isCard && t.card_last4 ? `${label} •• ${t.card_last4}` : label
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [amountDigits, setAmountDigits] = useState('')
  const [merchant, setMerchant] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('')
  const [cardLast4, setCardLast4] = useState('')
  const [type, setType] = useState<TransactionType>('expense')
  const [saving, setSaving] = useState(false)

  const isCardPayment = paymentMethod === 'credit_card' || paymentMethod === 'debit_card'

  async function load() {
    setLoading(true)
    const [{ data: tx, error: txError }, { data: cats }] = await Promise.all([
      supabase.from('transactions').select('*').order('occurred_at', { ascending: false }).limit(100),
      supabase.from('categories').select('*').order('name'),
    ])
    if (txError) setError(txError.message)
    setTransactions(tx ?? [])
    setCategories(cats ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const totals = useMemo(() => {
    const income = transactions.filter((t) => t.type === 'income').reduce((sum, t) => sum + t.amount, 0)
    const expense = transactions.filter((t) => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0)
    return { income, expense, net: income - expense }
  }, [transactions])

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (!user || !amountDigits) return
    setSaving(true)
    const { error: insertError } = await supabase.from('transactions').insert({
      user_id: user.id,
      amount: centsToNumber(amountDigits),
      currency: 'ARS',
      merchant: merchant || null,
      category_id: categoryId || null,
      occurred_at: new Date().toISOString(),
      type,
      source: 'manual',
      needs_review: !categoryId,
      payment_method: paymentMethod || null,
      card_last4: isCardPayment && cardLast4 ? cardLast4 : null,
    })
    setSaving(false)
    if (insertError) {
      setError(insertError.message)
      return
    }
    setAmountDigits('')
    setMerchant('')
    setCategoryId('')
    setPaymentMethod('')
    setCardLast4('')
    setType('expense')
    load()
  }

  return (
    <div>
      <h2>Transacciones</h2>

      <form className="tx-form" onSubmit={handleAdd}>
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
        <input
          type="text"
          inputMode="numeric"
          className="amount-input"
          placeholder="Monto"
          value={formatAmountDigits(amountDigits)}
          onChange={(e) => setAmountDigits(e.target.value.replace(/\D/g, '').slice(0, 12))}
          required
        />
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
          <table className="tx-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Comercio</th>
                <th>Categoría</th>
                <th>Medio de pago</th>
                <th>Monto</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => {
                const cat = categories.find((c) => c.id === t.category_id)
                return (
                  <tr key={t.id}>
                    <td>{new Date(t.occurred_at).toLocaleDateString('es-AR')}</td>
                    <td>
                      {t.needs_review && <span className="review-dot" title="Necesita revisión" />}
                      {t.merchant ?? '—'}
                    </td>
                    <td className="tx-category">
                      {cat ? (
                        <>
                          {getCategoryIcon(cat.name)} {cat.name}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="tx-payment-method">{formatPaymentMethod(t)}</td>
                    <td className={`tx-amount ${t.type === 'income' ? 'income' : ''}`}>
                      {t.type === 'expense' ? '-' : '+'}
                      {formatCurrency(t.amount, t.currency)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <div className="tx-summary">
            <div>
              <span>Ingresos</span>
              <strong className="tx-amount income">{formatCurrency(totals.income, 'ARS')}</strong>
            </div>
            <div>
              <span>Egresos</span>
              <strong className="tx-amount">{formatCurrency(totals.expense, 'ARS')}</strong>
            </div>
            <div>
              <span>Neto</span>
              <strong className={`tx-amount ${totals.net >= 0 ? 'income' : ''}`}>
                {formatCurrency(totals.net, 'ARS')}
              </strong>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
