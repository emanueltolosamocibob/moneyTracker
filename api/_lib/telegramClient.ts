import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions/index.js'
import type { Entity } from 'telegram/define.js'

// Esto usa MTProto (la API de cliente, la misma que habla Telegram Desktop),
// no la Bot API, y la diferencia no es de comodidad sino de posibilidad: un
// bot no puede leer el historial anterior a su ingreso al grupo, necesita que
// alguien con permisos lo agregue, y arranca con el modo privacidad prendido
// (solo ve mensajes dirigidos a él). Con la cuenta propia alcanza con ser
// miembro del grupo: se lee el historial completo, sin tocar el grupo ni
// avisarle a nadie.
//
// El precio es que TELEGRAM_SESSION es una credencial de la cuenta personal
// del usuario, no de un bot descartable. Vive solo en env vars del server,
// nunca se manda al cliente, y se genera a mano una vez con
// scripts/telegram-login.mjs (Telegram pide un código por app para crear la
// sesión, así que ese paso no puede correr acá).
export async function connectTelegram(): Promise<TelegramClient> {
  const apiId = Number(process.env.TELEGRAM_API_ID)
  const apiHash = process.env.TELEGRAM_API_HASH
  const session = process.env.TELEGRAM_SESSION

  if (!apiId || !apiHash || !session) {
    throw new Error('Faltan TELEGRAM_API_ID, TELEGRAM_API_HASH o TELEGRAM_SESSION.')
  }

  const client = new TelegramClient(new StringSession(session), apiId, apiHash, {
    connectionRetries: 3,
    // Los reintentos de GramJS son con backoff propio; en una función que
    // muere a los 300s no tiene sentido que se quede colgado mucho más que
    // esto esperando a un datacenter que no responde.
    timeout: 30,
  })

  await client.connect()
  if (!(await client.checkAuthorization())) {
    throw new Error('TELEGRAM_SESSION expiró o fue revocada. Volvé a correr scripts/telegram-login.mjs.')
  }
  return client
}

// Los ids de supergrupo/canal vienen con el prefijo -100 y no siempre están en
// la caché de entidades de una sesión recién reconectada, así que getEntity
// solo falla con "Could not find the input entity". Recorrer los diálogos
// puebla esa caché, que es exactamente lo que le falta — por eso el fallback
// no es un reintento ciego sino otro camino.
export async function resolveChat(client: TelegramClient, chatId: string): Promise<Entity> {
  try {
    return await client.getEntity(chatId)
  } catch {
    const dialogs = await client.getDialogs({ limit: 200 })
    const match = dialogs.find((d) => String(d.id) === chatId)
    if (!match?.entity) {
      throw new Error(`No se encontró el chat ${chatId} entre tus grupos. ¿Seguís siendo miembro?`)
    }
    return match.entity
  }
}

export function chatTitleOf(entity: Entity): string | null {
  return 'title' in entity && typeof entity.title === 'string' ? entity.title : null
}
