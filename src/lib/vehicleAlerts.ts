import type { Vehicle, VehicleExpense } from '../types/database'

// Un vencimiento (póliza, VTV) empieza a avisar con un mes de anticipación, y
// el service cuando faltan menos de 1000 km.
export const EXPIRY_WARNING_DAYS = 30
export const SERVICE_WARNING_KM = 1000

export interface VehicleAlert {
  level: 'warning' | 'danger'
  text: string
}

function formatKm(km: number) {
  return `${km.toLocaleString('es-AR')} km`
}

// Mismo motivo que en el resto de las páginas: armar la fecha con año/mes/día
// sueltos usa medianoche local, evitando que se corra un día por UTC.
function formatDateShort(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-AR')
}

function daysUntil(dateStr: string, today: Date) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const target = new Date(y, m - 1, d)
  const base = new Date(today)
  base.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - base.getTime()) / 86_400_000)
}

/**
 * Todos los avisos de un vehículo, derivados de sus propios datos — nada de
 * esto se guarda ni se consulta a ningún lado.
 *
 * `today` es un parámetro y no `new Date()` adentro para que el check de
 * vehicleAlerts.check.ts pueda fijar la fecha en vez de depender del día en
 * que se corra.
 */
export function buildVehicleAlerts(
  vehicle: Vehicle,
  expenses: VehicleExpense[],
  today: Date = new Date(),
): VehicleAlert[] {
  const alerts: VehicleAlert[] = []

  // Próximo service = kilometraje del último service + el intervalo del
  // modelo. Si nunca se cargó un service con odómetro, o falta alguno de los
  // dos datos, no hay aviso — no se inventa una base.
  const lastServiceKm = expenses
    .filter((e) => e.kind === 'service' && e.odometer_km != null)
    .reduce<number | null>((max, e) => (max == null || e.odometer_km! > max ? e.odometer_km! : max), null)

  if (lastServiceKm != null && vehicle.service_interval_km && vehicle.current_km != null) {
    const nextServiceKm = lastServiceKm + vehicle.service_interval_km
    const remaining = nextServiceKm - vehicle.current_km
    if (remaining <= 0) {
      alerts.push({ level: 'danger', text: `Service vencido (tocaba a los ${formatKm(nextServiceKm)})` })
    } else if (remaining <= SERVICE_WARNING_KM) {
      alerts.push({ level: 'warning', text: `Service en ${formatKm(remaining)}` })
    }
  }

  for (const [label, date] of [
    ['Póliza', vehicle.insurance_expires_on],
    ['VTV', vehicle.vtv_expires_on],
  ] as const) {
    if (!date) continue
    const days = daysUntil(date, today)
    if (days < 0) alerts.push({ level: 'danger', text: `${label} vencida el ${formatDateShort(date)}` })
    else if (days <= EXPIRY_WARNING_DAYS)
      alerts.push({ level: 'warning', text: `${label} vence en ${days} ${days === 1 ? 'día' : 'días'}` })
  }

  return alerts
}
