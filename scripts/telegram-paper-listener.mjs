// Listener en tiempo real del canal de alertas, para el portfolio simulado
// (paper trading).
//
//   node --env-file=.env.local scripts/telegram-paper-listener.mjs
//
// Corre en tu máquina, no en Vercel. api/telegram/sync.ts ya sincroniza el
// mismo canal desde una función serverless (botón "Sincronizar" + cron
// diario, ver telegramSync.ts) y sirve perfecto para el análisis
// retrospectivo — pero el cron del plan Hobby corre 1 vez por día, y una
// alerta de compra evaluada 24hs tarde ya no es la misma decisión que la que
// el canal proponía. Este proceso reacciona al momento: apenas llega un
// mensaje nuevo, lo manda a /api/paper/ingest-message, que lo parsea y —si
// es una alerta de compra— abre la posición simulada en todas las
// estrategias a la vez (ver api/_lib/paperStrategies.ts).
//
// Usa las MISMAS credenciales de MTProto que ya generaste con
// scripts/telegram-login.mjs (TELEGRAM_API_ID/HASH/SESSION) y el mismo
// TELEGRAM_CHAT_ID: es el mismo canal, dos consumidores distintos de los
// mismos mensajes. Si el sync por Vercel ya está andando, no hace falta
// volver a loguearse.
//
// Si este proceso se cae, no se pierde nada más que el tiempo real: al
// reconectar pide a /api/paper/ingest-message desde qué mensaje seguir (lo
// lleva el servidor, no un archivo local) y además el cron diario
// (api/cron/paper-evaluate.ts) hace catch-up de cualquier mensaje que haya
// llegado por el sync de Vercel mientras tanto.
import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions/index.js'
import { NewMessage } from 'telegram/events/index.js'

const apiId = Number(process.env.TELEGRAM_API_ID)
const apiHash = process.env.TELEGRAM_API_HASH
const session = process.env.TELEGRAM_SESSION
const chatRef = process.env.TELEGRAM_CHAT_ID
const ingestUrl = process.env.PAPER_INGEST_URL
const ingestSecret = process.env.TELEGRAM_INGEST_SECRET
const userId = process.env.PAPER_USER_ID

const missing = Object.entries({
  TELEGRAM_API_ID: apiId,
  TELEGRAM_API_HASH: apiHash,
  TELEGRAM_SESSION: session,
  TELEGRAM_CHAT_ID: chatRef,
  PAPER_INGEST_URL: ingestUrl,
  TELEGRAM_INGEST_SECRET: ingestSecret,
  PAPER_USER_ID: userId,
})
  .filter(([, v]) => !v)
  .map(([k]) => k)

if (missing.length > 0) {
  console.error(`Faltan variables de entorno: ${missing.join(', ')}`)
  console.error('Ver scripts/README.md. TELEGRAM_SESSION/TELEGRAM_CHAT_ID salen de scripts/telegram-login.mjs.')
  process.exit(1)
}

function senderNameOf(message) {
  const sender = message.sender
  if (!sender) return message.postAuthor ?? null
  if (sender.title) return sender.title
  const full = [sender.firstName, sender.lastName].filter(Boolean).join(' ').trim()
  return full || sender.username || null
}

async function callIngest(method, body) {
  const url = method === 'GET' ? `${ingestUrl}?userId=${encodeURIComponent(userId)}&chatId=${encodeURIComponent(chatId)}` : ingestUrl
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', 'x-ingest-secret': ingestSecret },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`ingest ${method} ${res.status}: ${text}`)
  try {
    return JSON.parse(text)
  } catch {
    // Un cuerpo que no es JSON casi siempre es la página de error de Vercel:
    // suele significar que la función no arrancó (ver la nota sobre las
    // extensiones .js en los imports de api/ en CLAUDE.md).
    throw new Error(`ingest ${method} devolvió algo que no es JSON: ${text.slice(0, 200)}`)
  }
}

let chatId = null
let chatTitle = null

