// Configuración de pm2 para correr el listener de Telegram (paper trading)
// como un proceso siempre-vivo en esta máquina — ver scripts/README.md.
//
// pm2 reinicia el proceso solo si se cae (ej. el ENETUNREACH intermitente
// que ya vimos, sin supervisor el proceso moría y quedaba muerto). El
// arranque automático al prender/loguearse la PC lo maneja aparte
// `pm2-windows-startup` (ver el comando `pm2 startup`/`pm2 save`).
//
// --env-file=.env.local (soportado nativo por Node 20+, no hace falta
// dotenv ni la sección `env` de pm2) es la misma forma en la que se corre a
// mano en scripts/README.md — así hay un solo lugar (.env.local) con las
// credenciales, no una copia duplicada acá.
module.exports = {
  apps: [
    {
      name: 'paper-listener',
      script: 'scripts/telegram-paper-listener.mjs',
      interpreter: 'node',
      interpreter_args: '--env-file=.env.local',
      cwd: __dirname,
      // Backoff exponencial entre reintentos, tope 30s: un ENETUNREACH
      // transitorio del propio SO no debería generar una ráfaga de
      // reconexiones a Telegram.
      exp_backoff_restart_delay: 2000,
      max_restarts: 50,
      // Si se reinicia más de 50 veces en menos de 1 minuto, algo más de
      // fondo está roto (credenciales inválidas, etc.) y no tiene sentido
      // seguir reintentando en loop infinito sin que alguien lo vea.
      min_uptime: '30s',
    },
  ],
}
