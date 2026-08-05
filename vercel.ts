import { routes, type VercelConfig } from '@vercel/config/v1'

export const config: VercelConfig = {
  framework: 'vite',
  buildCommand: 'npm run build',
  outputDirectory: 'dist',
  // SPA: cualquier ruta que no matchee un archivo estático o una función de
  // /api (esas tienen prioridad y se resuelven antes que esto) cae en
  // index.html, para que React Router la maneje del lado del cliente.
  rewrites: [routes.rewrite('/(.*)', '/index.html')],
  crons: [
    // El plan Hobby de Vercel limita los cron jobs a 1 corrida por día.
    // Corre todos los días a las 09:00 UTC (06:00 ART). Si en algún momento
    // se pasa a Pro, se puede volver a algo más frecuente como '*/30 * * * *'.
    { path: '/api/cron/scan-gmail', schedule: '0 9 * * *' },
    // Alertas de Telegram. A las 10:00 UTC (07:00 ART) y no junto al de
    // Gmail: los dos abren conexiones lentas hacia afuera y no hay razón
    // para que compitan. Ojo que el plan Hobby también limita la cantidad de
    // cron jobs por proyecto — este es el segundo.
    { path: '/api/cron/sync-telegram', schedule: '0 10 * * *' },
    // Paper trading: 22:30 UTC (19:30 ART), después del cierre de los
    // mercados de EE.UU. (20:00/21:00 UTC según horario de verano), así que
    // la vela diaria del día ya cerró cuando se evalúan las salidas por
    // regla. Es la red de seguridad diaria (catch-up + evaluación); la
    // ingesta en tiempo real corre aparte, en scripts/telegram-paper-listener.mjs.
    { path: '/api/cron/paper-evaluate', schedule: '30 22 * * *' },
  ],
}
