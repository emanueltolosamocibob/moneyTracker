import type { VercelConfig } from '@vercel/config/v1'

export const config: VercelConfig = {
  framework: 'vite',
  buildCommand: 'npm run build',
  outputDirectory: 'dist',
  crons: [
    // El plan Hobby de Vercel limita los cron jobs a 1 corrida por día.
    // Corre todos los días a las 09:00 UTC (06:00 ART). Si en algún momento
    // se pasa a Pro, se puede volver a algo más frecuente como '*/30 * * * *'.
    { path: '/api/cron/scan-gmail', schedule: '0 9 * * *' },
  ],
}
