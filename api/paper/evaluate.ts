import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getUserIdFromRequest, supabaseAdmin } from '../_lib/supabaseAdmin.js'
import { evaluateOpenPositions } from '../_lib/paperTrading.js'

// Botón "Evaluar ahora" del portfolio simulado en Inversiones: corre la misma
// pasada que el cron diario pero solo para el usuario logueado. Devuelve
// `hasMore` cuando quedaron posiciones discrecionales sin evaluar en esta
// tanda (acotada para no agotar la cuota de Gemini ni el timeout de Vercel);
// el cliente repite hasta que llegue en false, mismo patrón que el escaneo
// de Gmail y el sync de Telegram.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const userId = await getUserIdFromRequest(req.headers.authorization)
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  try {
    const result = await evaluateOpenPositions(supabaseAdmin(), userId)
    res.status(200).json({ result })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
}