async function sendMessage(message, label) {
  const text = message.message?.trim()
  if (!text) return
  const { result } = await callIngest('POST', {
    userId,
    chatId,
    chatTitle,
    messageId: message.id,
    sentAt: new Date(message.date * 1000).toISOString(),
    sender: senderNameOf(message),
    text,
  })
  if (result.parsed) {
    console.log(
      `[${label}] mensaje ${message.id}: señal de ${result.kind === 'buy' ? 'compra' : 'venta'} ` +
        `(posiciones abiertas: ${result.positionsOpened}, cerradas: ${result.positionsClosed}${result.unpriced ? ', sin cotización' : ''})`,
    )
  } else {
    console.log(`[${label}] mensaje ${message.id}: no es una alerta, descartado`)
  }
}

const client = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 5 })
await client.connect()

// Resolver el chat: se acepta el ID numérico (el que imprime
// scripts/telegram-login.mjs) o parte del título — un canal/grupo privado no
// tiene @usuario que sirva de identificador estable.
let entity = null
for (const dialog of await client.getDialogs({ limit: 200 })) {
  if (!dialog.isChannel && !dialog.isGroup) continue
  const matchesId = String(dialog.id) === String(chatRef)
  const matchesTitle = dialog.title?.toLowerCase().includes(String(chatRef).toLowerCase())
  if (matchesId || matchesTitle) {
    chatId = String(dialog.id)
    chatTitle = dialog.title
    entity = dialog.entity
    break
  }
}

if (!chatId) {
  console.error(`No encontré ningún chat que matchee TELEGRAM_CHAT_ID="${chatRef}". Corré scripts/telegram-login.mjs para ver la lista.`)
  process.exit(1)
}

console.log(`Escuchando "${chatTitle}" en tiempo real...`)

// Catch-up: todo lo publicado mientras el listener estuvo caído. El cursor
// lo lleva el servidor (telegram_sync_state.last_message_id), no un archivo
// local, así que reinstalar o correr el listener desde otra máquina no
// reprocesa nada.
//
// PERO: en la primera corrida para un chat nuevo no hay checkpoint, y
// arrancar desde 0 traería el historial COMPLETO del canal — abriendo hoy,
// al precio de hoy, posiciones para alertas de meses atrás. Sin sentido para
// el experimento (que mide "qué pasa si compro cuando llega la alerta", no
// una entrada retroactiva). Por eso, sin checkpoint previo, el listener se
// ancla al mensaje más reciente del canal y arranca a escuchar desde ahí:
// nada de historial, solo alertas genuinamente nuevas de acá en más.
const { lastMessageId } = await callIngest('GET')
let since = lastMessageId

if (since == null) {
  const [newest] = await client.getMessages(entity, { limit: 1 })
  since = newest?.id ?? 0
  await callIngest('POST', { userId, chatId, chatTitle, messageId: since, checkpointOnly: true })
  console.log(`Primera vez con este canal: arranco desde el mensaje ${since} (ahora), sin traer historial.`)
} else {
  const pending = []
  // reverse:true devuelve del más viejo al más nuevo — importa para no
  // procesar una alerta de venta antes que su compra si las dos llegaron
  // mientras el listener estaba apagado.
  for await (const message of client.iterMessages(entity, { minId: since, reverse: true, limit: 500 })) {
    pending.push(message)
  }

  if (pending.length > 0) {
    console.log(`Poniéndome al día: ${pending.length} mensajes desde el ${since}...`)
    for (const message of pending) {
      await sendMessage(message, 'catch-up')
    }
  } else {
    console.log('Sin mensajes pendientes.')
  }
}

client.addEventHandler(async (event) => {
  try {
    await sendMessage(event.message, 'nuevo')
  } catch (err) {
    // No cortamos el proceso: el mensaje que falló se recupera en el próximo
    // catch-up, porque el checkpoint del servidor no avanzó para éste.
    console.error(`Falló el envío del mensaje ${event.message.id}:`, err.message)
  }
// El filtro `chats` acepta un ID numérico directo (resuelto sin red) o un
// entity/username que resuelve async con getInputEntity — pasar el `entity`
// completo que ya tenemos rompe esa segunda vía en esta versión de gramjs
// ("Cannot find any entity corresponding to [object Object]"). `chatId` (el
// ID numérico como string, con su signo -100…) toma el camino rápido.
}, new NewMessage({ chats: [chatId] }))

console.log('Listo. Esperando alertas nuevas (Ctrl+C para salir).')
