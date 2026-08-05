import type { Api } from 'telegram'
import { supabaseAdmin } from './supabaseAdmin.js'
import { connectTelegram, resolveChat, chatTitleOf } from './telegramClient.js'

type Admin = ReturnType<typeof supabaseAdmin>

export interface TelegramSyncState {
  user_id: string
  chat_id: string
  last_message_id: number | null
  backfill_cursor: number | null
  backfill_done: boolean
}

export interface TelegramSyncResult {
  phase: 'backfill' | 'incremental'
  fetched: number
  inserted: number
  // Mensajes que llegaron pero no se guardan: media sin epígrafe, avisos de
  // "fulano se unió al grupo", encuestas. Nada de eso es una alerta.
  skipped: number
  hasMore: boolean
  chatTitle: string | null
}

// Un request de Telegram trae hasta 100 mensajes.
const PAGE_SIZE = 100

// Tope por invocación. El backfill de un grupo con años de historial son
// miles de requests: pasarse de los 300s de Vercel corta la corrida a la
// mitad, y pegarle sin freno a Telegram se gana un FLOOD_WAIT. Se corta acá y
// el llamador repite mientras `hasMore` siga en true — mismo patrón que
// BATCH_SIZE/hasMore en scanGmailForUser.ts.
const MAX_PAGES_PER_RUN = 15

// Segundo freno, por tiempo real y no por cantidad: reconectar MTProto ya se
// come unos segundos, y un grupo con mensajes muy largos puede hacer que 15
// páginas tarden bastante más que uno con alertas de dos líneas.
const TIME_BUDGET_MS = 200_000

interface StoredMessage {
  user_id: string
  chat_id: string
  message_id: number
  sent_at: string
  sender: string | null
  text: string
}

// GramJS ya deja resuelto el remitente en la misma respuesta que trae los
// mensajes, así que esto no cuesta requests extra. Puede venir vacío: en
// canales el mensaje lo firma el chat, no una persona.
function senderNameOf(message: Api.Message): string | null {
  const sender = message.sender as { firstName?: string; lastName?: string; username?: string; title?: string } | undefined
  if (!sender) return message.postAuthor ?? null
  if (sender.title) return sender.title
  const full = [sender.firstName, sender.lastName].filter(Boolean).join(' ').trim()
  return full || sender.username || null
}

function toStored(userId: string, chatId: string, message: Api.Message): StoredMessage | null {
  const text = message.message?.trim()
  if (!text) return null
  return {
    user_id: userId,
    chat_id: chatId,
    message_id: message.id,
    // `date` viene en segundos unix, no en milisegundos.
    sent_at: new Date(message.date * 1000).toISOString(),
    sender: senderNameOf(message),
    text,
  }
}

// upsert con ignoreDuplicates en vez de insert: re-sincronizar un tramo ya
// visto (por un reintento, o porque una corrida anterior se cortó justo
// después de insertar pero antes de mover el cursor) tiene que ser un no-op,
// no un 23505 que aborte la tanda entera.
async function storeBatch(admin: Admin, rows: StoredMessage[]) {
  if (rows.length === 0) return
  const { error } = await admin
    .from('telegram_messages')
    .upsert(rows, { onConflict: 'user_id,chat_id,message_id', ignoreDuplicates: true })
  if (error) throw new Error(`No se pudieron guardar los mensajes: ${error.message}`)
}

// Compartido entre el cron (recorre todas las filas de telegram_sync_state) y
// el endpoint manual /api/telegram/sync (solo la del usuario logueado) — ver
// api/cron/sync-telegram.ts y api/telegram/sync.ts.
export async function syncTelegramForUser(admin: Admin, state: TelegramSyncState): Promise<TelegramSyncResult> {
  const startedAt = Date.now()
  const client = await connectTelegram()

  try {
    const entity = await resolveChat(client, state.chat_id)
    const chatTitle = chatTitleOf(entity)

    // Dos fases bien distintas. El backfill camina el historial hacia atrás
    // desde el mensaje más nuevo y puede necesitar muchas invocaciones; el
    // incremental solo trae lo posterior al último id guardado y normalmente
    // termina en una. Nunca corren juntas: hasta que el backfill no llegue al
    // principio del grupo, los mensajes nuevos esperan.
    const phase: 'backfill' | 'incremental' = state.backfill_done ? 'incremental' : 'backfill'

    let fetched = 0
    let inserted = 0
    let skipped = 0
    let hasMore = false

    // Cursor local de la fase backfill: los mensajes se piden con id menor a
    // este. 0 significa "desde el más nuevo".
    let cursor = state.backfill_cursor ?? 0
    let maxSeenId = state.last_message_id ?? 0

    for (let page = 0; page < MAX_PAGES_PER_RUN; page += 1) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        hasMore = true
        break
      }

      const messages: Api.Message[] =
        phase === 'backfill'
          ? await client.getMessages(entity, { limit: PAGE_SIZE, offsetId: cursor })
          : await client.getMessages(entity, { limit: PAGE_SIZE, minId: state.last_message_id ?? 0 })

      if (messages.length === 0) break

      fetched += messages.length
      const rows: StoredMessage[] = []
      for (const message of messages) {
        if (message.id > maxSeenId) maxSeenId = message.id
        // Solo la fase backfill retrocede; en la incremental el cursor no se
        // usa, pero seguir el mínimo no molesta y mantiene la rama simple.
        if (cursor === 0 || message.id < cursor) cursor = message.id
        const row = toStored(state.user_id, state.chat_id, message)
        if (row) rows.push(row)
        else skipped += 1
      }

      await storeBatch(admin, rows)
      inserted += rows.length

      // Telegram devuelve menos de lo pedido solo cuando no queda más de ese
      // lado, así que esto es el fin del historial (backfill) o de lo nuevo
      // (incremental), no una página floja.
      if (messages.length < PAGE_SIZE) break

      // En la fase incremental minId es fijo y GramJS ya pagina internamente
      // hasta el límite pedido: si llenamos la página, queda más para la
      // próxima invocación en vez de reintentar acá con el mismo minId (que
      // traería los mismos mensajes de nuevo).
      if (phase === 'incremental') {
        hasMore = true
        break
      }

      if (page === MAX_PAGES_PER_RUN - 1) hasMore = true
    }

    const backfillDone = phase === 'backfill' ? !hasMore : true

    await admin.from('telegram_sync_state').upsert(
      {
        user_id: state.user_id,
        chat_id: state.chat_id,
        chat_title: chatTitle,
        // El cursor incremental avanza siempre al id más alto visto, incluso
        // durante el backfill: así, cuando el backfill termine, la fase
        // incremental arranca desde el mensaje más nuevo que ya tenemos y no
        // desde cero.
        last_message_id: maxSeenId || null,
        backfill_cursor: backfillDone ? null : cursor,
        backfill_done: backfillDone,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,chat_id' },
    )

    console.log(
      `[telegram-sync] user=${state.user_id} chat=${state.chat_id} phase=${phase} fetched=${fetched} guardados=${inserted} sin_texto=${skipped} hasMore=${hasMore}`,
    )

    return { phase, fetched, inserted, skipped, hasMore, chatTitle }
  } finally {
    // Sin esto la función de Vercel queda con el socket MTProto abierto y el
    // runtime la mantiene viva hasta el timeout aunque ya haya respondido.
    await client.disconnect()
  }
}
