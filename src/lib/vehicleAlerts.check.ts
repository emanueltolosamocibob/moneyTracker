import assert from 'node:assert/strict'
import type { Vehicle, VehicleExpense } from '../types/database'
// Extensión .ts explícita: Node lo carga como ESM nativo y, igual que los
// imports bajo api/, no resuelve especificadores relativos sin extensión.
// tsconfig.app.json ya tiene allowImportingTsExtensions, así que compila igual.
import { buildVehicleAlerts } from './vehicleAlerts.ts'

// Check de buildVehicleAlerts. No hay framework de tests en el repo y no hace
// falta uno: Node 24 corre TypeScript directo, así que esto es
//
//   node --experimental-strip-types src/lib/vehicleAlerts.check.ts
//
// y falla con exit code distinto de 0 si algún assert no da.

const TODAY = new Date(2026, 7, 12) // 12/8/2026, fijo para que no dependa del día

function vehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 'v1',
    user_id: 'u1',
    type: 'car',
    brand: 'Toyota',
    model: 'Corolla',
    year: 2020,
    color: '#c0c4cc',
    license_plate: null,
    current_km: null,
    consumption_l100km: null,
    service_interval_km: null,
    fuel_type: null,
    insurance_company: null,
    insurance_pdf_path: null,
    insurance_expires_on: null,
    vtv_expires_on: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function service(odometer_km: number | null): VehicleExpense {
  return {
    id: `e${odometer_km}`,
    user_id: 'u1',
    vehicle_id: 'v1',
    kind: 'service',
    occurred_on: '2026-01-01',
    title: 'Service',
    description: null,
    odometer_km,
    cost: 0,
    place: null,
    created_at: '2026-01-01T00:00:00Z',
  }
}

// Sin datos suficientes no se inventa ningún aviso.
assert.deepEqual(buildVehicleAlerts(vehicle(), [], TODAY), [])
// Falta el intervalo del modelo: hay service cargado pero no con qué comparar.
assert.deepEqual(buildVehicleAlerts(vehicle({ current_km: 50_000 }), [service(40_000)], TODAY), [])
// Falta el kilometraje actual.
assert.deepEqual(buildVehicleAlerts(vehicle({ service_interval_km: 10_000 }), [service(40_000)], TODAY), [])

// Próximo service lejos (falta más de SERVICE_WARNING_KM): sin aviso.
assert.deepEqual(
  buildVehicleAlerts(vehicle({ current_km: 42_000, service_interval_km: 10_000 }), [service(40_000)], TODAY),
  [],
)

// Justo en el umbral de 1000 km: avisa en warning.
const nearService = buildVehicleAlerts(
  vehicle({ current_km: 49_000, service_interval_km: 10_000 }),
  [service(40_000)],
  TODAY,
)
assert.equal(nearService.length, 1)
assert.equal(nearService[0].level, 'warning')

// Pasado el próximo service: danger.
const overdueService = buildVehicleAlerts(
  vehicle({ current_km: 51_000, service_interval_km: 10_000 }),
  [service(40_000)],
  TODAY,
)
assert.equal(overdueService[0].level, 'danger')

// El service que cuenta es el de mayor odómetro, no el último insertado —
// las filas llegan ordenadas por fecha, que no siempre coincide.
const outOfOrder = buildVehicleAlerts(
  vehicle({ current_km: 51_000, service_interval_km: 10_000 }),
  [service(45_000), service(30_000)],
  TODAY,
)
assert.equal(outOfOrder.length, 0, 'debe usar el service de 45.000 km, no el de 30.000')

// Un service sin odómetro cargado no rompe ni cuenta como base.
assert.deepEqual(
  buildVehicleAlerts(vehicle({ current_km: 51_000, service_interval_km: 10_000 }), [service(null)], TODAY),
  [],
)

// Vencimientos: dentro de los 30 días avisa, más lejos no, y vencido es danger.
assert.deepEqual(buildVehicleAlerts(vehicle({ insurance_expires_on: '2026-12-01' }), [], TODAY), [])

const soon = buildVehicleAlerts(vehicle({ insurance_expires_on: '2026-08-20' }), [], TODAY)
assert.equal(soon.length, 1)
assert.equal(soon[0].level, 'warning')
assert.match(soon[0].text, /Póliza vence en 8 días/)

const tomorrow = buildVehicleAlerts(vehicle({ vtv_expires_on: '2026-08-13' }), [], TODAY)
assert.match(tomorrow[0].text, /VTV vence en 1 día$/, 'singular, no "1 días"')

const expired = buildVehicleAlerts(vehicle({ insurance_expires_on: '2026-08-11' }), [], TODAY)
assert.equal(expired[0].level, 'danger')

// Vence hoy: todavía cuenta como vigente (0 días), no como vencido.
const expiresToday = buildVehicleAlerts(vehicle({ insurance_expires_on: '2026-08-12' }), [], TODAY)
assert.equal(expiresToday[0].level, 'warning')

// Los avisos se acumulan: service vencido + póliza + VTV.
const all = buildVehicleAlerts(
  vehicle({
    current_km: 51_000,
    service_interval_km: 10_000,
    insurance_expires_on: '2026-08-11',
    vtv_expires_on: '2026-08-20',
  }),
  [service(40_000)],
  TODAY,
)
assert.equal(all.length, 3)

console.log('vehicleAlerts: OK')
