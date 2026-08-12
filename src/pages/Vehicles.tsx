import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import type { Vehicle, VehicleExpense, VehicleExpenseKind, VehicleType } from '../types/database'
import { IconChevronDown, IconDownload, IconPlus, IconRefresh, IconWrench } from '../components/icons'
import Modal from '../components/Modal'
import DateField from '../components/DateField'
import Select from '../components/Select'
import VehicleSilhouette from '../components/VehicleSilhouette'
import { buildVehicleAlerts } from '../lib/vehicleAlerts'

function formatMoney(amount: number) {
  return amount.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Máscara de monto tipo "POS", igual que en Goals.tsx/Loans.tsx/Transactions.tsx.
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

// Mismo motivo que en el resto de las páginas: armar la fecha con año/mes/día
// sueltos usa medianoche local, evitando que se corra un día por UTC.
function formatDateShort(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-AR')
}

function dateInputToISO(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toISOString()
}

function formatKm(km: number) {
  return `${km.toLocaleString('es-AR')} km`
}

// Nombre fijo de la categoría bajo la que se registran los egresos de
// services y visitas al mecánico — misma mecánica que LOAN_PAYMENT_CATEGORY_NAME
// en Loans.tsx: se crea sola la primera vez que hace falta.
const VEHICLE_CATEGORY_NAME = 'Vehículos'

const VEHICLE_TYPE_OPTIONS: { value: VehicleType; label: string }[] = [
  { value: 'car', label: 'Auto' },
  { value: 'suv', label: 'SUV' },
  { value: 'pickup', label: 'Pickup' },
  { value: 'van', label: 'Camioneta / Van' },
  { value: 'moto', label: 'Moto' },
]

export default function Vehicles() {
  const { user } = useAuth()
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [expenses, setExpenses] = useState<VehicleExpense[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [formOpen, setFormOpen] = useState(false)
  const [type, setType] = useState<VehicleType>('car')
  const [brand, setBrand] = useState('')
  const [model, setModel] = useState('')
  const [year, setYear] = useState('')
  const [color, setColor] = useState('#c0c4cc')
  const [licensePlate, setLicensePlate] = useState('')
  const [currentKm, setCurrentKm] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Vehículo abierto en el modal de detalle.
  const [detailVehicleId, setDetailVehicleId] = useState<string | null>(null)
  const [fetchingSpecs, setFetchingSpecs] = useState(false)
  const [uploadingPdf, setUploadingPdf] = useState(false)

  const [editVehicle, setEditVehicle] = useState<Vehicle | null>(null)
  const [editType, setEditType] = useState<VehicleType>('car')
  const [editBrand, setEditBrand] = useState('')
  const [editModel, setEditModel] = useState('')
  const [editYear, setEditYear] = useState('')
  const [editColor, setEditColor] = useState('#c0c4cc')
  const [editLicensePlate, setEditLicensePlate] = useState('')
  const [editCurrentKm, setEditCurrentKm] = useState('')
  const [editConsumption, setEditConsumption] = useState('')
  const [editServiceInterval, setEditServiceInterval] = useState('')
  const [editInsuranceCompany, setEditInsuranceCompany] = useState('')
  const [editInsuranceExpires, setEditInsuranceExpires] = useState('')
  const [editVtvExpires, setEditVtvExpires] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const [pendingDeleteVehicle, setPendingDeleteVehicle] = useState<Vehicle | null>(null)
  const [deletingVehicle, setDeletingVehicle] = useState(false)

  // Alta/edición de un service o visita al mecánico. `expenseVehicle` abre el
  // modal en modo alta; `editingExpense` lo abre en modo edición.
  const [expenseVehicle, setExpenseVehicle] = useState<Vehicle | null>(null)
  const [editingExpense, setEditingExpense] = useState<VehicleExpense | null>(null)
  const [expenseKind, setExpenseKind] = useState<VehicleExpenseKind>('service')
  const [expenseDate, setExpenseDate] = useState(todayDateInput())
  const [expenseTitle, setExpenseTitle] = useState('')
  const [expenseDescription, setExpenseDescription] = useState('')
  const [expenseOdometer, setExpenseOdometer] = useState('')
  const [expenseCostDigits, setExpenseCostDigits] = useState('')
  const [expensePlace, setExpensePlace] = useState('')
  const [expenseSaving, setExpenseSaving] = useState(false)
  const [expenseError, setExpenseError] = useState<string | null>(null)

  async function load() {
    if (!user) return
    setLoading(true)
    setError(null)

    const [{ data: vehiclesData, error: vehiclesError }, { data: expensesData, error: expensesError }] =
      await Promise.all([
        supabase.from('vehicles').select('*').order('created_at', { ascending: false }),
        supabase.from('vehicle_expenses').select('*').order('occurred_on', { ascending: false }),
      ])

    if (vehiclesError || expensesError) {
      setError(vehiclesError?.message ?? expensesError?.message ?? 'Error al cargar vehículos')
      setLoading(false)
      return
    }

    setVehicles(vehiclesData ?? [])
    setExpenses(expensesData ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const expensesByVehicle = useMemo(() => {
    const map = new Map<string, VehicleExpense[]>()
    for (const e of expenses) {
      const list = map.get(e.vehicle_id)
      if (list) list.push(e)
      else map.set(e.vehicle_id, [e])
    }
    return map
  }, [expenses])

  // El vehículo del modal se resuelve por id contra el estado, no se guarda
  // el objeto: así después de un load() el detalle abierto muestra los datos
  // nuevos en vez de una copia vieja.
  const detailVehicle = detailVehicleId ? (vehicles.find((v) => v.id === detailVehicleId) ?? null) : null

  async function authHeaders() {
    const { data } = await supabase.auth.getSession()
    return { Authorization: `Bearer ${data.session?.access_token}` }
  }

  // Consulta consumo e intervalo de service del modelo y los guarda en la
  // fila del vehículo. Se dispara sola al crear uno, y a pedido desde el
  // panel de consumo si quedó sin datos o el modelo se corrigió después.
  async function fetchSpecs(vehicle: Vehicle) {
    setFetchingSpecs(true)
    try {
      const params = new URLSearchParams({ brand: vehicle.brand, model: vehicle.model, year: String(vehicle.year) })
      const res = await fetch(`/api/vehicles/info?${params}`, { headers: await authHeaders() })
      if (!res.ok) throw new Error('No se pudieron consultar los datos del modelo.')
      const specs = (await res.json()) as {
        consumption_l100km: number | null
        service_interval_km: number | null
        fuel_type: string | null
      }
      await supabase
        .from('vehicles')
        .update({
          consumption_l100km: specs.consumption_l100km,
          service_interval_km: specs.service_interval_km,
          fuel_type: specs.fuel_type,
        })
        .eq('id', vehicle.id)
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setFetchingSpecs(false)
    }
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    setFormError(null)

    const yearNum = Number(year)
    const kmNum = currentKm ? Number(currentKm) : null

    if (!brand.trim() || !model.trim()) {
      setFormError('Ingresá marca y modelo.')
      return
    }
    if (!Number.isInteger(yearNum) || yearNum < 1900 || yearNum > 2100) {
      setFormError('Ingresá un año válido.')
      return
    }
    if (kmNum != null && (!Number.isInteger(kmNum) || kmNum < 0)) {
      setFormError('El kilometraje tiene que ser un entero mayor o igual a 0.')
      return
    }

    setSaving(true)
    const { data: newVehicle, error: insertError } = await supabase
      .from('vehicles')
      .insert({
        user_id: user.id,
        type,
        brand: brand.trim(),
        model: model.trim(),
        year: yearNum,
        color,
        license_plate: licensePlate.trim() || null,
        current_km: kmNum,
      })
      .select()
      .single()
    setSaving(false)

    if (insertError || !newVehicle) {
      setFormError(insertError?.message ?? 'No se pudo crear el vehículo.')
      return
    }

    setType('car')
    setBrand('')
    setModel('')
    setYear('')
    setColor('#c0c4cc')
    setLicensePlate('')
    setCurrentKm('')
    setFormOpen(false)
    await load()
    // Best-effort: si la consulta al modelo falla, el vehículo ya quedó
    // creado igual y los datos se pueden pedir de nuevo o cargar a mano.
    fetchSpecs(newVehicle)
  }

  function openEditVehicle(vehicle: Vehicle) {
    setEditVehicle(vehicle)
    setEditType(vehicle.type)
    setEditBrand(vehicle.brand)
    setEditModel(vehicle.model)
    setEditYear(String(vehicle.year))
    setEditColor(vehicle.color)
    setEditLicensePlate(vehicle.license_plate ?? '')
    setEditCurrentKm(vehicle.current_km != null ? String(vehicle.current_km) : '')
    setEditConsumption(vehicle.consumption_l100km != null ? String(vehicle.consumption_l100km) : '')
    setEditServiceInterval(vehicle.service_interval_km != null ? String(vehicle.service_interval_km) : '')
    setEditInsuranceCompany(vehicle.insurance_company ?? '')
    setEditInsuranceExpires(vehicle.insurance_expires_on ?? '')
    setEditVtvExpires(vehicle.vtv_expires_on ?? '')
    setEditError(null)
  }

  async function handleEditVehicleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!editVehicle) return
    setEditError(null)

    const yearNum = Number(editYear)
    if (!editBrand.trim() || !editModel.trim()) {
      setEditError('Ingresá marca y modelo.')
      return
    }
    if (!Number.isInteger(yearNum) || yearNum < 1900 || yearNum > 2100) {
      setEditError('Ingresá un año válido.')
      return
    }

    setEditSaving(true)
    const { error: updateError } = await supabase
      .from('vehicles')
      .update({
        type: editType,
        brand: editBrand.trim(),
        model: editModel.trim(),
        year: yearNum,
        color: editColor,
        license_plate: editLicensePlate.trim() || null,
        current_km: editCurrentKm ? Number(editCurrentKm) : null,
        consumption_l100km: editConsumption ? Number(editConsumption) : null,
        service_interval_km: editServiceInterval ? Number(editServiceInterval) : null,
        insurance_company: editInsuranceCompany.trim() || null,
        insurance_expires_on: editInsuranceExpires || null,
        vtv_expires_on: editVtvExpires || null,
      })
      .eq('id', editVehicle.id)
    setEditSaving(false)

    if (updateError) {
      setEditError(updateError.message)
      return
    }

    setEditVehicle(null)
    load()
  }

  function handleDeleteVehicleClick() {
    if (!editVehicle) return
    setPendingDeleteVehicle(editVehicle)
    setEditVehicle(null)
  }

  async function handleConfirmDeleteVehicle() {
    if (!pendingDeleteVehicle) return
    setDeletingVehicle(true)
    const { error: deleteError } = await supabase.from('vehicles').delete().eq('id', pendingDeleteVehicle.id)
    setDeletingVehicle(false)

    if (deleteError) {
      setError(deleteError.message)
      return
    }

    setPendingDeleteVehicle(null)
    setDetailVehicleId(null)
    load()
  }

  // El PDF va a un bucket privado bajo '<user_id>/...' — esa primera carpeta
  // es lo que la política de Storage compara contra auth.uid() (migración
  // 0022), así que el prefijo no es cosmético.
  async function handleUploadPdf(vehicle: Vehicle, file: File) {
    if (!user) return
    setUploadingPdf(true)
    setError(null)

    const path = `${user.id}/${vehicle.id}-${Date.now()}.pdf`
    const { error: uploadError } = await supabase.storage.from('vehicle-docs').upload(path, file)

    if (uploadError) {
      setUploadingPdf(false)
      setError(uploadError.message)
      return
    }

    // Si ya había una póliza cargada, se borra la anterior — el bucket no
    // tiene por qué acumular versiones que la app nunca vuelve a mostrar.
    if (vehicle.insurance_pdf_path) {
      await supabase.storage.from('vehicle-docs').remove([vehicle.insurance_pdf_path])
    }

    const { error: updateError } = await supabase
      .from('vehicles')
      .update({ insurance_pdf_path: path })
      .eq('id', vehicle.id)
    setUploadingPdf(false)

    if (updateError) {
      setError(updateError.message)
      return
    }
    load()
  }

  // El bucket es privado, así que no hay URL fija que guardar: se firma uno
  // de corta duración en el momento de abrirlo.
  async function handleOpenPdf(vehicle: Vehicle) {
    if (!vehicle.insurance_pdf_path) return
    const { data, error: signError } = await supabase.storage
      .from('vehicle-docs')
      .createSignedUrl(vehicle.insurance_pdf_path, 60)
    if (signError || !data) {
      setError(signError?.message ?? 'No se pudo abrir el PDF.')
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  function openAddExpense(vehicle: Vehicle, kind: VehicleExpenseKind) {
    setExpenseVehicle(vehicle)
    setEditingExpense(null)
    setExpenseKind(kind)
    setExpenseDate(todayDateInput())
    setExpenseTitle('')
    setExpenseDescription('')
    setExpenseOdometer(vehicle.current_km != null ? String(vehicle.current_km) : '')
    setExpenseCostDigits('')
    setExpensePlace('')
    setExpenseError(null)
  }

  function openEditExpense(expense: VehicleExpense) {
    setEditingExpense(expense)
    setExpenseVehicle(null)
    setExpenseKind(expense.kind)
    setExpenseDate(expense.occurred_on)
    setExpenseTitle(expense.title)
    setExpenseDescription(expense.description ?? '')
    setExpenseOdometer(expense.odometer_km != null ? String(expense.odometer_km) : '')
    setExpenseCostDigits(numberToCentsDigits(expense.cost))
    setExpensePlace(expense.place ?? '')
    setExpenseError(null)
  }

  // Igual que getOrCreateLoanCategory en Loans.tsx: la categoría bajo la que
  // caen estos egresos se crea sola la primera vez que se registra uno.
  async function getOrCreateVehicleCategory(): Promise<string> {
    const { data: existing } = await supabase
      .from('categories')
      .select('id')
      .eq('name', VEHICLE_CATEGORY_NAME)
      .limit(1)
      .maybeSingle()
    if (existing) return existing.id

    const { data, error: insertError } = await supabase
      .from('categories')
      .insert({ user_id: user!.id, name: VEHICLE_CATEGORY_NAME, icon: 'car', is_default: false })
      .select()
      .single()
    if (insertError || !data) throw new Error(insertError?.message ?? `No se pudo crear la categoría "${VEHICLE_CATEGORY_NAME}".`)
    return data.id
  }

  async function handleExpenseSubmit(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    setExpenseError(null)

    const costNum = centsToNumber(expenseCostDigits)
    const odometerNum = expenseOdometer ? Number(expenseOdometer) : null

    if (!expenseDate) {
      setExpenseError('Ingresá una fecha.')
      return
    }
    if (!expenseTitle.trim()) {
      setExpenseError('Ingresá un título.')
      return
    }
    if (odometerNum != null && (!Number.isInteger(odometerNum) || odometerNum < 0)) {
      setExpenseError('El kilometraje tiene que ser un entero mayor o igual a 0.')
      return
    }

    const fields = {
      kind: expenseKind,
      occurred_on: expenseDate,
      title: expenseTitle.trim(),
      description: expenseDescription.trim() || null,
      odometer_km: odometerNum,
      cost: costNum,
      place: expensePlace.trim() || null,
    }

    setExpenseSaving(true)

    if (editingExpense) {
      const { error: updateError } = await supabase.from('vehicle_expenses').update(fields).eq('id', editingExpense.id)
      if (updateError) {
        setExpenseSaving(false)
        setExpenseError(updateError.message)
        return
      }
      // Mantiene sincronizada la transacción vinculada (si el gasto tenía
      // costo 0 nunca se creó ninguna, y el update no afecta a nadie).
      await supabase
        .from('transactions')
        .update({ amount: costNum, merchant: fields.title, occurred_at: dateInputToISO(expenseDate) })
        .eq('vehicle_expense_id', editingExpense.id)

      setExpenseSaving(false)
      setEditingExpense(null)
      load()
      return
    }

    if (!expenseVehicle) return

    const { data: newExpense, error: insertError } = await supabase
      .from('vehicle_expenses')
      .insert({ user_id: user.id, vehicle_id: expenseVehicle.id, ...fields })
      .select()
      .single()

    if (insertError || !newExpense) {
      setExpenseSaving(false)
      setExpenseError(insertError?.message ?? 'No se pudo registrar el gasto.')
      return
    }

    // Cada gasto del vehículo se registra también como egreso en
    // Transacciones, linkeado por vehicle_expense_id (on delete cascade en la
    // FK: borrar el gasto o el vehículo entero se lleva la transacción).
    // Un gasto sin costo (ej. un service en garantía) no genera ninguna.
    if (costNum > 0) {
      try {
        const categoryId = await getOrCreateVehicleCategory()
        const { error: txError } = await supabase.from('transactions').insert({
          user_id: user.id,
          amount: costNum,
          currency: 'ARS',
          merchant: fields.title,
          description: `${expenseVehicle.brand} ${expenseVehicle.model}${fields.place ? ` — ${fields.place}` : ''}`,
          category_id: categoryId,
          occurred_at: dateInputToISO(expenseDate),
          type: 'expense',
          source: 'manual',
          needs_review: false,
          vehicle_expense_id: newExpense.id,
        })
        if (txError) throw new Error(txError.message)
      } catch (err) {
        setExpenseSaving(false)
        setExpenseError((err as Error).message)
        return
      }
    }

    // El odómetro del último service también actualiza el km del vehículo si
    // es mayor al que estaba — si no, el recordatorio del próximo service se
    // quedaría midiendo contra un kilometraje viejo.
    if (odometerNum != null && (expenseVehicle.current_km == null || odometerNum > expenseVehicle.current_km)) {
      await supabase.from('vehicles').update({ current_km: odometerNum }).eq('id', expenseVehicle.id)
    }

    setExpenseSaving(false)
    setExpenseVehicle(null)
    load()
  }

  async function handleDeleteExpense(expense: VehicleExpense) {
    const { error: deleteError } = await supabase.from('vehicle_expenses').delete().eq('id', expense.id)
    if (deleteError) {
      setExpenseError(deleteError.message)
      return
    }
    setEditingExpense(null)
    load()
  }

  const expenseModalOpen = expenseVehicle != null || editingExpense != null

  return (
    <div>
      <div className="tx-header">
        <h2>Vehículos</h2>
      </div>

      {error && <p className="error">{error}</p>}

      <button
        type="button"
        className={`tx-form-toggle${formOpen ? ' open' : ''}`}
        onClick={() => setFormOpen((o) => !o)}
        aria-expanded={formOpen}
      >
        <IconPlus size={14} /> Agregar vehículo
        <IconChevronDown size={16} />
      </button>

      <form className={`tx-form${formOpen ? ' open' : ''}`} onSubmit={handleAdd} noValidate>
        <Select
          value={type}
          onChange={(v) => setType(v as VehicleType)}
          options={VEHICLE_TYPE_OPTIONS}
          placeholder="Tipo"
        />
        <input type="text" placeholder="Marca" value={brand} onChange={(e) => setBrand(e.target.value)} />
        <input type="text" placeholder="Modelo" value={model} onChange={(e) => setModel(e.target.value)} />
        <input
          type="text"
          inputMode="numeric"
          placeholder="Año"
          value={year}
          onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
        />
        <input
          type="text"
          placeholder="Patente"
          value={licensePlate}
          onChange={(e) => setLicensePlate(e.target.value.toUpperCase())}
        />
        <input
          type="text"
          inputMode="numeric"
          placeholder="Kilómetros"
          value={currentKm}
          onChange={(e) => setCurrentKm(e.target.value.replace(/\D/g, '').slice(0, 7))}
        />
        {/* Único control nativo que sobrevive en la app: un picker de color no
            se puede reemplazar por una lista propia sin escribir un selector
            entero, y acá alcanza con la muestra que dibuja el navegador. */}
        <input
          type="color"
          className="vehicle-color-input"
          aria-label="Color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
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
      ) : vehicles.length === 0 ? (
        <div className="goal-grid">
          <button type="button" className="goal-card goal-card-empty" onClick={() => setFormOpen(true)}>
            <IconPlus size={22} />
            <span>Cargar tu primer vehículo</span>
          </button>
        </div>
      ) : (
        <div className="goal-grid">
          {vehicles.map((vehicle) => {
            const vehicleExpenses = expensesByVehicle.get(vehicle.id) ?? []
            const alerts = buildVehicleAlerts(vehicle, vehicleExpenses)

            return (
              <div
                key={vehicle.id}
                className="vehicle-card"
                onClick={() => setDetailVehicleId(vehicle.id)}
                role="button"
                tabIndex={0}
              >
                <VehicleSilhouette type={vehicle.type} color={vehicle.color} size={200} />
                <div className="vehicle-card-title">
                  <strong>
                    {vehicle.brand} {vehicle.model}
                  </strong>
                  <span className="vehicle-card-sub">
                    {vehicle.year}
                    {vehicle.license_plate ? ` · ${vehicle.license_plate}` : ''}
                    {vehicle.current_km != null ? ` · ${formatKm(vehicle.current_km)}` : ''}
                  </span>
                </div>
                {alerts.length > 0 && (
                  <div className="vehicle-alerts">
                    {alerts.map((alert) => (
                      <span key={alert.text} className={`vehicle-alert ${alert.level}`}>
                        {alert.text}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {detailVehicle &&
        (() => {
          const vehicleExpenses = expensesByVehicle.get(detailVehicle.id) ?? []
          const services = vehicleExpenses.filter((e) => e.kind === 'service')
          const mechanic = vehicleExpenses.filter((e) => e.kind === 'mechanic')
          const totalCost = vehicleExpenses.reduce((sum, e) => sum + e.cost, 0)
          const lastServiceKm = services
            .filter((e) => e.odometer_km != null)
            .reduce<number | null>((max, e) => (max == null || e.odometer_km! > max ? e.odometer_km! : max), null)
          const nextServiceKm =
            lastServiceKm != null && detailVehicle.service_interval_km
              ? lastServiceKm + detailVehicle.service_interval_km
              : null

          return (
            <Modal wide scroll>
              <div className="vehicle-detail-header">
                <VehicleSilhouette type={detailVehicle.type} color={detailVehicle.color} size={160} />
                <div>
                  <h3>
                    {detailVehicle.brand} {detailVehicle.model}
                  </h3>
                  <p className="vehicle-card-sub">
                    {VEHICLE_TYPE_OPTIONS.find((o) => o.value === detailVehicle.type)?.label} · {detailVehicle.year}
                    {detailVehicle.license_plate ? ` · ${detailVehicle.license_plate}` : ''}
                    {detailVehicle.current_km != null ? ` · ${formatKm(detailVehicle.current_km)}` : ''}
                  </p>
                </div>
                <button type="button" onClick={() => openEditVehicle(detailVehicle)}>
                  Editar
                </button>
              </div>

              <div className="vehicle-panels">
                <section className="vehicle-panel">
                  <div className="vehicle-panel-head">
                    <h4>Consumo</h4>
                    <button type="button" disabled={fetchingSpecs} onClick={() => fetchSpecs(detailVehicle)}>
                      <IconRefresh size={14} /> {fetchingSpecs ? 'Consultando...' : 'Consultar'}
                    </button>
                  </div>
                  {detailVehicle.consumption_l100km != null ? (
                    <>
                      <p className="vehicle-stat">{detailVehicle.consumption_l100km} L/100 km</p>
                      <p className="vehicle-panel-note">
                        {detailVehicle.fuel_type ?? 'Combustible sin especificar'} · dato estimado, editable a mano
                      </p>
                    </>
                  ) : (
                    <p className="empty-state">Sin datos del modelo todavía.</p>
                  )}
                </section>

                <section className="vehicle-panel">
                  <div className="vehicle-panel-head">
                    <h4>Seguro</h4>
                    {detailVehicle.insurance_pdf_path && (
                      <button type="button" onClick={() => handleOpenPdf(detailVehicle)}>
                        <IconDownload size={14} /> Ver póliza
                      </button>
                    )}
                  </div>
                  <p className="vehicle-stat">{detailVehicle.insurance_company ?? 'Sin aseguradora cargada'}</p>
                  <p className="vehicle-panel-note">
                    {detailVehicle.insurance_expires_on
                      ? `Vence el ${formatDateShort(detailVehicle.insurance_expires_on)}`
                      : 'Sin vencimiento cargado'}
                    {detailVehicle.vtv_expires_on ? ` · VTV ${formatDateShort(detailVehicle.vtv_expires_on)}` : ''}
                  </p>
                  <label className="vehicle-file-label">
                    {uploadingPdf ? 'Subiendo...' : detailVehicle.insurance_pdf_path ? 'Reemplazar PDF' : 'Subir PDF'}
                    <input
                      type="file"
                      accept="application/pdf"
                      disabled={uploadingPdf}
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) handleUploadPdf(detailVehicle, file)
                        e.target.value = ''
                      }}
                    />
                  </label>
                </section>

                <section className="vehicle-panel">
                  <div className="vehicle-panel-head">
                    <h4>Services</h4>
                    <button type="button" onClick={() => openAddExpense(detailVehicle, 'service')}>
                      <IconPlus size={14} /> Agregar
                    </button>
                  </div>
                  <p className="vehicle-panel-note">
                    {detailVehicle.service_interval_km
                      ? `Cada ${formatKm(detailVehicle.service_interval_km)}${nextServiceKm != null ? ` · próximo a los ${formatKm(nextServiceKm)}` : ''}`
                      : 'Intervalo del modelo desconocido'}
                  </p>
                  {services.length === 0 ? (
                    <p className="empty-state">Todavía no hay services cargados.</p>
                  ) : (
                    <div className="tx-table-scroll">
                      <table className="tx-table">
                        <thead>
                          <tr>
                            <th>Fecha</th>
                            <th>Detalle</th>
                            <th>Km</th>
                            <th className="tx-amount-header">Costo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {services.map((e) => (
                            <tr key={e.id} onDoubleClick={() => openEditExpense(e)}>
                              <td>{formatDateShort(e.occurred_on)}</td>
                              <td>
                                {e.title}
                                {e.place ? ` · ${e.place}` : ''}
                              </td>
                              <td>{e.odometer_km != null ? formatKm(e.odometer_km) : '—'}</td>
                              <td className="tx-amount">{formatMoney(e.cost)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section className="vehicle-panel">
                  <div className="vehicle-panel-head">
                    <h4>Mecánico</h4>
                    <button type="button" onClick={() => openAddExpense(detailVehicle, 'mechanic')}>
                      <IconPlus size={14} /> Agregar
                    </button>
                  </div>
                  {mechanic.length === 0 ? (
                    <p className="empty-state">Todavía no hay visitas cargadas.</p>
                  ) : (
                    <div className="tx-table-scroll">
                      <table className="tx-table">
                        <thead>
                          <tr>
                            <th>Fecha</th>
                            <th>Título</th>
                            <th>Descripción</th>
                            <th className="tx-amount-header">Costo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {mechanic.map((e) => (
                            <tr key={e.id} onDoubleClick={() => openEditExpense(e)}>
                              <td>{formatDateShort(e.occurred_on)}</td>
                              <td>{e.title}</td>
                              <td>{e.description ?? '—'}</td>
                              <td className="tx-amount">{formatMoney(e.cost)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </div>

              <p className="vehicle-panel-note">
                Gasto total registrado en este vehículo: <strong>{formatMoney(totalCost)}</strong>
              </p>

              <div className="modal-actions">
                <button type="button" onClick={() => setDetailVehicleId(null)}>
                  Cerrar
                </button>
              </div>
            </Modal>
          )
        })()}

      {editVehicle && (
        <Modal>
          <h3>Editar vehículo</h3>
          <form className="budget-form" onSubmit={handleEditVehicleSubmit} noValidate>
            <Select
              value={editType}
              onChange={(v) => setEditType(v as VehicleType)}
              options={VEHICLE_TYPE_OPTIONS}
              placeholder="Tipo"
            />
            <input type="text" placeholder="Marca" value={editBrand} onChange={(e) => setEditBrand(e.target.value)} />
            <input type="text" placeholder="Modelo" value={editModel} onChange={(e) => setEditModel(e.target.value)} />
            <input
              type="text"
              inputMode="numeric"
              placeholder="Año"
              value={editYear}
              onChange={(e) => setEditYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
            />
            <input
              type="text"
              placeholder="Patente"
              value={editLicensePlate}
              onChange={(e) => setEditLicensePlate(e.target.value.toUpperCase())}
            />
            <input
              type="text"
              inputMode="numeric"
              placeholder="Kilómetros"
              value={editCurrentKm}
              onChange={(e) => setEditCurrentKm(e.target.value.replace(/\D/g, '').slice(0, 7))}
            />
            <input
              type="color"
              className="vehicle-color-input"
              aria-label="Color"
              value={editColor}
              onChange={(e) => setEditColor(e.target.value)}
            />
            <input
              type="text"
              inputMode="decimal"
              placeholder="Consumo (L/100 km)"
              value={editConsumption}
              onChange={(e) => setEditConsumption(e.target.value.replace(/[^\d.]/g, '').slice(0, 5))}
            />
            <input
              type="text"
              inputMode="numeric"
              placeholder="Service cada (km)"
              value={editServiceInterval}
              onChange={(e) => setEditServiceInterval(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            <input
              type="text"
              placeholder="Aseguradora"
              value={editInsuranceCompany}
              onChange={(e) => setEditInsuranceCompany(e.target.value)}
            />
            <label className="vehicle-field-label">Vencimiento de la póliza</label>
            <DateField value={editInsuranceExpires} onChange={setEditInsuranceExpires} />
            <label className="vehicle-field-label">Vencimiento de la VTV</label>
            <DateField value={editVtvExpires} onChange={setEditVtvExpires} />
            {editError && <p className="error">{editError}</p>}
            <div className="modal-actions">
              <button type="button" className="danger modal-actions-start" onClick={handleDeleteVehicleClick}>
                Eliminar vehículo
              </button>
              <button type="button" onClick={() => setEditVehicle(null)}>
                Cancelar
              </button>
              <button type="submit" className="primary" disabled={editSaving}>
                {editSaving ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {expenseModalOpen && (
        <Modal>
          <h3>
            {editingExpense ? 'Editar' : 'Agregar'} {expenseKind === 'service' ? 'service' : 'visita al mecánico'}
          </h3>
          <form className="budget-form" onSubmit={handleExpenseSubmit} noValidate>
            <div className="type-toggle" role="group" aria-label="Tipo de gasto">
              <button
                type="button"
                className={expenseKind === 'service' ? 'active' : ''}
                onClick={() => setExpenseKind('service')}
              >
                <IconWrench size={14} /> Service
              </button>
              <button
                type="button"
                className={expenseKind === 'mechanic' ? 'active' : ''}
                onClick={() => setExpenseKind('mechanic')}
              >
                Mecánico
              </button>
            </div>
            <DateField value={expenseDate} onChange={setExpenseDate} />
            <input
              type="text"
              placeholder="Título"
              value={expenseTitle}
              onChange={(e) => setExpenseTitle(e.target.value)}
            />
            <input
              type="text"
              placeholder="Descripción"
              value={expenseDescription}
              onChange={(e) => setExpenseDescription(e.target.value)}
            />
            <input
              type="text"
              inputMode="numeric"
              placeholder="Kilómetros"
              value={expenseOdometer}
              onChange={(e) => setExpenseOdometer(e.target.value.replace(/\D/g, '').slice(0, 7))}
            />
            <input
              type="text"
              inputMode="numeric"
              className="amount-input"
              placeholder="Costo"
              value={formatAmountDigits(expenseCostDigits)}
              onChange={(e) => setExpenseCostDigits(e.target.value.replace(/\D/g, '').slice(0, 12))}
            />
            <input type="text" placeholder="Lugar" value={expensePlace} onChange={(e) => setExpensePlace(e.target.value)} />
            {expenseError && <p className="error">{expenseError}</p>}
            <div className="modal-actions">
              {editingExpense && (
                <button
                  type="button"
                  className="danger modal-actions-start"
                  onClick={() => handleDeleteExpense(editingExpense)}
                >
                  Eliminar
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setExpenseVehicle(null)
                  setEditingExpense(null)
                }}
              >
                Cancelar
              </button>
              <button type="submit" className="primary" disabled={expenseSaving}>
                {expenseSaving ? 'Guardando...' : editingExpense ? 'Guardar cambios' : 'Agregar'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {pendingDeleteVehicle && (
        <Modal>
          <h3>Eliminar vehículo</h3>
          <p>
            Se va a eliminar {pendingDeleteVehicle.brand} {pendingDeleteVehicle.model} junto con todos sus services,
            visitas al mecánico y las transacciones que hayan generado. Esta acción no se puede deshacer.
          </p>
          <div className="modal-actions">
            <button type="button" onClick={() => setPendingDeleteVehicle(null)}>
              Cancelar
            </button>
            <button type="button" className="danger" disabled={deletingVehicle} onClick={handleConfirmDeleteVehicle}>
              {deletingVehicle ? 'Eliminando...' : 'Eliminar'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
