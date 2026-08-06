import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import type { InvestmentLot, InvestmentMarket, InvestmentSale } from '../types/database'
import { IconChevronDown, IconPlus, IconX } from '../components/icons'
import Modal from '../components/Modal'
import SymbolSearch from '../components/SymbolSearch'
import DateField from '../components/DateField'
import TelegramAlerts from '../components/TelegramAlerts'
import SpyBenchmark from '../components/SpyBenchmark'

// El bloque de alertas de Telegram / benchmark de SPY está atado a una sola
// cuenta de Telegram (TELEGRAM_SESSION, ver CLAUDE.md) y no es multi-tenant
// como el resto de la app — si otro usuario lo usara, dispararía un sync
// real contra el mismo canal bajo su propio user_id en vez de ver nada ajeno
// (los datos siguen aislados por RLS), pero no tiene sentido que lo vea. Se
// oculta por email en vez de un rol en la base porque es la única cuenta que
// existe hoy — si esto crece a más de un usuario real, esto debería moverse
// a una tabla de flags en vez de un string hardcodeado.
const TELEGRAM_FEATURE_EMAIL = 'tolosaema11@gmail.com'

const MARKET_CURRENCY: Record<InvestmentMarket, string> = {
  ar: 'ARS',
  world: 'USD',
}

