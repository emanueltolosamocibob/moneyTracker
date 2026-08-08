import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import type { Goal, GoalContribution } from '../types/database'
import { IconChevronDown, IconPlus, IconStar, IconStarOff } from '../components/icons'
import Modal from '../components/Modal'
import DateField from '../components/DateField'

function formatMoney(amount: number) {
  return amount.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Máscara de monto tipo "POS", igual que en Loans.tsx/Transactions.tsx: el
// usuario solo tipea dígitos, los últimos dos son siempre los centavos.
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

function todayDateInput() {
  return new Date().toISOString().slice(0, 10)
}

// Mismo motivo que en Loans.tsx/Transactions.tsx: arma la fecha con
// año/mes/día sueltos (medianoche local) en vez de parsear el string
// directo, para que no se corra un día por el desfasaje UTC/Argentina.
function formatDateShort(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-AR')
}

// Días de calendario entre hoy y una fecha 'YYYY-MM-DD' (negativo si ya
// pasó) — se arma con año/mes/día sueltos por el mismo motivo de arriba.
function daysUntil(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const target = new Date(y, m - 1, d)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

// Radio/circunferencia del anillo de progreso — ver el <svg> del render.
const RING_RADIUS = 52
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

export default function Goals() {
  const { user } = useAuth()
  const [goals, setGoals] = useState<Goal[]>([])
  const [contributions, setContributions] = useState<GoalContribution[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [formOpen, setFormOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [targetAmountDigits, setTargetAmountDigits] = useState('')
  const [targetDate, setTargetDate] = useState(todayDateInput())
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [expandedGoalId, setExpandedGoalId] = useState<string | null>(null)

  const [contributeGoal, setContributeGoal] = useState<Goal | null>(null)
  const [contributeDate, setContributeDate] = useState(todayDateInput())
  const [contributeAmountDigits, setContributeAmountDigits] = useState('')
  const [contributeSaving, setContributeSaving] = useState(false)
  const [contributeError, setContributeError] = useState<string | null>(null)

  const [editGoal, setEditGoal] = useState<Goal | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editTargetAmountDigits, setEditTargetAmountDigits] = useState('')
  const [editTargetDate, setEditTargetDate] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const [pendingDeleteGoal, setPendingDeleteGoal] = useState<Goal | null>(null)
  const [deletingGoal, setDeletingGoal] = useState(false)

  // Aporte en edición — se abre con doble click sobre su fila en la tabla
  // desplegable de la tarjeta, mismo gesto que Loans.tsx usa para una cuota.
  const [editingContribution, setEditingContribution] = useState<GoalContribution | null>(null)
  const [editContributionDate, setEditContributionDate] = useState('')
  const [editContributionAmountDigits, setEditContributionAmountDigits] = useState('')
  const [editContributionSaving, setEditContributionSaving] = useState(false)
  const [editContributionError, setEditContributionError] = useState<string | null>(null)

  async function load() {
    if (!user) return
    setLoading(true)
    setError(null)

    const [
      { data: goalsData, error: goalsError },
      { data: contributionsData, error: contributionsError },
    ] = await Promise.all([
      supabase.from('goals').select('*').order('created_at', { ascending: false }),
      supabase.from('goal_contributions').select('*').order('contribution_date', { ascending: true }),
    ])

    if (goalsError || contributionsError) {
      setError(goalsError?.message ?? contributionsError?.message ?? 'Error al cargar objetivos')
      setLoading(false)
      return
    }

    setGoals(goalsData ?? [])
    setContributions(contributionsData ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const contributionsByGoal = useMemo(() => {
    const map = new Map<string, GoalContribution[]>()
    for (const c of contributions) {
      const list = map.get(c.goal_id)
      if (list) list.push(c)
      else map.set(c.goal_id, [c])
    }
    return map
  }, [contributions])

  const goalsWithProgress = useMemo(() => {
    return goals.map((goal) => {
      const goalContributions = contributionsByGoal.get(goal.id) ?? []
      const saved = goalContributions.reduce((sum, c) => sum + c.amount, 0)
      const pct = Math.min(100, (saved / goal.target_amount) * 100)
      const completed = saved >= goal.target_amount
      return { goal, saved, pct, completed }
    })
  }, [goals, contributionsByGoal])

  // Orden pedido: el objetivo activo primero, después el resto de los no
  // cumplidos por % de completado (los más cerca de la meta arriba), y los
  // cumplidos (estilo dorado) al final — sin importar si uno de ellos había
  // quedado marcado como activo, un objetivo cumplido sale de esa carrera.
  const sortedGoals = useMemo(() => {
    const active = goalsWithProgress.filter((g) => g.goal.is_active && !g.completed)
    const rest = goalsWithProgress.filter((g) => !g.goal.is_active && !g.completed).sort((a, b) => b.pct - a.pct)
    const done = goalsWithProgress
      .filter((g) => g.completed)
      .sort((a, b) => new Date(b.goal.created_at).getTime() - new Date(a.goal.created_at).getTime())
    return [...active, ...rest, ...done]
  }, [goalsWithProgress])

  function toggleExpand(goalId: string) {
    setExpandedGoalId((current) => (current === goalId ? null : goalId))
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    setFormError(null)

    const amountNum = centsToNumber(targetAmountDigits)

    if (!title.trim()) {
      setFormError('Ingresá un título.')
      return
    }
    if (!(amountNum > 0)) {
      setFormError('El monto objetivo tiene que ser mayor a 0.')
      return
    }
    if (!targetDate) {
      setFormError('Ingresá una fecha estimada.')
      return
    }

    setSaving(true)
    const { error: insertError } = await supabase.from('goals').insert({
      user_id: user.id,
      title: title.trim(),
      target_amount: amountNum,
      target_date: targetDate,
    })
    setSaving(false)

    if (insertError) {
      setFormError(insertError.message)
      return
    }

    setTitle('')
    setTargetAmountDigits('')
    setTargetDate(todayDateInput())
    setFormOpen(false)
    load()
  }

  // Marca `goal` como el único objetivo principal, desmarcando el anterior
  // si había uno — dos updates secuenciales en vez de uno solo porque el
  // índice único parcial (goals_one_active_per_user, ver migración 0021)
  // no permite dos filas is_active=true al mismo tiempo aunque sea por un
  // instante dentro de la misma transacción implícita del cliente.
  async function setActiveGoal(goal: Goal) {
    if (!user) return
    await supabase.from('goals').update({ is_active: false }).eq('user_id', user.id).eq('is_active', true)
    const { error: updateError } = await supabase.from('goals').update({ is_active: true }).eq('id', goal.id)
    if (updateError) {
      setError(updateError.message)
      return
    }
    load()
  }

  // Botón estrella arriba a la derecha de la tarjeta: si ya es el principal
  // lo desmarca directo (sin necesidad de elegir otro), si no lo pasa a
  // principal desplazando al anterior.
  async function toggleActiveGoal(goal: Goal) {
    if (goal.is_active) {
      const { error: updateError } = await supabase.from('goals').update({ is_active: false }).eq('id', goal.id)
      if (updateError) {
        setError(updateError.message)
        return
      }
      load()
      return
    }
    await setActiveGoal(goal)
  }

  function openContribute(goal: Goal) {
    setContributeGoal(goal)
    setContributeDate(todayDateInput())
    setContributeAmountDigits('')
    setContributeError(null)
  }

  async function handleContributeSubmit(e: FormEvent) {
    e.preventDefault()
    if (!user || !contributeGoal) return
    setContributeError(null)

    const amountNum = centsToNumber(contributeAmountDigits)
    if (!contributeDate) {
      setContributeError('Ingresá una fecha.')
      return
    }
    if (!(amountNum > 0)) {
      setContributeError('El monto tiene que ser mayor a 0.')
      return
    }

    setContributeSaving(true)
    const { error: insertError } = await supabase.from('goal_contributions').insert({
      user_id: user.id,
      goal_id: contributeGoal.id,
      contribution_date: contributeDate,
      amount: amountNum,
    })
    setContributeSaving(false)

    if (insertError) {
      setContributeError(insertError.message)
      return
    }

    setContributeGoal(null)
    load()
  }

  function openEditGoal(goal: Goal) {
    setEditGoal(goal)
    setEditTitle(goal.title)
    setEditTargetAmountDigits(numberToCentsDigits(goal.target_amount))
    setEditTargetDate(goal.target_date)
    setEditError(null)
  }

  async function handleEditGoalSubmit(e: FormEvent) {
    e.preventDefault()
    if (!user || !editGoal) return
    setEditError(null)

    const amountNum = centsToNumber(editTargetAmountDigits)

    if (!editTitle.trim()) {
      setEditError('Ingresá un título.')
      return
    }
    if (!(amountNum > 0)) {
      setEditError('El monto objetivo tiene que ser mayor a 0.')
      return
    }
    if (!editTargetDate) {
      setEditError('Ingresá una fecha estimada.')
      return
    }

    setEditSaving(true)
    const { error: updateError } = await supabase
      .from('goals')
      .update({
        title: editTitle.trim(),
        target_amount: amountNum,
        target_date: editTargetDate,
      })
      .eq('id', editGoal.id)
    setEditSaving(false)

    if (updateError) {
      setEditError(updateError.message)
      return
    }

    setEditGoal(null)
    load()
  }

  function handleDeleteGoalClick() {
    if (!editGoal) return
    setPendingDeleteGoal(editGoal)
    setEditGoal(null)
  }

  async function handleConfirmDeleteGoal() {
    if (!pendingDeleteGoal) return
    setDeletingGoal(true)
    const { error: deleteError } = await supabase.from('goals').delete().eq('id', pendingDeleteGoal.id)
    setDeletingGoal(false)

    if (deleteError) {
      setError(deleteError.message)
      return
    }

    setPendingDeleteGoal(null)
    load()
  }

  function openEditContribution(c: GoalContribution) {
    setEditingContribution(c)
    setEditContributionDate(c.contribution_date)
    setEditContributionAmountDigits(numberToCentsDigits(c.amount))
    setEditContributionError(null)
  }

  async function handleEditContributionSubmit(e: FormEvent) {
    e.preventDefault()
    if (!editingContribution) return
    setEditContributionError(null)

    const amountNum = centsToNumber(editContributionAmountDigits)
    if (!editContributionDate) {
      setEditContributionError('Ingresá una fecha.')
      return
    }
    if (!(amountNum > 0)) {
      setEditContributionError('El monto tiene que ser mayor a 0.')
      return
    }

    setEditContributionSaving(true)
    const { error: updateError } = await supabase
      .from('goal_contributions')
      .update({ contribution_date: editContributionDate, amount: amountNum })
      .eq('id', editingContribution.id)
    setEditContributionSaving(false)

    if (updateError) {
      setEditContributionError(updateError.message)
      return
    }

    setEditingContribution(null)
    load()
  }

  async function handleDeleteContribution(c: GoalContribution) {
    const { error: deleteError } = await supabase.from('goal_contributions').delete().eq('id', c.id)
    if (deleteError) {
      setEditContributionError(deleteError.message)
      return
    }
    setEditingContribution(null)
    load()
  }

  return (
    <div>
      <div className="tx-header">
        <h2>Objetivos</h2>
      </div>

      {error && <p className="error">{error}</p>}

      <button
        type="button"
        className={`tx-form-toggle${formOpen ? ' open' : ''}`}
        onClick={() => setFormOpen((o) => !o)}
        aria-expanded={formOpen}
      >
        <IconPlus size={14} /> Agregar objetivo
        <IconChevronDown size={16} />
      </button>

      <form className={`tx-form${formOpen ? ' open' : ''}`} onSubmit={handleAdd} noValidate>
        <input type="text" placeholder="Título" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input
          type="text"
          inputMode="numeric"
          className="amount-input"
          placeholder="Monto objetivo"
          value={formatAmountDigits(targetAmountDigits)}
          onChange={(e) => setTargetAmountDigits(e.target.value.replace(/\D/g, '').slice(0, 12))}
        />
        <DateField value={targetDate} onChange={setTargetDate} />
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
      ) : sortedGoals.length === 0 ? (
        <div className="goal-grid">
          <button type="button" className="goal-card goal-card-empty" onClick={() => setFormOpen(true)}>
            <IconPlus size={22} />
            <span>Crear tu primer objetivo</span>
          </button>
        </div>
      ) : (
        <div className="goal-grid">
          {sortedGoals.map(({ goal, saved, pct, completed }) => {
            const goalContributions = contributionsByGoal.get(goal.id) ?? []
            const expanded = expandedGoalId === goal.id
            const remaining = Math.max(0, goal.target_amount - saved)
            const days = daysUntil(goal.target_date)
            // Vencido: pasó la fecha estimada y todavía no se cumplió (ver
            // pedido explícito de mostrar "faltan $X" en vez de una cuota
            // sugerida negativa o dividida por 0 meses).
            const overdue = !completed && days < 0
            const monthsLeft = overdue ? 0 : Math.max(1, Math.ceil(days / 30))
            const suggestedMonthly = remaining / monthsLeft
            const dashoffset = RING_CIRCUMFERENCE * (1 - pct / 100)

            return (
              <div
                key={goal.id}
                className={`goal-card${completed ? ' completed' : ''}${expanded ? ' expanded' : ''}`}
                onClick={() => toggleExpand(goal.id)}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  openEditGoal(goal)
                }}
                role="button"
                tabIndex={0}
                aria-expanded={expanded}
              >
                <div className="goal-card-top">
                  <span className="goal-card-tags">
                    {!completed && <span className="goal-tag-date">{formatDateShort(goal.target_date)}</span>}
                    {goal.is_active && !completed && <span className="goal-badge-active">Principal</span>}
                    {completed && <span className="goal-badge-done">🎉 Cumplido</span>}
                  </span>
                  {!completed && (
                    <span className="goal-card-top-actions">
                      <button
                        type="button"
                        className="goal-icon-btn"
                        aria-label={
                          goal.is_active ? `Desmarcar ${goal.title} como principal` : `Marcar ${goal.title} como principal`
                        }
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleActiveGoal(goal)
                        }}
                      >
                        {goal.is_active ? <IconStarOff size={16} /> : <IconStar size={16} />}
                      </button>
                      <button
                        type="button"
                        className="goal-icon-btn"
                        aria-label={`Agregar aporte a ${goal.title}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          openContribute(goal)
                        }}
                      >
                        <IconPlus size={16} />
                      </button>
                    </span>
                  )}
                </div>

                <div className="goal-ring-wrap">
                  <svg className="goal-ring" viewBox="0 0 120 120">
                    <circle className="goal-ring-track" cx="60" cy="60" r={RING_RADIUS} />
                    <circle
                      className="goal-ring-fill"
                      cx="60"
                      cy="60"
                      r={RING_RADIUS}
                      strokeDasharray={RING_CIRCUMFERENCE}
                      strokeDashoffset={dashoffset}
                    />
                  </svg>
                  <div className="goal-ring-content">
                    <span className="goal-ring-title">{goal.title}</span>
                    <span className="goal-ring-pct">{Math.round(pct)}%</span>
                  </div>
                </div>

                <div className="goal-amounts">
                  <span>
                    Objetivo: <strong>{formatMoney(goal.target_amount)}</strong>
                  </span>
                  <span>
                    Ahorrado: <strong>{formatMoney(saved)}</strong>
                  </span>
                </div>

                <p className={`goal-suggested${overdue ? ' overdue' : ''}`}>
                  {completed
                    ? `Cumplido el objetivo antes del ${formatDateShort(goal.target_date)}.`
                    : overdue
                      ? `Venció el ${formatDateShort(goal.target_date)} — faltan ${formatMoney(remaining)}.`
                      : `Sugerido: ${formatMoney(suggestedMonthly)}/mes para llegar el ${formatDateShort(goal.target_date)}.`}
                </p>


                {expanded && (
                  <div className="tx-table-scroll" onClick={(e) => e.stopPropagation()}>
                    {goalContributions.length === 0 ? (
                      <p className="empty-state">Todavía no hay aportes cargados.</p>
                    ) : (
                      <table className="tx-table">
                        <thead>
                          <tr>
                            <th>Fecha</th>
                            <th className="tx-amount-header">Monto</th>
                          </tr>
                        </thead>
                        <tbody>
                          {goalContributions.map((c) => (
                            <tr
                              key={c.id}
                              onDoubleClick={(e) => {
                                e.stopPropagation()
                                openEditContribution(c)
                              }}
                            >
                              <td>{formatDateShort(c.contribution_date)}</td>
                              <td className="tx-amount">{formatMoney(c.amount)}</td>
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

      {contributeGoal && (
        <Modal>
          <h3>Agregar aporte — {contributeGoal.title}</h3>
          <form className="budget-form" onSubmit={handleContributeSubmit} noValidate>
            <DateField value={contributeDate} onChange={setContributeDate} />
            <input
              type="text"
              inputMode="numeric"
              className="amount-input"
              placeholder="Monto"
              value={formatAmountDigits(contributeAmountDigits)}
              onChange={(e) => setContributeAmountDigits(e.target.value.replace(/\D/g, '').slice(0, 12))}
            />
            {contributeError && <p className="error">{contributeError}</p>}
            <div className="modal-actions">
              <button type="button" onClick={() => setContributeGoal(null)}>
                Cancelar
              </button>
              <button type="submit" className="primary" disabled={contributeSaving}>
                {contributeSaving ? 'Guardando...' : 'Agregar'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {editGoal && (
        <Modal>
          <h3>Editar objetivo</h3>
          <form className="budget-form" onSubmit={handleEditGoalSubmit} noValidate>
            <input type="text" placeholder="Título" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
            <input
              type="text"
              inputMode="numeric"
              className="amount-input"
              placeholder="Monto objetivo"
              value={formatAmountDigits(editTargetAmountDigits)}
              onChange={(e) => setEditTargetAmountDigits(e.target.value.replace(/\D/g, '').slice(0, 12))}
            />
            <DateField value={editTargetDate} onChange={setEditTargetDate} />
            {editError && <p className="error">{editError}</p>}
            <div className="modal-actions">
              <button type="button" className="danger modal-actions-start" onClick={handleDeleteGoalClick}>
                Eliminar objetivo
              </button>
              <button type="button" onClick={() => setEditGoal(null)}>
                Cancelar
              </button>
              <button type="submit" className="primary" disabled={editSaving}>
                {editSaving ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {editingContribution && (
        <Modal>
          <h3>Editar aporte</h3>
          <form className="budget-form" onSubmit={handleEditContributionSubmit} noValidate>
            <DateField value={editContributionDate} onChange={setEditContributionDate} />
            <input
              type="text"
              inputMode="numeric"
              className="amount-input"
              placeholder="Monto"
              value={formatAmountDigits(editContributionAmountDigits)}
              onChange={(e) => setEditContributionAmountDigits(e.target.value.replace(/\D/g, '').slice(0, 12))}
            />
            {editContributionError && <p className="error">{editContributionError}</p>}
            <div className="modal-actions">
              <button
                type="button"
                className="danger modal-actions-start"
                onClick={() => handleDeleteContribution(editingContribution)}
              >
                Eliminar aporte
              </button>
              <button type="button" onClick={() => setEditingContribution(null)}>
                Cancelar
              </button>
              <button type="submit" className="primary" disabled={editContributionSaving}>
                {editContributionSaving ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {pendingDeleteGoal && (
        <Modal>
          <h3>Eliminar objetivo</h3>
          <p>
            Se va a eliminar el objetivo &quot;{pendingDeleteGoal.title}&quot; junto con todos sus aportes registrados.
            Esta acción no se puede deshacer.
          </p>
          <div className="modal-actions">
            <button type="button" onClick={() => setPendingDeleteGoal(null)}>
              Cancelar
            </button>
            <button type="button" className="danger" disabled={deletingGoal} onClick={handleConfirmDeleteGoal}>
              {deletingGoal ? 'Eliminando...' : 'Eliminar'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
