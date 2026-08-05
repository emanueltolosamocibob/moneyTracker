import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'
import { processMessage } from '../_lib/paperTrading.js'

// Punto de entrada del listener local de Telegram (scripts/telegram-paper-listener.mjs).
//
// A diferencia de api/telegram/sync.ts (que corre MTProto adentro de la
// función de Vercel, disparado por un botón o el cron diario), este endpoint
// no habla con Telegram — solo recibe lo que el listener ya leyó. La razón
// de tener un proceso local aparte para esto es la directiva de que las
// alertas se actúen en tiempo real: el cron del plan Hobby corre 1 vez por
// día, y una alerta de compra evaluada 24hs tarde ya no es la misma decisión
// que la que el canal proponía.
//
// Se autentica con un secreto compartido (TELEGRAM_INGEST_SECRET), no con el
// JWT del usuario: el listener es un proceso headless en la máquina del
// usuario, sin sesión de Supabase. Mismo criterio que CRON_SECRET para
// /api/cron/scan-gmail.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.TELEGRAM_INGEST_SECRET
  if (!secret) {
    res.status(500).json({ error: 'Falta TELEGRAM_INGEST_SECRET en el servidor.' })
    return
  }
  if (req.headers['x-ingest-secret'] !== secret) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const admin = supabaseAdmin()

  // GET: el listener pregunta desde qué mensaje seguir antes de arrancar (o
  // al reconectar), así no vuelve a mandar mensajes que ya se guardaron.
  if (req.method === 'GET') {
    const userId = typeof req.query.userId === 'string' ? req.query.userId : null
    const chatId = typeof req.query.chatId === 'string' ? req.query.chatId : null
    if (!userId || !chatId) {
      res.status(400).json({ error: 'Faltan userId o chatId.' })
      return
    }
    const { data } = await admin.from('telegram_sync_state').select('last_message_id, chat_title').eq('user_id', userId).eq('chat_id', chatId).maybeSingle()
    res.status(200).json({ lastMessageId: data?.last_message_id ?? null, chatTitle: data?.chat_title ?? null })
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { userId, chatId, chatTitle, messageId, sentAt, sender, text, checkpointOnly } = (req.body ?? {}) as {
    userId?: string
    chatId?: string
    chatTitle?: string
    messageId?: number
    sentAt?: string
    sender?: string | null
    text?: string
    checkpointOnly?: boolean
  }

  if (!userId || !chatId || !messageId) {
    res.status(400).json({ error: 'Faltan campos: userId, chatId, messageId.' })
    return
  }

  // Fijar el cursor sin procesar nada: lo usa el listener en su primera
  // corrida para un chat nuevo, para anclarse al mensaje más reciente del
  // canal SIN traer el historial completo hacia atrás. Traer todo el
  // historial abriría posiciones hoy, a precio de hoy, para alertas de meses
  // atrás — un resultado sin sentido para el experimento. Los mensajes
  // realmente nuevos sí se procesan normalmente vía el POST de abajo.
  if (checkpointOnly) {
    const { error } = await admin.from('telegram_sync_state').upsert(
      { user_id: userId, chat_id: chatId, chat_title: chatTitle ?? null, last_message_id: messageId, last_synced_at: new Date().toISOString() },
      { onConflict: 'user_id,chat_id' },
    )
    if (error) {
      res.status(500).json({ error: error.message })
      return
    }
    res.status(200).json({ ok: true })
    return
  }

  if (!sentAt || !text) {
    res.status(400).json({ error: 'Faltan campos: sentAt, text.' })
    return
  }

  // Guardar el mensaje crudo en la misma tabla que usa el sync por Vercel
  // (telegram_messages): un solo repositorio de mensajes, sea cual sea el
  // camino por el que llegaron. ignoreDuplicates porque re-enviar un mensaje
  // ya visto (reconexión del listener, reintento) tiene que ser un no-op.
  const { error: storeError } = await admin
    .from('telegram_messages')
    .upsert(
      { user_id: userId, chat_id: chatId, message_id: messageId, sent_at: sentAt, sender: sender ?? null, text },
      { onConflict: 'user_id,chat_id,message_id', ignoreDuplicates: true },
    )
  if (storeError) {
    res.status(500).json({ error: storeError.message })
    return
  }

  // Actualiza únicamente el cursor incremental, nunca el estado de backfill:
  // ese lo maneja telegramSync.ts, y no queremos que el listener interfiera
  // si un backfill está en curso. `upsert` con los tres campos de backfill en
  // sus valores actuales evita pisarlos con null en la primera corrida del
  // listener si todavía no hay fila (caso borde: usuario arranca el listener
  // antes de tocar "Sincronizar" alguna vez).
  const { data: existing } = await admin.from('telegram_sync_state').select('last_message_id, backfill_cursor, backfill_done').eq('user_id', userId).eq('chat_id', chatId).maybeSingle()
  if (!existing || (existing.last_message_id ?? 0) < messageId) {
    await admin.from('telegram_sync_state').upsert(
      {
        user_id: userId,
        chat_id: chatId,
        chat_title: chatTitle ?? null,
        last_message_id: messageId,
        backfill_cursor: existing?.backfill_cursor ?? null,
        backfill_done: existing?.backfill_done ?? false,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,chat_id' },
    )
  }

  try {
    const result = await processMessage(admin, userId, chatId, { message_id: messageId, sent_at: sentAt, text })
    res.status(200).json({ result })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
}
