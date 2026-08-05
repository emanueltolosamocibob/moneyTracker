import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'
import { evaluateOpenPositions, ingestUnprocessedSignals } from '../_lib/paperTrading.js'

// Disparado por Vercel Cron (ver vercel.ts), después del cierre de los
// mercados de EE.UU. Protegido con el mismo CRON_SECRET que scan-gmail.
//
// El listener local (scripts/telegram-paper-listener.mjs) es el camino
// principal para convertir mensajes nuevos en señales, en tiempo real. Esta
// corrida diaria es la red de seguridad para dos cosas que el listener no
// cubre por sí solo:
//  1. Catch-up: si el listener estuvo apagado, telegramSync.ts (el botón
//     "Sincronizar" o su propio cron) puede haber traído mensajes que nunca
//     pasaron por /api/paper/ingest-message. ingestUnprocessedSignals los
//     agarra desde telegram_messages.
//  2. Evaluación de las estrategias de regla y la discrecional del LLM, que
//     no corren en el listener (necesitan velas diarias ya cerradas).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const admin = supabaseAdmin()
  const { data: states, error } = await admin.from('telegram_sync_state').select('user_id, chat_id')
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  const results: Record<string, unknown> = {}
  for (const state of states ?? []) {
    const key = `${state.user_id}:${state.chat_id}`
    try {
      const catchUp = await ingestUnprocessedSignals(admin, state.user_id, state.chat_id)
      const evaluation = await evaluateOpenPositions(admin, state.user_id)
      results[key] = { catchUp, evaluation }
    } catch (err) {
      results[key] = `error: ${(err as Error).message}`
    }
  }

  res.status(200).json({ users: states?.length ?? 0, results })
}
