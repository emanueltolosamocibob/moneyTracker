import type { VercelConfig } from '@vercel/config/v1'

export const config: VercelConfig = {
  framework: 'vite',
  buildCommand: 'npm run build',
  outputDirectory: 'dist',
  crons: [
    // Cada 30 min. En el plan Hobby, Vercel puede forzar una frecuencia
    // mínima menor (ej. 1/día) — ajustar si el deploy lo rechaza.
    { path: '/api/cron/scan-gmail', schedule: '*/30 * * * *' },
  ],
}
