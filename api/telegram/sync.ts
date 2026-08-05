import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getUserIdFromRequest, supabaseAdmin } from '../_lib/supabaseAdmin.js'
import { syncTelegramForUser, type TelegramSyncState } from '../_lib/telegramSync.js'

// Botón "Sincronizar" del bloque de alertas en Inversiones: mismo core que el
// cron, pero al toque y solo para el usuario logueado.
//
// La fila de telegram_sync_state la crea este endpoint la primera vez, no el
// cron: acá es donde hay un JWT del que sacar el user_id. El cron después
// recorre las filas ya existentes (igual que hace con gmail_connections).
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

  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!chatId) {
    res.status(400).json({ error: 'Falta configurar TELEGRAM_CHAT_ID.' })
    return
  }

  const admin = supabaseAdmin()
  const { data: existing, error } = await admin
    .from('telegram_sync_state')
    .select('user_id, chat_id, last_message_id, backfill_cursor, backfill_done')
    .eq('user_id', userId)
    .eq('chat_id', chatId)
    .maybeSingle()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  const state: TelegramSyncState = existing ?? {
    user_id: userId,
    chat_id: chatId,
    last_message_id: null,
    backfill_cursor: null,
    backfill_done: false,
  }

  try {
    const result = await syncTelegramForUser(admin, state)
    res.status(200).json({ result })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
}
