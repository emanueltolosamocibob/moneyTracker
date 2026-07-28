// Script de un solo uso: inserta transacciones de prueba para el primer
// usuario real (el que ya se logueó con Google) usando el service role,
// así se puede ver la UI de Transacciones con datos sin esperar al escaneo
// de Gmail real. Correr con:
//   node --env-file=.env scripts/seed-demo-transactions.mjs
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const MERCHANTS = [
  { name: 'Carrefour Express', category: 'Supermercado', method: 'debit_card' },
  { name: 'MERPAGO*PANADERIA', category: 'Supermercado', method: 'transfer' },
  { name: 'Rapipago - EDESUR', category: 'Servicios', method: 'transfer' },
  { name: 'Farmacity', category: 'Salud', method: 'credit_card' },
  { name: 'Cabify', category: 'Transporte', method: 'credit_card' },
  { name: 'YPF Full', category: 'Transporte', method: 'debit_card' },
  { name: 'Netflix.com', category: 'Entretenimiento', method: 'credit_card' },
  { name: 'La Parolaccia', category: 'Restaurantes', method: 'credit_card' },
  { name: 'MERPAGO*LIBRERIA', category: 'Compras', method: 'transfer' },
  { name: 'Cines Hoyts', category: 'Entretenimiento', method: 'debit_card' },
  { name: 'Farmacia del Pueblo', category: 'Salud', method: 'cash' },
  { name: 'Kiosco Don Pepe', category: 'Otros', method: 'cash' },
]

function randomAmount() {
  return Math.round((Math.random() * 45000 + 500) * 100) / 100
}

function randomDateWithinDays(days) {
  const now = Date.now()
  const past = now - Math.random() * days * 24 * 60 * 60 * 1000
  return new Date(past).toISOString()
}

function randomLast4() {
  return String(Math.floor(1000 + Math.random() * 9000))
}

async function main() {
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, email')
    .limit(1)

  if (profilesError) throw profilesError
  if (!profiles?.length) {
    console.error('No hay ningún usuario real todavía (tabla profiles vacía). Logueate una vez con Google primero.')
    process.exit(1)
  }

  const user = profiles[0]
  console.log(`Generando transacciones para ${user.email} (${user.id})`)

  const { data: categories, error: catError } = await supabase
    .from('categories')
    .select('id, name')
    .eq('user_id', user.id)

  if (catError) throw catError
  const categoryByName = Object.fromEntries(categories.map((c) => [c.name, c.id]))

  const rows = Array.from({ length: 10 }, () => {
    const m = MERCHANTS[Math.floor(Math.random() * MERCHANTS.length)]
    const isCard = m.method === 'credit_card' || m.method === 'debit_card'
    const confidence = Math.round((0.4 + Math.random() * 0.6) * 100) / 100
    return {
      user_id: user.id,
      category_id: categoryByName[m.category] ?? null,
      amount: randomAmount(),
      currency: 'ARS',
      merchant: m.name,
      occurred_at: randomDateWithinDays(30),
      type: 'expense',
      source: 'gmail',
      source_email_id: `demo-${crypto.randomUUID()}`,
      category_confidence: confidence,
      needs_review: confidence < 0.6,
      payment_method: m.method,
      card_last4: isCard ? randomLast4() : null,
    }
  })

  const { error: insertError } = await supabase.from('transactions').insert(rows)
  if (insertError) throw insertError

  console.log(`Listo: ${rows.length} transacciones insertadas.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
