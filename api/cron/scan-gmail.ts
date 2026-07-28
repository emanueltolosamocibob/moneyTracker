import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'
import { scanGmailForUser } from '../_lib/scanGmailForUser.js'

// Disparado por Vercel Cron (ver vercel.ts). Protegido con CRON_SECRET para
// que no cualquiera pueda pegarle al endpoint y quemar cuota de Gmail/LLM.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const admin = supabaseAdmin()
  const { data: connections, error } = await admin.from('gmail_connections').select('*')
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  const results: Record<string, string> = {}

  for (const conn of connections ?? []) {
    try {
      results[conn.user_id] = await scanGmailForUser(admin, conn)
    } catch (err) {
      results[conn.user_id] = `error: ${(err as Error).message}`
    }
  }

  res.status(200).json({ scanned: connections?.length ?? 0, results })
}
