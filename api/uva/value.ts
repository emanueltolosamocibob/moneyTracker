import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getUserIdFromRequest } from '../_lib/supabaseAdmin.js'

interface UvaRow {
  fecha: string
  valor: number
}

// La serie completa no trae filtro por fecha en el endpoint de origen, así
// que se trae entera y se cachea en memoria del lambda — BCRA solo agrega
// un valor por día, no vale la pena pegarle a la API en cada registro de
// cuota.
let cache: { rows: UvaRow[]; fetchedAt: number } | null = null
const CACHE_TTL_MS = 60 * 60 * 1000

async function getUvaSeries(): Promise<UvaRow[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.rows
  const res = await fetch('https://api.argentinadatos.com/v1/finanzas/indices/uva')
  if (!res.ok) throw new Error('No se pudo obtener la serie de UVA.')
  const rows = (await res.json()) as UvaRow[]
  cache = { rows, fetchedAt: Date.now() }
  return rows
}

// Valor de la UVA en pesos para la fecha de una cuota — usado al registrar
// un pago de un préstamo en UVA (ver handlePaySubmit en Loans.tsx), para
// convertir la cantidad de UVAs pagada a su equivalente en pesos del día.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const userId = await getUserIdFromRequest(req.headers.authorization)
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const date = typeof req.query.date === 'string' ? req.query.date : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: 'Parámetro date inválido (se espera YYYY-MM-DD).' })
    return
  }

  let rows: UvaRow[]
  try {
    rows = await getUvaSeries()
  } catch (err) {
    res.status(502).json({ error: (err as Error).message })
    return
  }

  // BCRA no siempre publica un valor para cada fecha (fines de semana,
  // feriados) — se usa el último valor disponible en o antes de la fecha
  // pedida, mismo criterio que usaría un banco real para una cuota que
  // cae en un día no hábil.
  const onOrBefore = rows.filter((r) => r.fecha <= date).sort((a, b) => (a.fecha < b.fecha ? 1 : -1))
  const match = onOrBefore[0]
  if (!match) {
    res.status(404).json({ error: 'No hay valor de UVA disponible para esa fecha.' })
    return
  }

  res.status(200).json({ date: match.fecha, value: match.valor })
}
