import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getUserIdFromRequest, supabaseAdmin } from '../_lib/supabaseAdmin.js'
import { evaluateOpenPositions, ingestUnprocessedSignals } from '../_lib/paperTrading.js'

// Botón "Evaluar ahora" del portfolio simulado en Inversiones: corre la misma
// pasada que el cron diario, pero solo para el usuario logueado y al toque.
//
// Antes esto solo evaluaba posiciones ya abiertas — asumía que algo más
// (el listener local, o el cron de las 22:30) ya se había encargado de
// convertir mensajes nuevos de Telegram en señales. Eso se rompe si el
// usuario usa varias PCs y ninguna tiene el listener corriendo: sin él, un
// alerta de compra nueva se queda en telegram_messages como texto crudo y
// nunca abre posición hasta el cron del día siguiente. Por eso ahora este
// endpoint también hace el catch-up (ingestUnprocessedSignals) antes de
// evaluar — junto con el botón "Sincronizar" de TelegramAlerts.tsx (que trae
// los mensajes de Telegram en sí), un click desde cualquier dispositivo
// alcanza para todo el pipeline, sin depender de que una PC puntual esté
// prendida.
//
// Devuelve `hasMore` cuando quedaron posiciones discrecionales sin evaluar
// en esta tanda (acotada para no agotar la cuota de Gemini ni el timeout de
// Vercel); el cliente repite hasta que llegue en false, mismo patrón que el
// escaneo de Gmail y el sync de Telegram.
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

  const admin = supabaseAdmin()

  try {
    const { data: states } = await admin.from('telegram_sync_state').select('chat_id').eq('user_id', userId)
    for (const state of states ?? []) {
      await ingestUnprocessedSignals(admin, userId, state.chat_id)
    }

    const result = await evaluateOpenPositions(admin, userId)
    res.status(200).json({ result })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
}
