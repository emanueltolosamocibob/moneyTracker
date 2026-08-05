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

## telegram-paper-listener.mjs

Listener en tiempo real del mismo canal, para el portfolio simulado (paper
trading). El sync de arriba corre en Vercel y alcanza para el análisis
retrospectivo, pero el cron del plan Hobby es 1 vez por día — una alerta de
compra actuada 24hs tarde ya no es la misma decisión. Este proceso corre en
tu máquina y reacciona al momento.

Reusa las mismas cuatro variables de arriba (mismo canal, mismas
credenciales) más estas tres:

```
TELEGRAM_INGEST_SECRET=     # openssl rand -hex 32 — el mismo valor en Vercel y acá
PAPER_INGEST_URL=https://<tu-app>.vercel.app/api/paper/ingest-message
PAPER_USER_ID=               # tu user id de Supabase (auth.users.id)
```

`PAPER_USER_ID` sale de Supabase → Authentication → Users, o de la consola
del browser con la app abierta (`(await supabase.auth.getUser()).data.user.id`).

Correrlo:

```bash
node --env-file=.env.local scripts/telegram-paper-listener.mjs
```

Al arrancar se pone al día con lo que se publicó mientras estuvo apagado (el
checkpoint lo lleva el servidor) y después queda escuchando en tiempo real.
Ctrl+C para salir; lo que pase mientras está caído se recupera solo, tanto al
reconectar como en el cron diario de `api/cron/paper-evaluate.ts`.

### Correrlo siempre prendido (pm2)

Para que no dependa de tener una terminal abierta, y para que se reinicie
solo si se cae (una reconexión de red fallida sin supervisor lo mata:
GramJS agota sus reintentos y el proceso termina) o si reiniciás la PC:

```bash
npm install -g pm2 pm2-windows-startup
pm2 start ecosystem.config.cjs   # lee scripts/telegram-paper-listener.mjs + .env.local
pm2 save                          # persiste la lista de procesos
pm2-startup install               # registra el arranque automático de Windows
```

Requiere que `PAPER_INGEST_URL` esté en `.env.local` (no como override
inline de shell) — `ecosystem.config.cjs` corre el script tal cual con
`--env-file=.env.local`, sin variables extra.

Comandos útiles después:

```bash
pm2 logs paper-listener     # ver qué está pasando
pm2 restart paper-listener  # reiniciar a mano
pm2 stop paper-listener     # parar (no se borra el registro de arranque)
```

Sigue dependiendo de que la PC esté prendida y con internet — si la apagás,
el listener para (sin perder nada, recupera al volver a prenderla) pero no
captura nada mientras tanto.

## seed-demo-transactions.mjs

Script de un solo uso para poblar la pantalla de Transacciones con datos de
prueba. Ver el comentario en la cabecera del archivo.
