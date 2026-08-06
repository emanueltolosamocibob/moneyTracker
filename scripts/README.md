# Scripts locales

## telegram-login.mjs

Login interactivo de MTProto para Telegram. Se corre **una sola vez**, a
mano, para generar `TELEGRAM_SESSION` y listar los grupos/canales con su ID
(de ahí sale `TELEGRAM_CHAT_ID`):

```bash
TELEGRAM_API_ID=... TELEGRAM_API_HASH=... node scripts/telegram-login.mjs
```

`api_id`/`api_hash` salen gratis de <https://my.telegram.org> → *API
development tools*. Te va a pedir teléfono, el código que llega por Telegram
y, si tenés verificación en dos pasos, esa contraseña — se escribe en tu
terminal y no se guarda en ningún lado.

El session string que imprime al final da acceso completo a tu cuenta de
Telegram: tratalo como una contraseña. Va en `.env.local` (gitignoreado) y en
las env vars del proyecto de Vercel — nunca se sube al repo.

Con esas cuatro variables (`TELEGRAM_API_ID`, `TELEGRAM_API_HASH`,
`TELEGRAM_SESSION`, `TELEGRAM_CHAT_ID`) ya funciona el sync por Vercel (botón
"Sincronizar" en Inversiones + el cron diario).

## seed-demo-transactions.mjs

Script de un solo uso para poblar la pantalla de Transacciones con datos de
prueba. Ver el comentario en la cabecera del archivo.
