import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import type { Category, Transaction } from '../types/database'

export default function Transactions() {
  const { user } = useAuth()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [amount, setAmount] = useState('')
  const [merchant, setMerchant] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [saving, setSaving] = useState(false)

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

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (!user || !amount) return
    setSaving(true)
    const { error: insertError } = await supabase.from('transactions').insert({
      user_id: user.id,
      amount: Number(amount),
      currency: 'ARS',
      merchant: merchant || null,
      category_id: categoryId || null,
      occurred_at: new Date().toISOString(),
      type: 'expense',
      source: 'manual',
      needs_review: !categoryId,
    })
    setSaving(false)
    if (insertError) {
      setError(insertError.message)
      return
    }
    setAmount('')
    setMerchant('')
    setCategoryId('')
    load()
  }

  return (
    <div>
      <h2>Transacciones</h2>

      <form className="tx-form" onSubmit={handleAdd}>
        <input
          type="number"
          step="0.01"
          placeholder="Monto"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
        <input
          type="text"
          placeholder="Comercio"
          value={merchant}
          onChange={(e) => setMerchant(e.target.value)}
        />
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Sin categoría</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button type="submit" disabled={saving}>
          {saving ? 'Guardando...' : 'Agregar'}
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
        <table className="tx-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Comercio</th>
              <th>Categoría</th>
              <th>Origen</th>
              <th>Monto</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((t) => {
              const cat = categories.find((c) => c.id === t.category_id)
              return (
                <tr key={t.id} className={t.needs_review ? 'needs-review' : ''}>
                  <td>{new Date(t.occurred_at).toLocaleDateString('es-AR')}</td>
                  <td>{t.merchant ?? '—'}</td>
                  <td>{cat?.name ?? (t.needs_review ? 'Sin revisar' : '—')}</td>
                  <td>{t.source === 'gmail' ? 'Gmail' : 'Manual'}</td>
                  <td>
                    {t.type === 'expense' ? '-' : '+'}
                    {t.amount.toLocaleString('es-AR', { style: 'currency', currency: t.currency })}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
