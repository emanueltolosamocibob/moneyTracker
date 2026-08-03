import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import type {
  BudgetItem,
  BudgetPeriod,
  Category,
  CategoryMonthSpend,
  InvestmentLot,
  InvestmentSale,
  Transaction,
} from '../types/database'
import { IconReceipt, IconTrendingUp, IconWallet } from '../components/icons'
import { getCategoryIcon } from '../lib/categoryIcons'

function formatCurrency(amount: number, currency: string) {
  return amount.toLocaleString('es-AR', { style: 'currency', currency })
}

function currentMonthStart() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

// [inicio del mes, inicio del mes siguiente) — mismo rango exclusivo que usa
// Transactions.tsx, para no engancharse un día del mes de al lado por corte
// de huso horario.
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

function monthStartDateStr(monthStart: Date) {
  return `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}-01`
}

// Mismo motivo que en Budgets.tsx/Transactions.tsx: construir con año/mes/día
// sueltos usa medianoche local, evitando que la fecha se corra un día.
function parseDateLocal(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function todayDateStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dateInputToISOStart(dateStr: string) {
  return parseDateLocal(dateStr).toISOString()
}

function dateInputToISOEndExclusive(dateStr: string) {
  const d = parseDateLocal(dateStr)
  d.setDate(d.getDate() + 1)
  return d.toISOString()
}

function formatPeriodLabel(periodStart: string, periodEnd: string, periodType: BudgetPeriod['period_type']) {
  if (periodType === 'monthly') {
    const label = parseDateLocal(periodStart).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
    return label.charAt(0).toUpperCase() + label.slice(1)
  }
  return `${parseDateLocal(periodStart).toLocaleDateString('es-AR')} – ${parseDateLocal(periodEnd).toLocaleDateString('es-AR')}`
}

// Porciones traslúcidas (no colores sólidos) para que el círculo se sienta
// parte del mismo vidrio esmerilado que el resto de la UI en vez de un
// gráfico "de librería" pegado encima — sin bordes entre porciones, la
// textura granulada (ver .dashboard-pie::after en index.css) es lo que las
// separa visualmente.
const PIE_SLICE_ALPHA = 0.75

function hexToRgba(hex: string, alpha: number) {
  const clean = hex.replace('#', '')
  const bigint = parseInt(clean, 16)
  const r = (bigint >> 16) & 255
  const g = (bigint >> 8) & 255
  const b = bigint & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const MARKET_CURRENCY: Record<'ar' | 'world', string> = { ar: 'ARS', world: 'USD' }

interface Holding {
  market: 'ar' | 'world'
  totalQuantity: number
  totalCost: number
}

interface RecentMovement {
  key: string
  symbol: string
  sortDate: string
  isSale: boolean
  gainAmount: number | null
  currency: string
}

const RECENT_TX_LIMIT = 5
const RECENT_MOVEMENTS_LIMIT = 4

// Sentinela para transacciones sin categoría — se graba tal cual en
// category_month_spend.category_name para poder distinguirlas ahí de una
// categoría real que después se borró (ver mapSnapshotRows).
const UNCATEGORIZED_LABEL = 'Sin categoría'
const UNCATEGORIZED_COLOR = '#8a8fa3'
const DELETED_CATEGORY_LABEL = 'Categoría eliminada'
const DELETED_CATEGORY_COLOR = '#5b5f73'

interface CategorySpendRow {
  key: string
  categoryId: string | null
  label: string
  color: string
  amount: number
  // Lo que se guarda en category_month_spend.category_name — a diferencia
  // de `label`, nunca es "Categoría eliminada" (eso se resuelve recién al
  // leer un snapshot viejo, ver mapSnapshotRows).
  snapshotName: string
}

// "Interno" son transferencias entre las propias cuentas del usuario (mismo
// criterio que txTotals más abajo) — no cuentan como gasto real. Solo ARS,
// igual que el resto de los totales del Dashboard/Presupuestos.
function computeCategoryBreakdown(transactions: Transaction[], categories: Category[]): CategorySpendRow[] {
  const totals = new Map<string, number>()
  for (const t of transactions) {
    if (t.type !== 'expense' || t.currency !== 'ARS') continue
    const cat = categories.find((c) => c.id === t.category_id)
    if (cat?.name === 'Interno') continue
    const key = t.category_id ?? ''
    totals.set(key, (totals.get(key) ?? 0) + t.amount)
  }

  const rows: CategorySpendRow[] = []
  for (const [key, amount] of totals) {
    if (key === '') {
      rows.push({ key: 'uncategorized', categoryId: null, label: UNCATEGORIZED_LABEL, color: UNCATEGORIZED_COLOR, amount, snapshotName: UNCATEGORIZED_LABEL })
      continue
    }
    const cat = categories.find((c) => c.id === key)
    if (!cat) continue
    rows.push({ key: cat.id, categoryId: cat.id, label: cat.name, color: cat.color, amount, snapshotName: cat.name })
  }
  return rows.sort((a, b) => b.amount - a.amount)
}

// Un snapshot con category_id null puede ser "nunca tuvo categoría" (el
// sentinela UNCATEGORIZED_LABEL) o "tenía una categoría real que se borró
// después" (on delete set null en category_month_spend.category_id, ver la
// migración) — category_name sigue teniendo el nombre real en ese segundo
// caso, así que alcanza con compararlo contra el sentinela para distinguirlos.
function mapSnapshotRows(rows: CategoryMonthSpend[]): CategorySpendRow[] {
  return rows
    .map((r) => {
      const isDeleted = r.category_id == null && r.category_name !== UNCATEGORIZED_LABEL
      return {
        key: r.id,
        categoryId: r.category_id,
        label: isDeleted ? DELETED_CATEGORY_LABEL : r.category_name,
        color: isDeleted ? DELETED_CATEGORY_COLOR : r.category_color,
        amount: r.amount,
        snapshotName: r.category_name,
      }
    })
    .sort((a, b) => b.amount - a.amount)
}

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [monthTransactions, setMonthTransactions] = useState<Transaction[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([])

  const [budgetPeriod, setBudgetPeriod] = useState<BudgetPeriod | null>(null)
  const [budgetItems, setBudgetItems] = useState<BudgetItem[]>([])
  const [budgetSpent, setBudgetSpent] = useState<{ amount: number }[]>([])

  const [lots, setLots] = useState<InvestmentLot[]>([])
  const [sales, setSales] = useState<InvestmentSale[]>([])

  const [chartMonth, setChartMonth] = useState(currentMonthStart)
  const [chartRows, setChartRows] = useState<CategorySpendRow[]>([])
  const [chartLoading, setChartLoading] = useState(true)
  const [chartError, setChartError] = useState<string | null>(null)

  // Gráfico de gastos por categoría: mes en curso siempre se recalcula en
  // vivo (y se guarda, quedando "al día" mientras el mes sigue abierto); un
  // mes ya cerrado se recalcula solo si todavía no tiene snapshot guardado
  // — si ya lo tiene, se lee tal cual, congelado (ver el comentario largo en
  // la migración 0008_category_spend_tracking.sql sobre por qué).
  useEffect(() => {
    async function loadChart() {
      if (!user) return
      setChartLoading(true)
      setChartError(null)

      const monthStartStr = monthStartDateStr(chartMonth)
      const isPast = chartMonth < currentMonthStart()

      if (isPast) {
        const { data: snapshot, error: snapshotError } = await supabase
          .from('category_month_spend')
          .select('*')
          .eq('user_id', user.id)
          .eq('month_start', monthStartStr)
        if (snapshotError) {
          setChartError(snapshotError.message)
          setChartLoading(false)
          return
        }
        if (snapshot && snapshot.length > 0) {
          setChartRows(mapSnapshotRows(snapshot))
          setChartLoading(false)
          return
        }
      }

      const { startISO, endISO } = monthRangeISO(chartMonth)
      const [{ data: tx, error: txError }, { data: cats }] = await Promise.all([
        supabase.from('transactions').select('*').gte('occurred_at', startISO).lt('occurred_at', endISO),
        supabase.from('categories').select('*'),
      ])
      if (txError) {
        setChartError(txError.message)
        setChartLoading(false)
        return
      }

      const rows = computeCategoryBreakdown(tx ?? [], cats ?? [])
      setChartRows(rows)
      setChartLoading(false)

      await supabase.from('category_month_spend').delete().eq('user_id', user.id).eq('month_start', monthStartStr)
      if (rows.length > 0) {
        await supabase.from('category_month_spend').insert(
          rows.map((r) => ({
            user_id: user.id,
            month_start: monthStartStr,
            category_id: r.categoryId,
            category_name: r.snapshotName,
            category_color: r.color,
            amount: r.amount,
          })),
        )
      }
    }
    loadChart()
  }, [user, chartMonth])

  function goToPrevChartMonth() {
    setChartMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))
  }

  function goToNextChartMonth() {
    setChartMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))
  }

  const chartTotal = useMemo(() => chartRows.reduce((sum, r) => sum + r.amount, 0), [chartRows])

  // Radio (fracción del radio total) al que se ubica cada etiqueta de
  // porcentaje, para que caiga adentro de su porción en vez de pegada al
  // borde del círculo.
  const PIE_LABEL_RADIUS = 0.62
  // Por debajo de este % la porción es demasiado angosta para que el
  // número entre sin superponerse con el de al lado — se omite en vez de
  // amontonarse (el dato sigue estando en la leyenda).
  const PIE_LABEL_MIN_PCT = 6

  const pieGradient = useMemo(() => {
    if (chartTotal <= 0) return null
    let cursor = 0
    const stops = chartRows.map((r) => {
      const start = cursor
      cursor += (r.amount / chartTotal) * 360
      return `${hexToRgba(r.color, PIE_SLICE_ALPHA)} ${start}deg ${cursor}deg`
    })
    return `conic-gradient(${stops.join(', ')})`
  }, [chartRows, chartTotal])

  // Posición de cada etiqueta de % sobre el propio círculo — conic-gradient
  // mide sus ángulos desde arriba (12 en punto) en sentido horario, así que
  // la conversión a x/y (con el centro en 50%,50%) es
  // x = 50 + r·sin(θ), y = 50 − r·cos(θ), no el seno/coseno "de manual" que
  // asume 0° apuntando a la derecha.
  const pieLabels = useMemo(() => {
    if (chartTotal <= 0) return []
    let cursor = 0
    const labels: { key: string; x: number; y: number; pct: number }[] = []
    for (const r of chartRows) {
      const start = cursor
      const sliceDeg = (r.amount / chartTotal) * 360
      cursor += sliceDeg
      const pct = (r.amount / chartTotal) * 100
      if (pct < PIE_LABEL_MIN_PCT) continue
      const midRad = ((start + sliceDeg / 2) * Math.PI) / 180
      labels.push({
        key: r.key,
        x: 50 + PIE_LABEL_RADIUS * 50 * Math.sin(midRad),
        y: 50 - PIE_LABEL_RADIUS * 50 * Math.cos(midRad),
        pct,
      })
    }
    return labels
  }, [chartRows, chartTotal])

  useEffect(() => {
    async function load() {
      if (!user) return
      setLoading(true)
      setError(null)

      const monthStart = currentMonthStart()
      const { startISO, endISO } = monthRangeISO(monthStart)
      const todayStr = todayDateStr()

      const [
        { data: monthTx, error: monthTxError },
        { data: cats },
        { data: recentTx },
        { data: latestPeriod },
        { data: lotsData, error: lotsError },
        { data: salesData },
      ] = await Promise.all([
        supabase.from('transactions').select('*').gte('occurred_at', startISO).lt('occurred_at', endISO),
        supabase.from('categories').select('*'),
        supabase.from('transactions').select('*').order('occurred_at', { ascending: false }).limit(RECENT_TX_LIMIT),
        supabase.from('budget_periods').select('*').order('period_start', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('investment_lots').select('*').order('buy_date', { ascending: true }),
        supabase
          .from('investment_sales')
          .select('*')
          .order('sell_date', { ascending: false })
          .limit(RECENT_MOVEMENTS_LIMIT),
      ])

      if (monthTxError || lotsError) {
        setError(monthTxError?.message ?? lotsError?.message ?? 'Error al cargar el dashboard')
      }
      setMonthTransactions(monthTx ?? [])
      setCategories(cats ?? [])
      setRecentTransactions(recentTx ?? [])
      setLots(lotsData ?? [])
      setSales(salesData ?? [])

      // Solo se muestra si el último período todavía está vigente hoy — a
      // diferencia de Budgets.tsx, acá no se genera el siguiente período
      // automáticamente (esa mutación es responsabilidad de esa página; acá
      // solo se lee).
      const period = latestPeriod && latestPeriod.period_end >= todayStr ? (latestPeriod as BudgetPeriod) : null
      setBudgetPeriod(period)

      if (period) {
        const [{ data: items }, { data: spentTx }] = await Promise.all([
          supabase.from('budget_items').select('*').eq('budget_period_id', period.id),
          supabase
            .from('transactions')
            .select('amount')
            .eq('type', 'expense')
            .gte('occurred_at', dateInputToISOStart(period.period_start))
            .lt('occurred_at', dateInputToISOEndExclusive(period.period_end)),
        ])
        setBudgetItems(items ?? [])
        setBudgetSpent(spentTx ?? [])
      } else {
        setBudgetItems([])
        setBudgetSpent([])
      }

      setLoading(false)
    }
    load()
  }, [user])

  // "Interno" son transferencias entre las propias cuentas del usuario (ver
  // mismo criterio en Transactions.tsx) — no cuentan para ningún total.
  const txTotals = useMemo(() => {
    const relevant = monthTransactions.filter((t) => categories.find((c) => c.id === t.category_id)?.name !== 'Interno')
    const income = relevant.filter((t) => t.type === 'income').reduce((sum, t) => sum + t.amount, 0)
    const expense = relevant
      .filter((t) => t.type === 'expense' && t.currency === 'ARS')
      .reduce((sum, t) => sum + t.amount, 0)
    const expenseUSD = relevant
      .filter((t) => t.type === 'expense' && t.currency === 'USD')
      .reduce((sum, t) => sum + t.amount, 0)
    return { income, expense, expenseUSD, net: income - expense, count: monthTransactions.length }
  }, [monthTransactions, categories])

  const totalBudgeted = useMemo(() => budgetItems.reduce((sum, it) => sum + it.amount, 0), [budgetItems])
  const totalSpent = useMemo(() => budgetSpent.reduce((sum, t) => sum + t.amount, 0), [budgetSpent])
  const budgetPct = totalBudgeted > 0 ? (totalSpent / totalBudgeted) * 100 : 0
  const budgetStatus = budgetPct >= 100 ? 'over' : budgetPct >= 80 ? 'warn' : ''

  const holdingsByMarket = useMemo(() => {
    const byMarket: Record<'ar' | 'world', Holding> = {
      ar: { market: 'ar', totalQuantity: 0, totalCost: 0 },
      world: { market: 'world', totalQuantity: 0, totalCost: 0 },
    }
    for (const lot of lots) {
      if (lot.remaining_quantity <= 0) continue
      byMarket[lot.market].totalQuantity += lot.remaining_quantity
      byMarket[lot.market].totalCost += lot.remaining_quantity * lot.buy_price
    }
    return byMarket
  }, [lots])

  const recentMovements = useMemo<RecentMovement[]>(() => {
    const lotById = new Map(lots.map((l) => [l.id, l]))
    const saleRows: RecentMovement[] = sales.flatMap((sale) => {
      const lot = lotById.get(sale.lot_id)
      if (!lot) return []
      return [
        {
          key: `sale-${sale.id}`,
          symbol: lot.symbol,
          sortDate: sale.sell_date,
          isSale: true,
          gainAmount: (sale.sell_price - lot.buy_price) * sale.sell_quantity,
          currency: MARKET_CURRENCY[lot.market],
        },
      ]
    })
    const openRows: RecentMovement[] = lots
      .filter((l) => l.remaining_quantity > 0)
      .map((lot) => ({
        key: `open-${lot.id}`,
        symbol: lot.symbol,
        sortDate: lot.buy_date,
        isSale: false,
        gainAmount: null,
        currency: MARKET_CURRENCY[lot.market],
      }))
    return [...saleRows, ...openRows]
      .sort((a, b) => (a.sortDate < b.sortDate ? 1 : a.sortDate > b.sortDate ? -1 : 0))
      .slice(0, RECENT_MOVEMENTS_LIMIT)
  }, [lots, sales])

  const hasInvestments = lots.length > 0

  return (
    <div>
      <div className="tx-header">
        <h2>Inicio</h2>
      </div>

      {error && <p className="error">{error}</p>}

      {loading ? (
        <p>Cargando...</p>
      ) : (
        <div className="dashboard-grid">
          <section className="dashboard-card dashboard-card-clickable" onDoubleClick={() => navigate('/transactions')}>
            <div className="dashboard-card-header">
              <h3>
                <IconReceipt size={16} /> Transacciones
              </h3>
            </div>
            <p className="dashboard-card-subtitle">{formatMonthLabel(currentMonthStart())}</p>
            <div className="dashboard-tx-stats">
              <div className="dashboard-tx-stat-row">
                <span>Ingresos</span>
                <strong className="tx-amount income dashboard-tx-stat-amount">{formatCurrency(txTotals.income, 'ARS')}</strong>
              </div>
              <div className="dashboard-tx-stat-row">
                <span>Egresos</span>
                <strong className="tx-amount dashboard-tx-stat-amount">{formatCurrency(txTotals.expense, 'ARS')}</strong>
              </div>
              {txTotals.expenseUSD > 0 && (
                <div className="dashboard-tx-stat-row">
                  <span>Egresos (USD)</span>
                  <strong className="tx-amount dashboard-tx-stat-amount">{formatCurrency(txTotals.expenseUSD, 'USD')}</strong>
                </div>
              )}
              <div className="dashboard-tx-stat-row">
                <span>Neto</span>
                <strong className={`dashboard-tx-stat-amount ${txTotals.net >= 0 ? 'tx-amount income' : 'tx-amount negative'}`}>
                  {formatCurrency(txTotals.net, 'ARS')}
                </strong>
              </div>
            </div>
            <p className="dashboard-card-footnote">
              {txTotals.count} transacci{txTotals.count === 1 ? 'ón' : 'ones'}
            </p>
          </section>

          <section className="dashboard-card dashboard-card-clickable" onDoubleClick={() => navigate('/budgets')}>
            <div className="dashboard-card-header">
              <h3>
                <IconWallet size={16} /> Presupuesto
              </h3>
            </div>
            {!budgetPeriod ? (
              <p className="empty-state">Todavía no tenés un presupuesto activo.</p>
            ) : (
              <>
                <p className="dashboard-card-subtitle">
                  {formatPeriodLabel(budgetPeriod.period_start, budgetPeriod.period_end, budgetPeriod.period_type)}
                </p>
                <div className="dashboard-stat-row">
                  <div>
                    <span>Presupuestado</span>
                    <strong className="dashboard-stat-amount">{formatCurrency(totalBudgeted, 'ARS')}</strong>
                  </div>
                  <div className="dashboard-stat-end">
                    <span>Gastado</span>
                    <strong className={`dashboard-stat-amount ${budgetStatus}`}>{formatCurrency(totalSpent, 'ARS')}</strong>
                  </div>
                </div>
              </>
            )}
          </section>

          <section className="dashboard-card dashboard-card-clickable" onDoubleClick={() => navigate('/investments')}>
            <div className="dashboard-card-header">
              <h3>
                <IconTrendingUp size={16} /> Inversiones
              </h3>
            </div>
            {!hasInvestments ? (
              <p className="empty-state">Todavía no cargaste activos.</p>
            ) : (
              <>
                <div className="dashboard-stat-row">
                  <div>
                    <span>Invertido (ARS)</span>
                    <strong className="dashboard-stat-amount">{formatCurrency(holdingsByMarket.ar.totalCost, 'ARS')}</strong>
                  </div>
                  <div className="dashboard-stat-end">
                    <span>Invertido (USD)</span>
                    <strong className="dashboard-stat-amount">{formatCurrency(holdingsByMarket.world.totalCost, 'USD')}</strong>
                  </div>
                </div>
                {recentMovements.length > 0 && (
                  <ul className="dashboard-list">
                    {recentMovements.map((m) => (
                      <li key={m.key} className="dashboard-list-row">
                        <span>{m.symbol}</span>
                        {m.isSale ? (
                          <span className={m.gainAmount != null && m.gainAmount >= 0 ? 'tx-amount income' : 'tx-amount negative'}>
                            {m.gainAmount != null ? formatCurrency(m.gainAmount, m.currency) : '—'}
                          </span>
                        ) : (
                          <span className="dashboard-list-muted">En cartera</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>

          <section className="dashboard-card dashboard-card-clickable" onDoubleClick={() => navigate('/transactions')}>
            <div className="dashboard-card-header">
              <h3>Últimas transacciones</h3>
            </div>
            {recentTransactions.length === 0 ? (
              <p className="empty-state">Todavía no hay transacciones.</p>
            ) : (
              <ul className="dashboard-list">
                {recentTransactions.map((t) => {
                  const cat = categories.find((c) => c.id === t.category_id)
                  return (
                    <li key={t.id} className="dashboard-list-row">
                      <span className="dashboard-list-merchant">
                        {t.type === 'expense' ? getCategoryIcon(cat?.name, cat?.icon) : null} {t.merchant ?? '—'}
                      </span>
                      <span className={t.type === 'income' ? 'tx-amount income' : 'tx-amount'}>
                        {t.type === 'expense' ? '-' : '+'}
                        {formatCurrency(t.amount, t.currency)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <section className="dashboard-card dashboard-card-chart">
            <div className="dashboard-card-header">
              <h3>Gastos por categoría</h3>
            </div>
            <div className="tx-month-nav">
              <button type="button" aria-label="Mes anterior" onClick={goToPrevChartMonth}>
                ‹
              </button>
              <span>{formatMonthLabel(chartMonth)}</span>
              <button
                type="button"
                aria-label="Mes siguiente"
                disabled={isSameMonth(chartMonth, currentMonthStart())}
                onClick={goToNextChartMonth}
              >
                ›
              </button>
            </div>
            {chartError && <p className="error">{chartError}</p>}
            {chartLoading ? (
              <p>Cargando...</p>
            ) : chartRows.length === 0 ? (
              <p className="empty-state">No hay gastos registrados este mes.</p>
            ) : (
              <>
                <div className="dashboard-pie-wrap">
                  <div className="dashboard-pie" style={{ background: pieGradient ?? undefined }}>
                    {pieLabels.map((l) => (
                      <span
                        key={l.key}
                        className="dashboard-pie-pct-label"
                        style={{ left: `${l.x}%`, top: `${l.y}%` }}
                      >
                        {l.pct.toFixed(0)}%
                      </span>
                    ))}
                  </div>
                  <ul className="dashboard-pie-legend">
                    {chartRows.map((r) => (
                      <li key={r.key} className="dashboard-pie-legend-row">
                        <span className="dashboard-pie-swatch" style={{ background: hexToRgba(r.color, PIE_SLICE_ALPHA) }} />
                        <span className="dashboard-pie-legend-label">{r.label}</span>
                        <span className="tx-amount">{formatCurrency(r.amount, 'ARS')}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="dashboard-card-footnote">
                  Total: <span className="tx-amount">{formatCurrency(chartTotal, 'ARS')}</span>
                </p>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