function formatMoney(amount: number, currency: string) {
  return amount.toLocaleString('es-AR', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function todayDateInput() {
  return new Date().toISOString().slice(0, 10)
}

// Mismo motivo que en Transactions.tsx/Budgets.tsx: armar la fecha con
// año/mes/día sueltos usa medianoche local, evitando que se corra un día.
function formatDateShort(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-AR')
}

interface Holding {
  symbol: string
  market: InvestmentMarket
  totalQuantity: number
  avgBuyPrice: number
  // Nombre de compañía del primer lote que lo tenga — puede haber lotes
  // viejos sin este dato (ver InvestmentLot.name) aunque sea la misma
  // tenencia.
  name: string | null
  // Lotes con remaining_quantity > 0, ordenados FIFO (más viejo primero) —
  // una venta los consume en este orden.
  lots: InvestmentLot[]
}

interface MovementRow {
  key: string
  symbol: string
  market: InvestmentMarket
  buyDate: string
  buyQuantity: number
  buyPrice: number
  sellDate: string | null
  sellQuantity: number | null
  sellPrice: number | null
  gainPct: number | null
  gainAmount: number | null
  sortDate: string
}

export default function Investments() {
  const { user } = useAuth()
  const [lots, setLots] = useState<InvestmentLot[]>([])
  const [sales, setSales] = useState<InvestmentSale[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [formOpen, setFormOpen] = useState(false)
  const [market, setMarket] = useState<InvestmentMarket>('ar')
  const [symbol, setSymbol] = useState('')
  // Solo true cuando el símbolo vino de elegir una opción de la lista de
  // SymbolSearch (no de tipear) — bloquea el submit si no hay una elección
  // real, ver handleAdd.
  const [symbolConfirmed, setSymbolConfirmed] = useState(false)
  const [symbolName, setSymbolName] = useState<string | null>(null)
  const [buyDate, setBuyDate] = useState(todayDateInput())
  const [price, setPrice] = useState('')
  const [quantity, setQuantity] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [sellHolding, setSellHolding] = useState<Holding | null>(null)
  const [sellQuantity, setSellQuantity] = useState('')
  const [sellPrice, setSellPrice] = useState('')
  const [sellSaving, setSellSaving] = useState(false)
  const [sellError, setSellError] = useState<string | null>(null)

  // Lote (compra) en edición, ya sea desde una fila de Cartera actual o una
  // fila "abierta" de Movimientos — ambas representan el mismo registro de
  // investment_lots.
  const [editLot, setEditLot] = useState<InvestmentLot | null>(null)
  const [editLotDate, setEditLotDate] = useState('')
  const [editLotQuantity, setEditLotQuantity] = useState('')
  const [editLotPrice, setEditLotPrice] = useState('')
  const [editLotExtraCount, setEditLotExtraCount] = useState(0)
  const [editLotSaving, setEditLotSaving] = useState(false)
  const [editLotError, setEditLotError] = useState<string | null>(null)

  // Venta en edición (fila cerrada de Movimientos).
  const [editSale, setEditSale] = useState<{ sale: InvestmentSale; lot: InvestmentLot } | null>(null)
  const [editSaleDate, setEditSaleDate] = useState('')
  const [editSaleQuantity, setEditSaleQuantity] = useState('')
  const [editSalePrice, setEditSalePrice] = useState('')
  const [editSaleSaving, setEditSaleSaving] = useState(false)
  const [editSaleError, setEditSaleError] = useState<string | null>(null)

  async function load() {
    if (!user) return
    setLoading(true)
    setError(null)

    const [{ data: lotsData, error: lotsError }, { data: salesData, error: salesError }] = await Promise.all([
      supabase.from('investment_lots').select('*').order('buy_date', { ascending: true }),
      supabase.from('investment_sales').select('*').order('sell_date', { ascending: false }),
    ])

    if (lotsError || salesError) {
      setError(lotsError?.message ?? salesError?.message ?? 'Error al cargar inversiones')
      setLoading(false)
      return
    }

    setLots(lotsData ?? [])
    setSales(salesData ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const holdings = useMemo<Holding[]>(() => {
    const groups = new Map<string, Holding>()
    for (const lot of lots) {
      if (lot.remaining_quantity <= 0) continue
      const key = `${lot.symbol}__${lot.market}`
      let holding = groups.get(key)
      if (!holding) {
        holding = { symbol: lot.symbol, market: lot.market, totalQuantity: 0, avgBuyPrice: 0, name: null, lots: [] }
        groups.set(key, holding)
      }
      holding.lots.push(lot)
      holding.totalQuantity += lot.remaining_quantity
    }
    for (const holding of groups.values()) {
      holding.lots.sort((a, b) => (a.buy_date < b.buy_date ? -1 : a.buy_date > b.buy_date ? 1 : a.created_at.localeCompare(b.created_at)))
      const totalCost = holding.lots.reduce((sum, l) => sum + l.remaining_quantity * l.buy_price, 0)
      holding.avgBuyPrice = holding.totalQuantity > 0 ? totalCost / holding.totalQuantity : 0
      holding.name = holding.lots.find((l) => l.name)?.name ?? null
    }
    return Array.from(groups.values()).sort((a, b) => a.symbol.localeCompare(b.symbol))
  }, [lots])

  const movements = useMemo<MovementRow[]>(() => {
    const lotById = new Map(lots.map((l) => [l.id, l]))
    const rows: MovementRow[] = []

    for (const sale of sales) {
      const lot = lotById.get(sale.lot_id)
      if (!lot) continue
      const gainPct = lot.buy_price > 0 ? ((sale.sell_price - lot.buy_price) / lot.buy_price) * 100 : 0
      rows.push({
        key: `sale-${sale.id}`,
        symbol: lot.symbol,
        market: lot.market,
        buyDate: lot.buy_date,
        buyQuantity: sale.sell_quantity,
        buyPrice: lot.buy_price,
        sellDate: sale.sell_date,
        sellQuantity: sale.sell_quantity,
        sellPrice: sale.sell_price,
        gainPct,
        gainAmount: (sale.sell_price - lot.buy_price) * sale.sell_quantity,
        sortDate: sale.sell_date,
      })
    }

    for (const lot of lots) {
      if (lot.remaining_quantity <= 0) continue
      rows.push({
        key: `open-${lot.id}`,
        symbol: lot.symbol,
        market: lot.market,
        buyDate: lot.buy_date,
        buyQuantity: lot.remaining_quantity,
        buyPrice: lot.buy_price,
        sellDate: null,
        sellQuantity: null,
        sellPrice: null,
        gainPct: null,
        gainAmount: null,
        sortDate: lot.buy_date,
      })
    }

    return rows.sort((a, b) => (a.sortDate < b.sortDate ? 1 : a.sortDate > b.sortDate ? -1 : 0))
  }, [lots, sales])

  const lotById = useMemo(() => new Map(lots.map((l) => [l.id, l])), [lots])

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    setFormError(null)

    const trimmedSymbol = symbol.trim().toUpperCase()
    const priceNum = Number(price)
    const qtyNum = Number(quantity)

    if (!trimmedSymbol || !symbolConfirmed) {
      setFormError('Elegí un símbolo de la lista.')
      return
    }
    if (!buyDate) {
      setFormError('Ingresá una fecha.')
      return
    }
    if (!(priceNum > 0)) {
      setFormError('El valor tiene que ser mayor a 0.')
      return
    }
    if (!(qtyNum > 0)) {
      setFormError('La cantidad tiene que ser mayor a 0.')
      return
    }

    setSaving(true)
    const { error: insertError } = await supabase.from('investment_lots').insert({
      user_id: user.id,
      symbol: trimmedSymbol,
      name: symbolName,
      market,
      buy_date: buyDate,
      buy_quantity: qtyNum,
      buy_price: priceNum,
      remaining_quantity: qtyNum,
    })
    setSaving(false)

    if (insertError) {
      setFormError(insertError.message)
      return
    }

    setSymbol('')
    setSymbolConfirmed(false)
    setSymbolName(null)
    setBuyDate(todayDateInput())
    setPrice('')
    setQuantity('')
    setFormOpen(false)
    load()
  }

  function openSell(holding: Holding) {
    setSellHolding(holding)
    setSellQuantity(String(holding.totalQuantity))
    setSellPrice('')
    setSellError(null)
  }

  async function handleSell(e: FormEvent) {
    e.preventDefault()
    if (!user || !sellHolding) return
    setSellError(null)

    const qtyNum = Number(sellQuantity)
    const priceNum = Number(sellPrice)

    if (!(qtyNum > 0)) {
      setSellError('La cantidad tiene que ser mayor a 0.')
      return
    }
    if (qtyNum > sellHolding.totalQuantity) {
      setSellError(`No podés vender más de ${sellHolding.totalQuantity} unidades.`)
      return
    }
    if (!(priceNum > 0)) {
      setSellError('El precio tiene que ser mayor a 0.')
      return
    }

    setSellSaving(true)
    const todayStr = todayDateInput()
    let remainingToSell = qtyNum

    // Consume los lotes de esta tenencia en orden FIFO hasta cubrir la
    // cantidad vendida — una venta parcial puede terminar tocando más de un
    // lote, cada uno queda como su propia fila en Movimientos con la
    // ganancia calculada contra su propio precio de compra.
    for (const lot of sellHolding.lots) {
      if (remainingToSell <= 0) break
      const take = Math.min(remainingToSell, lot.remaining_quantity)
      if (take <= 0) continue

      const { error: saleError } = await supabase.from('investment_sales').insert({
        user_id: user.id,
        lot_id: lot.id,
        sell_date: todayStr,
        sell_quantity: take,
        sell_price: priceNum,
      })
      if (saleError) {
        setSellSaving(false)
        setSellError(saleError.message)
        return
      }

      const { error: updateError } = await supabase
        .from('investment_lots')
        .update({ remaining_quantity: lot.remaining_quantity - take })
        .eq('id', lot.id)
      if (updateError) {
        setSellSaving(false)
        setSellError(updateError.message)
        return
      }

      remainingToSell -= take
    }

    setSellSaving(false)
    setSellHolding(null)
    load()
  }

  // Se abre desde una fila de Movimientos (un lote puntual) o desde Cartera
  // actual — ahí se edita el lote más antiguo de la tenencia; si hay más de
  // uno, se avisa en el modal para que los demás se editen desde Movimientos.
  function openLotEdit(lot: InvestmentLot, extraCount = 0) {
    setEditLot(lot)
    setEditLotDate(lot.buy_date)
    setEditLotQuantity(String(lot.remaining_quantity))
    setEditLotPrice(String(lot.buy_price))
    setEditLotExtraCount(extraCount)
    setEditLotError(null)
  }

  async function handleLotEditSubmit(e: FormEvent) {
    e.preventDefault()
    if (!editLot) return
    setEditLotError(null)

    const qtyNum = Number(editLotQuantity)
    const priceNum = Number(editLotPrice)
    if (!(qtyNum > 0)) {
      setEditLotError('La cantidad tiene que ser mayor a 0.')
      return
    }
    if (!(priceNum > 0)) {
      setEditLotError('El valor tiene que ser mayor a 0.')
      return
    }

    setEditLotSaving(true)
    const { error: updateError } = await supabase
      .from('investment_lots')
      .update({ buy_date: editLotDate, remaining_quantity: qtyNum, buy_price: priceNum })
      .eq('id', editLot.id)
    setEditLotSaving(false)

    if (updateError) {
      setEditLotError(updateError.message)
      return
    }
    setEditLot(null)
    load()
  }

  async function handleLotDelete(lot: InvestmentLot) {
    setEditLotSaving(true)
    const { error: deleteError } = await supabase.from('investment_lots').delete().eq('id', lot.id)
    setEditLotSaving(false)
    if (deleteError) {
      setEditLotError(deleteError.message)
      return
    }
    setEditLot(null)
    load()
  }

  function openSaleEdit(sale: InvestmentSale) {
    const lot = lotById.get(sale.lot_id)
    if (!lot) return
    setEditSale({ sale, lot })
    setEditSaleDate(sale.sell_date)
    setEditSaleQuantity(String(sale.sell_quantity))
    setEditSalePrice(String(sale.sell_price))
    setEditSaleError(null)
  }

  async function handleSaleEditSubmit(e: FormEvent) {
    e.preventDefault()
    if (!editSale) return
    setEditSaleError(null)

    const { sale, lot } = editSale
    const qtyNum = Number(editSaleQuantity)
    const priceNum = Number(editSalePrice)
    const maxQty = lot.remaining_quantity + sale.sell_quantity

    if (!(qtyNum > 0)) {
      setEditSaleError('La cantidad tiene que ser mayor a 0.')
      return
    }
    if (qtyNum > maxQty) {
      setEditSaleError(`No podés vender más de ${maxQty} unidades de este lote.`)
      return
    }
    if (!(priceNum > 0)) {
      setEditSaleError('El precio tiene que ser mayor a 0.')
      return
    }

    setEditSaleSaving(true)
    const { error: saleUpdateError } = await supabase
      .from('investment_sales')
      .update({ sell_date: editSaleDate, sell_quantity: qtyNum, sell_price: priceNum })
      .eq('id', sale.id)
    if (saleUpdateError) {
      setEditSaleSaving(false)
      setEditSaleError(saleUpdateError.message)
      return
    }

    const { error: lotUpdateError } = await supabase
      .from('investment_lots')
      .update({ remaining_quantity: maxQty - qtyNum })
      .eq('id', lot.id)
    setEditSaleSaving(false)
    if (lotUpdateError) {
      setEditSaleError(lotUpdateError.message)
      return
    }
    setEditSale(null)
    load()
  }

  async function handleSaleDelete() {
    if (!editSale) return
    const { sale, lot } = editSale
    setEditSaleSaving(true)
    const { error: deleteError } = await supabase.from('investment_sales').delete().eq('id', sale.id)
    if (deleteError) {
      setEditSaleSaving(false)
      setEditSaleError(deleteError.message)
      return
    }
    const { error: lotUpdateError } = await supabase
      .from('investment_lots')
      .update({ remaining_quantity: lot.remaining_quantity + sale.sell_quantity })
      .eq('id', lot.id)
    setEditSaleSaving(false)
    if (lotUpdateError) {
      setEditSaleError(lotUpdateError.message)
      return
    }
    setEditSale(null)
    load()
  }

  return (
    <div>
      <div className="tx-header">
        <h2>Inversiones</h2>
      </div>

      {error && <p className="error">{error}</p>}

      <button
        type="button"
        className={`tx-form-toggle${formOpen ? ' open' : ''}`}
        onClick={() => setFormOpen((o) => !o)}
        aria-expanded={formOpen}
      >
        <IconPlus size={14} /> Agregar compra de símbolo
        <IconChevronDown size={16} />
      </button>

      <form className={`tx-form${formOpen ? ' open' : ''}`} onSubmit={handleAdd} noValidate>
        <div className="type-toggle" role="group" aria-label="Moneda">
          <button type="button" className={market === 'ar' ? 'active' : ''} onClick={() => setMarket('ar')}>
            ARS
          </button>
          <button type="button" className={market === 'world' ? 'active' : ''} onClick={() => setMarket('world')}>
            USD
          </button>
        </div>
        <SymbolSearch
          value={symbol}
          onChange={(v) => {
            setSymbol(v)
            setSymbolConfirmed(false)
          }}
          onSelect={(_symbol, name) => {
            setSymbolConfirmed(true)
            setSymbolName(name)
          }}
        />
        <DateField value={buyDate} onChange={setBuyDate} />
        <input
          type="number"
          step="0.01"
          min="0"
          placeholder={`Valor (${MARKET_CURRENCY[market]})`}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <input type="number" step="any" min="0" placeholder="Cantidad" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
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

      <h3>Cartera actual</h3>
      {loading ? (
        <p>Cargando...</p>
      ) : holdings.length === 0 ? (
        <p className="empty-state">Todavía no cargaste activos.</p>
      ) : (
        <div className="tx-table-scroll">
          <table className="tx-table">
            <thead>
              <tr>
                <th>Símbolo</th>
                <th>Moneda</th>
                <th>Cantidad</th>
                <th className="tx-amount-header">Precio compra</th>
                <th className="tx-amount-header">Invertido</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => (
                <tr key={`${h.symbol}__${h.market}`} onDoubleClick={() => openLotEdit(h.lots[0], h.lots.length - 1)}>
                  <td>
                    {h.symbol}
                    {h.name && <span className="investments-holding-name">{h.name}</span>}
                  </td>
                  <td>{MARKET_CURRENCY[h.market]}</td>
                  <td>{h.totalQuantity}</td>
                  <td className="tx-amount">{formatMoney(h.avgBuyPrice, MARKET_CURRENCY[h.market])}</td>
                  <td className="tx-amount">{formatMoney(h.totalQuantity * h.avgBuyPrice, MARKET_CURRENCY[h.market])}</td>
                  <td className="tx-actions">
                    <button type="button" className="gmail-scan-btn" onClick={() => openSell(h)}>
                      Vender
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="tx-section-heading">Movimientos</h3>
      {movements.length === 0 ? (
        <p className="empty-state">Todavía no hay movimientos.</p>
      ) : (
        <div className="tx-table-scroll">
          <table className="tx-table">
            <thead>
              <tr>
                <th>Símbolo</th>
                <th>Fecha compra</th>
                <th>Cant. compra</th>
                <th className="tx-amount-header">Valor compra</th>
                <th className="tx-table-divider">Fecha venta</th>
                <th>Cant. venta</th>
                <th className="tx-amount-header">Valor venta</th>
                <th className="tx-amount-header tx-table-divider">Ganancia %</th>
                <th className="tx-amount-header">Ganancia $/USD</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => {
                const currency = MARKET_CURRENCY[m.market]
                const gainClass = m.gainAmount == null ? '' : m.gainAmount >= 0 ? 'income' : 'negative'
                const handleRowDoubleClick = () => {
                  if (m.key.startsWith('sale-')) {
                    const sale = sales.find((s) => `sale-${s.id}` === m.key)
                    if (sale) openSaleEdit(sale)
                  } else {
                    const lot = lots.find((l) => `open-${l.id}` === m.key)
                    if (lot) openLotEdit(lot)
                  }
                }
                return (
                  <tr key={m.key} onDoubleClick={handleRowDoubleClick}>
                    <td>{m.symbol}</td>
                    <td>{formatDateShort(m.buyDate)}</td>
                    <td>{m.buyQuantity}</td>
                    <td className="tx-amount">{formatMoney(m.buyPrice, currency)}</td>
                    <td className="tx-table-divider">{m.sellDate ? formatDateShort(m.sellDate) : '—'}</td>
                    <td>{m.sellQuantity ?? '—'}</td>
                    <td className="tx-amount">{m.sellPrice != null ? formatMoney(m.sellPrice, currency) : '—'}</td>
                    <td className={`tx-amount tx-table-divider ${gainClass}`}>
                      {m.gainPct == null ? '—' : `${m.gainPct >= 0 ? '+' : ''}${m.gainPct.toFixed(2)}%`}
                    </td>
                    <td className={`tx-amount ${gainClass}`}>
                      {m.gainAmount == null ? '—' : formatMoney(m.gainAmount, currency)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {user?.email === TELEGRAM_FEATURE_EMAIL && (
        <>
          <TelegramAlerts />

          <SpyBenchmark />
        </>
      )}

      {sellHolding && (
        <Modal>
          <h3>Vender {sellHolding.symbol}</h3>
          <form className="budget-form" onSubmit={handleSell} noValidate>
            <input
              type="number"
              step="any"
              min="0"
              max={sellHolding.totalQuantity}
              placeholder="Cantidad"
              value={sellQuantity}
              onChange={(e) => setSellQuantity(e.target.value)}
            />
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder={`Precio de venta (${MARKET_CURRENCY[sellHolding.market]})`}
              value={sellPrice}
              onChange={(e) => setSellPrice(e.target.value)}
            />
            {sellError && <p className="error">{sellError}</p>}
            <div className="modal-actions">
              <button type="button" onClick={() => setSellHolding(null)}>
                Cancelar
              </button>
              <button type="submit" className="primary" disabled={sellSaving}>
                {sellSaving ? 'Guardando...' : 'Vender'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {editLot && (
        <Modal>
          <h3>Editar compra de {editLot.symbol}</h3>
          {editLotExtraCount > 0 && (
            <p className="empty-state">
              Esta tenencia tiene {editLotExtraCount + 1} lotes de compra; se está editando el más antiguo ({formatDateShort(editLot.buy_date)}).
              Para editar los demás, hacé doble click en su fila dentro de Movimientos.
            </p>
          )}
          <form className="budget-form" onSubmit={handleLotEditSubmit} noValidate>
            <DateField value={editLotDate} onChange={setEditLotDate} />
            <input
              type="number"
              step="any"
              min="0"
              placeholder="Cantidad"
              value={editLotQuantity}
              onChange={(e) => setEditLotQuantity(e.target.value)}
            />
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder={`Valor (${MARKET_CURRENCY[editLot.market]})`}
              value={editLotPrice}
              onChange={(e) => setEditLotPrice(e.target.value)}
            />
            {editLotError && <p className="error">{editLotError}</p>}
            <div className="modal-actions">
              <button
                type="button"
                className="danger modal-actions-start"
                onClick={() => handleLotDelete(editLot)}
                disabled={editLotSaving}
              >
                <IconX size={14} /> Eliminar compra
              </button>
              <button type="button" onClick={() => setEditLot(null)}>
                Cancelar
              </button>
              <button type="submit" className="primary" disabled={editLotSaving}>
                {editLotSaving ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {editSale && (
        <Modal>
          <h3>Editar venta de {editSale.lot.symbol}</h3>
          <form className="budget-form" onSubmit={handleSaleEditSubmit} noValidate>
            <DateField value={editSaleDate} onChange={setEditSaleDate} />
            <input
              type="number"
              step="any"
              min="0"
              placeholder="Cantidad"
              value={editSaleQuantity}
              onChange={(e) => setEditSaleQuantity(e.target.value)}
            />
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder={`Precio de venta (${MARKET_CURRENCY[editSale.lot.market]})`}
              value={editSalePrice}
              onChange={(e) => setEditSalePrice(e.target.value)}
            />
            {editSaleError && <p className="error">{editSaleError}</p>}
            <div className="modal-actions">
              <button
                type="button"
                className="danger modal-actions-start"
                onClick={handleSaleDelete}
                disabled={editSaleSaving}
              >
                <IconX size={14} /> Eliminar venta
              </button>
              <button type="button" onClick={() => setEditSale(null)}>
                Cancelar
              </button>
              <button type="submit" className="primary" disabled={editSaleSaving}>
                {editSaleSaving ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
