import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'
import { syncTelegramForUser, type TelegramSyncResult } from '../_lib/telegramSync.js'

// Disparado por Vercel Cron (ver vercel.ts), protegido con CRON_SECRET igual
// que scan-gmail.
//
// Solo recorre filas que ya existen en telegram_sync_state: la primera
// sincronización de un chat la tiene que hacer el usuario desde la UI (ver
// api/telegram/sync.ts), porque es el único punto donde hay un JWT que ate el
// chat a un user_id.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const admin = supabaseAdmin()
  const { data: states, error } = await admin
    .from('telegram_sync_state')
    .select('user_id, chat_id, last_message_id, backfill_cursor, backfill_done')
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  const results: Record<string, TelegramSyncResult | string> = {}

  for (const state of states ?? []) {
    try {
      results[`${state.user_id}:${state.chat_id}`] = await syncTelegramForUser(admin, state)
    } catch (err) {
      results[`${state.user_id}:${state.chat_id}`] = `error: ${(err as Error).message}`
    }
  }

  res.status(200).json({ synced: states?.length ?? 0, results })
}
