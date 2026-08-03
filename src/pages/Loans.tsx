import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import type { Loan, LoanPayment } from '../types/database'
import { IconChevronDown, IconPlus } from '../components/icons'
import Modal from '../components/Modal'
import DateField from '../components/DateField'

function formatMoney(amount: number) {
  return amount.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function todayDateInput() {
  return new Date().toISOString().slice(0, 10)
}

// Mismo motivo que en Transactions.tsx/Budgets.tsx/Investments.tsx: armar
// la fecha con año/mes/día sueltos usa medianoche local, evitando que se
// corra un día.
function formatDateShort(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-AR')
}

export default function Loans() {
  const { user } = useAuth()
  const [loans, setLoans] = useState<Loan[]>([])
  const [payments, setPayments] = useState<LoanPayment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [formOpen, setFormOpen] = useState(false)
  const [bank, setBank] = useState('')
  const [amountRequested, setAmountRequested] = useState('')
  const [amountToRepay, setAmountToRepay] = useState('')
  const [installmentsCount, setInstallmentsCount] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [expandedLoanId, setExpandedLoanId] = useState<string | null>(null)

  const [payLoan, setPayLoan] = useState<Loan | null>(null)
  const [payDate, setPayDate] = useState(todayDateInput())
  const [payAmount, setPayAmount] = useState('')
  const [paySaving, setPaySaving] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)

  async function load() {
    if (!user) return
    setLoading(true)
    setError(null)

    const [{ data: loansData, error: loansError }, { data: paymentsData, error: paymentsError }] = await Promise.all([
      supabase.from('loans').select('*').order('created_at', { ascending: false }),
      supabase.from('loan_payments').select('*').order('payment_date', { ascending: true }),
    ])

    if (loansError || paymentsError) {
      setError(loansError?.message ?? paymentsError?.message ?? 'Error al cargar préstamos')
      setLoading(false)
      return
    }

    setLoans(loansData ?? [])
    setPayments(paymentsData ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const paymentsByLoan = useMemo(() => {
    const map = new Map<string, LoanPayment[]>()
    for (const p of payments) {
      const list = map.get(p.loan_id)
      if (list) list.push(p)
      else map.set(p.loan_id, [p])
    }
    return map
  }, [payments])

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    setFormError(null)

    const trimmedBank = bank.trim()
    const requestedNum = Number(amountRequested)
    const repayNum = Number(amountToRepay)
    const installmentsNum = Number(installmentsCount)

    if (!trimmedBank) {
      setFormError('Ingresá el banco.')
      return
    }
    if (!(requestedNum > 0)) {
      setFormError('El monto solicitado tiene que ser mayor a 0.')
      return
    }
    if (!(repayNum > 0)) {
      setFormError('El monto a devolver tiene que ser mayor a 0.')
      return
    }
    if (!(installmentsNum > 0) || !Number.isInteger(installmentsNum)) {
      setFormError('La cantidad de cuotas tiene que ser un entero mayor a 0.')
      return
    }

    setSaving(true)
    const { error: insertError } = await supabase.from('loans').insert({
      user_id: user.id,
      bank: trimmedBank,
      amount_requested: requestedNum,
      amount_to_repay: repayNum,
      installments_count: installmentsNum,
    })
    setSaving(false)

    if (insertError) {
      setFormError(insertError.message)
      return
    }

    setBank('')
    setAmountRequested('')
    setAmountToRepay('')
    setInstallmentsCount('')
    setFormOpen(false)
    load()
  }

  function toggleExpand(loanId: string) {
    setExpandedLoanId((current) => (current === loanId ? null : loanId))
  }

  function openPay(loan: Loan) {
    setPayLoan(loan)
    setPayDate(todayDateInput())
    setPayAmount('')
    setPayError(null)
  }

  async function handlePaySubmit(e: FormEvent) {
    e.preventDefault()
    if (!user || !payLoan) return
    setPayError(null)

    const amountNum = Number(payAmount)
    if (!payDate) {
      setPayError('Ingresá una fecha.')
      return
    }
    if (!(amountNum > 0)) {
      setPayError('El monto tiene que ser mayor a 0.')
      return
    }

    setPaySaving(true)
    const { error: insertError } = await supabase.from('loan_payments').insert({
      user_id: user.id,
      loan_id: payLoan.id,
      payment_date: payDate,
      amount: amountNum,
    })
    setPaySaving(false)

    if (insertError) {
      setPayError(insertError.message)
      return
    }

    setPayLoan(null)
    load()
  }

  return (
    <div>
      <div className="tx-header">
        <h2>Préstamos</h2>
      </div>

      {error && <p className="error">{error}</p>}

      <button
        type="button"
        className={`tx-form-toggle${formOpen ? ' open' : ''}`}
        onClick={() => setFormOpen((o) => !o)}
        aria-expanded={formOpen}
      >
        <IconPlus size={14} /> Agregar préstamo
        <IconChevronDown size={16} />
      </button>

      <form className={`tx-form${formOpen ? ' open' : ''}`} onSubmit={handleAdd} noValidate>
        <input type="text" placeholder="Banco" value={bank} onChange={(e) => setBank(e.target.value)} />
        <input
          type="number"
          step="0.01"
          min="0"
          placeholder="Monto solicitado"
          value={amountRequested}
          onChange={(e) => setAmountRequested(e.target.value)}
        />
        <input
          type="number"
          step="0.01"
          min="0"
          placeholder="Monto a devolver"
          value={amountToRepay}
          onChange={(e) => setAmountToRepay(e.target.value)}
        />
        <input
          type="number"
          step="1"
          min="1"
          placeholder="Cantidad de cuotas"
          value={installmentsCount}
          onChange={(e) => setInstallmentsCount(e.target.value)}
        />
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
      {formError && <p className="error">{formError}</p>}

      {loading ? (
        <p>Cargando...</p>
      ) : loans.length === 0 ? (
        <p className="empty-state">Todavía no cargaste préstamos.</p>
      ) : (
        <div className="loan-list">
          {loans.map((loan) => {
            const loanPayments = paymentsByLoan.get(loan.id) ?? []
            const paidAmount = loanPayments.reduce((sum, p) => sum + p.amount, 0)
            const progressPct = Math.min(100, (paidAmount / loan.amount_to_repay) * 100)
            const isFinished = paidAmount >= loan.amount_to_repay
            const expanded = expandedLoanId === loan.id

            return (
              <div
                key={loan.id}
                className={`loan-card${expanded ? ' expanded' : ''}`}
                onClick={() => toggleExpand(loan.id)}
                role="button"
                tabIndex={0}
                aria-expanded={expanded}
              >
                <div className="loan-card-header">
                  <span className="loan-card-bank">
                    {loan.bank}
                    {isFinished && <span className="loan-badge-done">Finalizado</span>}
                  </span>
                  <button
                    type="button"
                    className="gmail-scan-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      openPay(loan)
                    }}
                  >
                    Registrar pago
                  </button>
                </div>
                <div className="loan-card-amounts">
                  <span>
                    Solicitado: <strong>{formatMoney(loan.amount_requested)}</strong>
                  </span>
                  <span>
                    A devolver: <strong>{formatMoney(loan.amount_to_repay)}</strong>
                  </span>
                </div>
                <div className="loan-progress-row">
                  <div className="loan-progress">
                    <div className="loan-progress-fill" style={{ width: `${progressPct}%` }} />
                  </div>
                  <span className="loan-progress-total">{loan.installments_count}</span>
                </div>
                {expanded && (
                  <div className="tx-table-scroll" onClick={(e) => e.stopPropagation()}>
                    {loanPayments.length === 0 ? (
                      <p className="empty-state">Todavía no hay cuotas pagadas.</p>
                    ) : (
                      <table className="tx-table">
                        <thead>
                          <tr>
                            <th>Cuota</th>
                            <th>Fecha</th>
                            <th className="tx-amount-header">Monto</th>
                          </tr>
                        </thead>
                        <tbody>
                          {loanPayments.map((p, i) => (
                            <tr key={p.id}>
                              <td>{i + 1}</td>
                              <td>{formatDateShort(p.payment_date)}</td>
                              <td className="tx-amount">{formatMoney(p.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {payLoan && (
        <Modal>
          <h3>Registrar pago — {payLoan.bank}</h3>
          <form className="budget-form" onSubmit={handlePaySubmit} noValidate>
            <DateField value={payDate} onChange={setPayDate} />
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="Monto"
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
            />
            {payError && <p className="error">{payError}</p>}
            <div className="modal-actions">
              <button type="button" onClick={() => setPayLoan(null)}>
                Cancelar
              </button>
              <button type="submit" className="primary" disabled={paySaving}>
                {paySaving ? 'Guardando...' : 'Registrar'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
