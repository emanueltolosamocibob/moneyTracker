import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getUserIdFromRequest } from '../_lib/supabaseAdmin.js'
import { getDailyBars } from '../_lib/priceHistory.js'

const SYMBOL = 'SPY'

// Reemplaza al portfolio simulado (eliminado): un solo número de referencia,
// cuánto lleva el SPY en lo que va del año calendario. getDailyBars trae un
// día de colchón hacia atrás (ver priceHistory.ts), así que se filtra por
// fecha en vez de confiar en el primer elemento devuelto.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await getUserIdFromRequest(req.headers.authorization)
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const year = new Date().getFullYear()
  const startOfYear = `${year}-01-01`
  const bars = (await getDailyBars(SYMBOL, new Date(year, 0, 1))).filter((bar) => bar.date >= startOfYear)

  if (bars.length < 2) {
    res.status(200).json({ changePct: null, fromDate: null, toDate: null })
    return
  }

  const first = bars[0]
  const last = bars[bars.length - 1]
  const changePct = ((last.close - first.close) / first.close) * 100
  res.status(200).json({ changePct, fromDate: first.date, toDate: last.date })
}
