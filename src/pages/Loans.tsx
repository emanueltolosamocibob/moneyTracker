import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import type { Bank, Category, Loan, LoanCurrency, LoanPayment } from '../types/database'
import { IconChevronDown, IconPencil, IconPlus } from '../components/icons'
import Modal from '../components/Modal'
import DateField from '../components/DateField'
import Select from '../components/Select'

function formatMoney(amount: number) {
  return amount.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// UVA no es una moneda ISO, así que no entra en Intl.NumberFormat con
// style:'currency' como el resto de los montos de la app — se arma el
// sufijo a mano.
function formatUva(amount: number) {
  return `${amount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} UVA`
}

function formatLoanAmount(amount: number, currency: LoanCurrency) {
  return currency === 'UVA' ? formatUva(amount) : formatMoney(amount)
}

// Máscara de monto tipo "POS", igual que en Transactions.tsx/Budgets.tsx: el
// usuario solo tipea dígitos, los últimos dos son siempre los centavos.
// Solo aplica a montos en pesos — un préstamo en UVA usa un input de
// cantidad común (ver sanitizeDecimalInput), porque UVA no tiene "centavos".
function centsToNumber(digits: string) {
  return Number(digits || '0') / 100
}

function formatAmountDigits(digits: string) {
  if (!digits) return ''
  return formatMoney(centsToNumber(digits))
}

function numberToCentsDigits(amount: number) {
  return Math.round(amount * 100).toString()
}

// Para cantidades de UVA: solo dígitos y un único punto decimal, sin
// máscara de centavos (a diferencia de un monto en pesos, acá el usuario
// tipea el número tal cual, ej. "1234.56").
function sanitizeDecimalInput(raw: string) {
  const cleaned = raw.replace(/[^\d.]/g, '')
  const firstDot = cleaned.indexOf('.')
  if (firstDot === -1) return cleaned
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
}

// Valor de la UVA (en pesos) para una fecha puntual — ver api/uva/value.ts.
// Se usa al registrar el pago de una cuota en UVA, para guardar junto con
// el pago cuánto valía la UVA ese día y poder mostrar su equivalente en
// pesos después.
async function fetchUvaValue(date: string): Promise<number> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  const res = await fetch(`/api/uva/value?date=${date}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error ?? 'No se pudo obtener el valor de la UVA.')
  return json.value as number
}

function todayDateInput() {
  return new Date().toISOString().slice(0, 10)
}

// Mismo motivo que dateInputToISO en Transactions.tsx: arma la fecha con
// año/mes/día sueltos (medianoche local) en vez de parsear el string
// directo, para que no se corra un día por el desfasaje UTC/Argentina.
function dateInputToISO(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toISOString()
}

// Nombre fijo de la categoría bajo la que se registran los egresos de
// cuotas de préstamo (ver handlePaySubmit) — una sola por usuario, creada
// la primera vez que hace falta.
const LOAN_PAYMENT_CATEGORY_NAME = 'Préstamos'

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
  const [banks, setBanks] = useState<Bank[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [formOpen, setFormOpen] = useState(false)
  const [bankId, setBankId] = useState('')
  const [currency, setCurrency] = useState<LoanCurrency>('ARS')
  const [amountRequestedDigits, setAmountRequestedDigits] = useState('')
  const [amountToRepayDigits, setAmountToRepayDigits] = useState('')
  // Cantidad de UVAs cuando currency='UVA' — inputs separados de los de
  // arriba porque la UI es distinta (número común, no máscara de centavos).
  const [amountRequestedUva, setAmountRequestedUva] = useState('')
  const [amountToRepayUva, setAmountToRepayUva] = useState('')
  const [installmentsCount, setInstallmentsCount] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [expandedLoanId, setExpandedLoanId] = useState<string | null>(null)

  const [payLoan, setPayLoan] = useState<Loan | null>(null)
  const [payDate, setPayDate] = useState(todayDateInput())
  const [payAmountDigits, setPayAmountDigits] = useState('')
  const [payAmountUva, setPayAmountUva] = useState('')
  const [paySaving, setPaySaving] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)

  const [editLoan, setEditLoan] = useState<Loan | null>(null)
  const [editBankId, setEditBankId] = useState('')
  const [editCurrency, setEditCurrency] = useState<LoanCurrency>('ARS')
  const [editAmountRequestedDigits, setEditAmountRequestedDigits] = useState('')
  const [editAmountToRepayDigits, setEditAmountToRepayDigits] = useState('')
  const [editAmountRequestedUva, setEditAmountRequestedUva] = useState('')
  const [editAmountToRepayUva, setEditAmountToRepayUva] = useState('')
  const [editInstallmentsCount, setEditInstallmentsCount] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const [pendingDeleteLoan, setPendingDeleteLoan] = useState<Loan | null>(null)
  const [deletingLoan, setDeletingLoan] = useState(false)

  // Cuota (loan_payment) en edición — se abre con doble click sobre su fila
  // en la tabla de cuotas del desplegable de la tarjeta (mismo gesto que
  // Transactions.tsx usa para abrir el editor de una transacción). No hay
  // confirmación al borrar una cuota, mismo criterio que el resto de los
  // registros manuales de la app (solo las transacciones de Gmail piden
  // confirmar, por lo del re-scan que no las trae de vuelta).
  const [editingPayment, setEditingPayment] = useState<LoanPayment | null>(null)
  const [editPaymentDate, setEditPaymentDate] = useState('')
  const [editPaymentAmountDigits, setEditPaymentAmountDigits] = useState('')
  const [editPaymentAmountUva, setEditPaymentAmountUva] = useState('')
  const [editPaymentSaving, setEditPaymentSaving] = useState(false)
  const [editPaymentError, setEditPaymentError] = useState<string | null>(null)

  async function load() {
    if (!user) return
    setLoading(true)
    setError(null)

    const [
      { data: loansData, error: loansError },
      { data: paymentsData, error: paymentsError },
      { data: banksData, error: banksError },
      { data: categoriesData, error: categoriesError },
    ] = await Promise.all([
      supabase.from('loans').select('*').order('created_at', { ascending: false }),
      supabase.from('loan_payments').select('*').order('payment_date', { ascending: true }),
      supabase.from('banks').select('*').order('name'),
      supabase.from('categories').select('*').order('name'),
    ])

    if (loansError || paymentsError || banksError || categoriesError) {
      setError(
        loansError?.message ?? paymentsError?.message ?? banksError?.message ?? categoriesError?.message ?? 'Error al cargar préstamos',
      )
      setLoading(false)
      return
    }

    setLoans(loansData ?? [])
    setPayments(paymentsData ?? [])
    setBanks(banksData ?? [])
    setCategories(categoriesData ?? [])
    setLoading(false)
  }

  // Busca la categoría "Préstamos" del usuario, o la crea si es la primera
  // vez que se registra un pago (ver handlePaySubmit) — mismo patrón que
  // handleCreateBank de acá abajo, pero disparado automáticamente en vez de
  // por una acción explícita del usuario en el form.
  async function getOrCreateLoanCategory(): Promise<string> {
    const existing = categories.find((c) => c.name === LOAN_PAYMENT_CATEGORY_NAME)
    if (existing) return existing.id

    const { data, error: insertError } = await supabase
      .from('categories')
      .insert({ user_id: user!.id, name: LOAN_PAYMENT_CATEGORY_NAME, icon: 'bank', is_default: false })
      .select()
      .single()
    if (insertError || !data) throw new Error(insertError?.message ?? 'No se pudo crear la categoría "Préstamos".')

    setCategories((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    return data.id
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

  const bankById = useMemo(() => new Map(banks.map((b) => [b.id, b])), [banks])

  const loanById = useMemo(() => new Map(loans.map((l) => [l.id, l])), [loans])
  // Moneda del préstamo dueño de la cuota en edición — la cuota en sí no
  // guarda su moneda (la hereda del préstamo).
  const editingPaymentCurrency: LoanCurrency = (editingPayment && loanById.get(editingPayment.loan_id)?.currency) || 'ARS'

  async function handleCreateBank(name: string) {
    if (!user) return
    const { data, error: insertError } = await supabase.from('banks').insert({ user_id: user.id, name }).select().single()
    if (insertError || !data) {
      setFormError(insertError?.message ?? 'No se pudo crear el banco')
      return
    }
    setBanks((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    setBankId(data.id)
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    setFormError(null)

    const requestedNum = currency === 'UVA' ? Number(amountRequestedUva || '0') : centsToNumber(amountRequestedDigits)
    const repayNum = currency === 'UVA' ? Number(amountToRepayUva || '0') : centsToNumber(amountToRepayDigits)
    const installmentsNum = Number(installmentsCount)

    if (!bankId) {
      setFormError('Elegí un banco.')
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
      bank_id: bankId,
      currency,
      amount_requested: requestedNum,
      amount_to_repay: repayNum,
      installments_count: installmentsNum,
    })
    setSaving(false)

    if (insertError) {
      setFormError(insertError.message)
      return
    }

    setBankId('')
    setCurrency('ARS')
    setAmountRequestedDigits('')
    setAmountToRepayDigits('')
    setAmountRequestedUva('')
    setAmountToRepayUva('')
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
    setPayAmountDigits('')
    setPayAmountUva('')
    setPayError(null)
  }

  async function handlePaySubmit(e: FormEvent) {
    e.preventDefault()
    if (!user || !payLoan) return
    setPayError(null)

    const amountNum = payLoan.currency === 'UVA' ? Number(payAmountUva || '0') : centsToNumber(payAmountDigits)
    if (!payDate) {
      setPayError('Ingresá una fecha.')
      return
    }
    if (!(amountNum > 0)) {
      setPayError('El monto tiene que ser mayor a 0.')
      return
    }

    setPaySaving(true)

    // Para un préstamo en UVA, el pago se registra en cantidad de UVAs pero
    // se guarda también el valor de la UVA ese día — así la conversión a
    // pesos de esa cuota queda fija (no recalculada con el valor de hoy
    // cada vez que se muestra).
    let uvaValue: number | null = null
    if (payLoan.currency === 'UVA') {
      try {
        uvaValue = await fetchUvaValue(payDate)
      } catch (err) {
        setPaySaving(false)
        setPayError((err as Error).message)
        return
      }
    }

    const { error: insertError } = await supabase.from('loan_payments').insert({
      user_id: user.id,
      loan_id: payLoan.id,
      payment_date: payDate,
      amount: amountNum,
      uva_value: uvaValue,
    })

    if (insertError) {
      setPaySaving(false)
      setPayError(insertError.message)
      return
    }

    // Cada cuota pagada también se registra como un egreso en Transacciones
    // — no hay columna que linkee transactions con loan_payments, así que
    // esto es solo al crear (editar/borrar una cuota no toca la transacción
    // que generó, quedarían desincronizadas).
    const installmentNumber = (paymentsByLoan.get(payLoan.id)?.length ?? 0) + 1
    const bankName = (payLoan.bank_id && bankById.get(payLoan.bank_id)?.name) || 'Sin banco'
    // El monto del egreso siempre va en pesos: para un préstamo en UVA,
    // amountNum es cantidad de UVAs, así que hay que convertirlo con el
    // valor de la UVA del día (uvaValue), igual que paidAmountArs más abajo.
    const amountArs = payLoan.currency === 'UVA' ? amountNum * (uvaValue ?? 0) : amountNum

    try {
      const categoryId = await getOrCreateLoanCategory()
      const { error: txError } = await supabase.from('transactions').insert({
        user_id: user.id,
        amount: amountArs,
        currency: 'ARS',
        merchant: `Cuota préstamo nro. ${installmentNumber} - ${bankName}`,
        category_id: categoryId,
        occurred_at: dateInputToISO(payDate),
        type: 'expense',
        source: 'manual',
        needs_review: false,
        payment_method: 'transfer',
      })
      if (txError) throw new Error(txError.message)
    } catch (err) {
      setPaySaving(false)
      setPayError((err as Error).message)
      return
    }

    setPaySaving(false)
    setPayLoan(null)
    load()
  }

  function openEditLoan(loan: Loan) {
    setEditLoan(loan)
    setEditBankId(loan.bank_id ?? '')
    setEditCurrency(loan.currency)
    setEditAmountRequestedDigits(loan.currency === 'ARS' ? numberToCentsDigits(loan.amount_requested) : '')
    setEditAmountToRepayDigits(loan.currency === 'ARS' ? numberToCentsDigits(loan.amount_to_repay) : '')
    setEditAmountRequestedUva(loan.currency === 'UVA' ? String(loan.amount_requested) : '')
    setEditAmountToRepayUva(loan.currency === 'UVA' ? String(loan.amount_to_repay) : '')
    setEditError(null)
  }

  async function handleEditLoanSubmit(e: FormEvent) {
    e.preventDefault()
    if (!editLoan) return
    setEditError(null)

    const requestedNum =
      editCurrency === 'UVA' ? Number(editAmountRequestedUva || '0') : centsToNumber(editAmountRequestedDigits)
    const repayNum = editCurrency === 'UVA' ? Number(editAmountToRepayUva || '0') : centsToNumber(editAmountToRepayDigits)
    const installmentsNum = Number(editInstallmentsCount)

    if (!editBankId) {
      setEditError('Elegí un banco.')
      return
    }
    if (!(requestedNum > 0)) {
      setEditError('El monto solicitado tiene que ser mayor a 0.')
      return
    }
    if (!(repayNum > 0)) {
      setEditError('El monto a devolver tiene que ser mayor a 0.')
      return
    }
    if (!(installmentsNum > 0) || !Number.isInteger(installmentsNum)) {
      setEditError('La cantidad de cuotas tiene que ser un entero mayor a 0.')
      return
    }

    setEditSaving(true)
    const { error: updateError } = await supabase
      .from('loans')
      .update({
        bank_id: editBankId,
        currency: editCurrency,
        amount_requested: requestedNum,
        amount_to_repay: repayNum,
        installments_count: installmentsNum,
      })
      .eq('id', editLoan.id)
    setEditSaving(false)

    if (updateError) {
      setEditError(updateError.message)
      return
    }

    setEditLoan(null)
    load()
  }

  function handleDeleteLoanClick() {
    if (!editLoan) return
    setPendingDeleteLoan(editLoan)
    setEditLoan(null)
  }

  async function handleConfirmDeleteLoan() {
    if (!pendingDeleteLoan) return
    setDeletingLoan(true)
    const { error: deleteError } = await supabase.from('loans').delete().eq('id', pendingDeleteLoan.id)
    setDeletingLoan(false)

    if (deleteError) {
      setError(deleteError.message)
      return
    }

    setPendingDeleteLoan(null)
    load()
  }

  function openEditPayment(p: LoanPayment) {
    const paymentCurrency = loanById.get(p.loan_id)?.currency ?? 'ARS'
    setEditingPayment(p)
    setEditPaymentDate(p.payment_date)
    setEditPaymentAmountDigits(paymentCurrency === 'ARS' ? numberToCentsDigits(p.amount) : '')
    setEditPaymentAmountUva(paymentCurrency === 'UVA' ? String(p.amount) : '')
    setEditPaymentError(null)
  }

  async function handleEditPaymentSubmit(e: FormEvent) {
    e.preventDefault()
    if (!editingPayment) return
    setEditPaymentError(null)

    const amountNum =
      editingPaymentCurrency === 'UVA' ? Number(editPaymentAmountUva || '0') : centsToNumber(editPaymentAmountDigits)
    if (!editPaymentDate) {
      setEditPaymentError('Ingresá una fecha.')
      return
    }
    if (!(amountNum > 0)) {
      setEditPaymentError('El monto tiene que ser mayor a 0.')
      return
    }

    setEditPaymentSaving(true)

    // Misma lógica que al registrar el pago: si la fecha cambió, el valor
    // de la UVA guardado también tiene que actualizarse para esa fecha.
    let uvaValue: number | null = null
    if (editingPaymentCurrency === 'UVA') {
      try {
        uvaValue = await fetchUvaValue(editPaymentDate)
      } catch (err) {
        setEditPaymentSaving(false)
        setEditPaymentError((err as Error).message)
        return
      }
    }

    const { error: updateError } = await supabase
      .from('loan_payments')
      .update({ payment_date: editPaymentDate, amount: amountNum, uva_value: uvaValue })
      .eq('id', editingPayment.id)
    setEditPaymentSaving(false)

    if (updateError) {
      setEditPaymentError(updateError.message)
      return
    }

    setEditingPayment(null)
    load()
  }

  async function handleDeletePayment(p: LoanPayment) {
    const { error: deleteError } = await supabase.from('loan_payments').delete().eq('id', p.id)
    if (deleteError) {
      setEditPaymentError(deleteError.message)
      return
    }
    setEditingPayment(null)
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
        <Select
          value={bankId}
          onChange={setBankId}
          placeholder="Banco"
          options={banks.map((b) => ({ value: b.id, label: b.name }))}
          onCreate={handleCreateBank}
          createLabel="Agregar banco"
        />
        <div className="type-toggle" role="group" aria-label="Moneda">
          <button type="button" className={currency === 'ARS' ? 'active' : ''} onClick={() => setCurrency('ARS')}>
            ARS
          </button>
          <button type="button" className={currency === 'UVA' ? 'active' : ''} onClick={() => setCurrency('UVA')}>
            UVA
          </button>
        </div>
        {currency === 'ARS' ? (
          <>
            <input
              type="text"
              inputMode="numeric"
              className="amount-input"
              placeholder="Monto solicitado"
              value={formatAmountDigits(amountRequestedDigits)}
              onChange={(e) => setAmountRequestedDigits(e.target.value.replace(/\D/g, '').slice(0, 12))}
            />
            <input
              type="text"
              inputMode="numeric"
              className="amount-input"
              placeholder="Monto a devolver"
              value={formatAmountDigits(amountToRepayDigits)}
              onChange={(e) => setAmountToRepayDigits(e.target.value.replace(/\D/g, '').slice(0, 12))}
            />
          </>
        ) : (
          <>
            <input
              type="text"
              inputMode="decimal"
              className="amount-input"
              placeholder="Cantidad de UVAs solicitadas"
              value={amountRequestedUva}
              onChange={(e) => setAmountRequestedUva(sanitizeDecimalInput(e.target.value))}
            />
            <input
              type="text"
              inputMode="decimal"
              className="amount-input"
              placeholder="Cantidad de UVAs a devolver"
              value={amountToRepayUva}
              onChange={(e) => setAmountToRepayUva(sanitizeDecimalInput(e.target.value))}
            />
          </>
        )}
        <input
          type="number"
          step="1"
          min="1"
          placeholder="Cuotas"
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
            // Suma en la moneda nativa del préstamo (UVA o ARS) — es lo que
            // hay que comparar contra amount_to_repay para el progreso, ya
            // que ambos están en la misma unidad.
            const paidAmount = loanPayments.reduce((sum, p) => sum + p.amount, 0)
            // Equivalente en pesos de lo pagado hasta ahora, solo relevante
            // para préstamos en UVA: cada cuota se convierte con SU propio
            // valor de UVA del día (no el de hoy), por eso es una suma de
            // pagos individuales y no paidAmount * valor actual.
            const paidAmountArs = loanPayments.reduce((sum, p) => sum + p.amount * (p.uva_value ?? 0), 0)
            const progressPct = Math.min(100, (paidAmount / loan.amount_to_repay) * 100)
            const isFinished = paidAmount >= loan.amount_to_repay
            const expanded = expandedLoanId === loan.id
            const bankName = (loan.bank_id && bankById.get(loan.bank_id)?.name) || 'Sin banco'

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
                    {bankName}
                    {isFinished && <span className="loan-badge-done">Finalizado</span>}
                  </span>
                  <span className="loan-card-actions">
                    {!isFinished && (
                      <button
                        type="button"
                        className="gmail-scan-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          openPay(loan)
                        }}
                      >
                        <IconPlus size={14} /> Registrar pago
                      </button>
                    )}
                    <button
                      type="button"
                      className="gmail-scan-btn"
                      aria-label={`Editar préstamo ${bankName}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        openEditLoan(loan)
                      }}
                    >
                      <IconPencil size={14} /> Editar
                    </button>
                  </span>
                </div>
                <div className="loan-card-amounts">
                  <span>
                    Solicitado: <strong>{formatLoanAmount(loan.amount_requested, loan.currency)}</strong>
                  </span>
                  <span>
                    Interés:{' '}
                    <strong>{formatLoanAmount(loan.amount_to_repay - loan.amount_requested, loan.currency)}</strong>
                  </span>
                </div>
                <strong className="loan-card-paid">
                  {formatLoanAmount(paidAmount, loan.currency)} / {formatLoanAmount(loan.amount_to_repay, loan.currency)}
                  {loan.currency === 'UVA' && paidAmount > 0 && (
                    <span className="loan-card-paid-ars"> (≈ {formatMoney(paidAmountArs)})</span>
                  )}
                </strong>
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
                            <tr
                              key={p.id}
                              onDoubleClick={(e) => {
                                e.stopPropagation()
                                openEditPayment(p)
                              }}
                            >
                              <td>{i + 1}</td>
                              <td>{formatDateShort(p.payment_date)}</td>
                              <td className="tx-amount">
                                {formatLoanAmount(p.amount, loan.currency)}
                                {loan.currency === 'UVA' && p.uva_value != null && (
                                  <span className="loan-card-paid-ars"> ({formatMoney(p.amount * p.uva_value)})</span>
                                )}
                              </td>
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
          <h3>Registrar pago — {(payLoan.bank_id && bankById.get(payLoan.bank_id)?.name) || 'Sin banco'}</h3>
          <form className="budget-form" onSubmit={handlePaySubmit} noValidate>
            <DateField value={payDate} onChange={setPayDate} />
            {payLoan.currency === 'ARS' ? (
              <input
                type="text"
                inputMode="numeric"
                className="amount-input"
                placeholder="Monto"
                value={formatAmountDigits(payAmountDigits)}
                onChange={(e) => setPayAmountDigits(e.target.value.replace(/\D/g, '').slice(0, 12))}
              />
            ) : (
              <input
                type="text"
                inputMode="decimal"
                className="amount-input"
                placeholder="Cantidad de UVAs"
                value={payAmountUva}
                onChange={(e) => setPayAmountUva(sanitizeDecimalInput(e.target.value))}
              />
            )}
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

      {editLoan && (
        <Modal>
          <h3>Editar préstamo</h3>
          <form className="budget-form" onSubmit={handleEditLoanSubmit} noValidate>
            <Select
              value={editBankId}
              onChange={setEditBankId}
              placeholder="Banco"
              options={banks.map((b) => ({ value: b.id, label: b.name }))}
              onCreate={handleCreateBank}
              createLabel="Agregar banco"
            />
            <div className="type-toggle" role="group" aria-label="Moneda">
              <button type="button" className={editCurrency === 'ARS' ? 'active' : ''} onClick={() => setEditCurrency('ARS')}>
                ARS
              </button>
              <button type="button" className={editCurrency === 'UVA' ? 'active' : ''} onClick={() => setEditCurrency('UVA')}>
                UVA
              </button>
            </div>
            {editCurrency === 'ARS' ? (
              <>
                <input
                  type="text"
                  inputMode="numeric"
                  className="amount-input"
                  placeholder="Monto solicitado"
                  value={formatAmountDigits(editAmountRequestedDigits)}
                  onChange={(e) => setEditAmountRequestedDigits(e.target.value.replace(/\D/g, '').slice(0, 12))}
                />
                <input
                  type="text"
                  inputMode="numeric"
                  className="amount-input"
                  placeholder="Monto a devolver"
                  value={formatAmountDigits(editAmountToRepayDigits)}
                  onChange={(e) => setEditAmountToRepayDigits(e.target.value.replace(/\D/g, '').slice(0, 12))}
                />
              </>
            ) : (
              <>
                <input
                  type="text"
                  inputMode="decimal"
                  className="amount-input"
                  placeholder="Cantidad de UVAs solicitadas"
                  value={editAmountRequestedUva}
                  onChange={(e) => setEditAmountRequestedUva(sanitizeDecimalInput(e.target.value))}
                />
                <input
                  type="text"
                  inputMode="decimal"
                  className="amount-input"
                  placeholder="Cantidad de UVAs a devolver"
                  value={editAmountToRepayUva}
                  onChange={(e) => setEditAmountToRepayUva(sanitizeDecimalInput(e.target.value))}
                />
              </>
            )}
            <input
              type="number"
              step="1"
              min="1"
              placeholder="Cuotas"
              value={editInstallmentsCount}
              onChange={(e) => setEditInstallmentsCount(e.target.value)}
            />
            {editError && <p className="error">{editError}</p>}
            <div className="modal-actions">
              <button type="button" className="danger modal-actions-start" onClick={handleDeleteLoanClick}>
                Eliminar préstamo
              </button>
              <button type="button" onClick={() => setEditLoan(null)}>
                Cancelar
              </button>
              <button type="submit" className="primary" disabled={editSaving}>
                {editSaving ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {editingPayment && (
        <Modal>
          <h3>Editar cuota</h3>
          <form className="budget-form" onSubmit={handleEditPaymentSubmit} noValidate>
            <DateField value={editPaymentDate} onChange={setEditPaymentDate} />
            {editingPaymentCurrency === 'ARS' ? (
              <input
                type="text"
                inputMode="numeric"
                className="amount-input"
                placeholder="Monto"
                value={formatAmountDigits(editPaymentAmountDigits)}
                onChange={(e) => setEditPaymentAmountDigits(e.target.value.replace(/\D/g, '').slice(0, 12))}
              />
            ) : (
              <input
                type="text"
                inputMode="decimal"
                className="amount-input"
                placeholder="Cantidad de UVAs"
                value={editPaymentAmountUva}
                onChange={(e) => setEditPaymentAmountUva(sanitizeDecimalInput(e.target.value))}
              />
            )}
            {editPaymentError && <p className="error">{editPaymentError}</p>}
            <div className="modal-actions">
              <button
                type="button"
                className="danger modal-actions-start"
                onClick={() => handleDeletePayment(editingPayment)}
              >
                Eliminar cuota
              </button>
              <button type="button" onClick={() => setEditingPayment(null)}>
                Cancelar
              </button>
              <button type="submit" className="primary" disabled={editPaymentSaving}>
                {editPaymentSaving ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {pendingDeleteLoan && (
        <Modal>
          <h3>Eliminar préstamo</h3>
          <p>
            Se va a eliminar el préstamo de &quot;
            {(pendingDeleteLoan.bank_id && bankById.get(pendingDeleteLoan.bank_id)?.name) || 'Sin banco'}&quot; junto con
            todas sus cuotas registradas. Esta acción no se puede deshacer.
          </p>
          <div className="modal-actions">
            <button type="button" onClick={() => setPendingDeleteLoan(null)}>
              Cancelar
            </button>
            <button type="button" className="danger" disabled={deletingLoan} onClick={handleConfirmDeleteLoan}>
              {deletingLoan ? 'Eliminando...' : 'Eliminar'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
