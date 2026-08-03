// Login interactivo de MTProto, para correr UNA sola vez en tu máquina.
//
//   TELEGRAM_API_ID=... TELEGRAM_API_HASH=... node scripts/telegram-login.mjs
//
// (api_id y api_hash salen de https://my.telegram.org → API development tools.)
//
// Telegram exige un código enviado a la app para crear una sesión nueva, así
// que esto no puede correr en Vercel — no hay dónde tipear el código. El
// resultado es un "string session" reutilizable que va como env var
// (TELEGRAM_SESSION) y le permite a las funciones del server reconectarse sin
// volver a pedir código.
//
// Ojo con lo que sale por pantalla: ese string es una credencial de tu cuenta
// de Telegram completa, no de un bot. Tratalo como una contraseña.
import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions/index.js'
import input from 'input'

const apiId = Number(process.env.TELEGRAM_API_ID)
const apiHash = process.env.TELEGRAM_API_HASH

if (!apiId || !apiHash) {
  console.error('Faltan TELEGRAM_API_ID y/o TELEGRAM_API_HASH. Sacalos de https://my.telegram.org.')
  process.exit(1)
}

// Sesión vacía = login desde cero. Si ya tenés una y solo querés volver a
// listar los grupos, pegala acá y el start() de abajo no va a pedir nada.
const session = new StringSession(process.env.TELEGRAM_SESSION ?? '')
const client = new TelegramClient(session, apiId, apiHash, { connectionRetries: 5 })

await client.start({
  phoneNumber: () => input.text('Número de teléfono (con código de país, ej +5491122334455): '),
  phoneCode: () => input.text('Código que te llegó por Telegram: '),
  // Solo se pide si tenés verificación en dos pasos activada.
  password: () => input.password('Contraseña de verificación en dos pasos: '),
  onError: (err) => console.error(err),
})

console.log('\n=== TELEGRAM_SESSION (guardalo como env var en Vercel) ===')
console.log(client.session.save())

console.log('\n=== Tus grupos y canales ===')
const dialogs = await client.getDialogs({ limit: 200 })
for (const dialog of dialogs) {
  if (!dialog.isGroup && !dialog.isChannel) continue
  // El id que necesita el sync es este, tal cual, con el signo — los
  // supergrupos y canales son negativos (-100…).
  console.log(`${String(dialog.id).padEnd(18)} ${dialog.title}`)
}

console.log('\nCopiá el id del grupo de alertas y guardalo como TELEGRAM_CHAT_ID.')
await client.disconnect()
process.exit(0)
