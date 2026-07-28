import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getUserIdFromRequest, supabaseAdmin } from '../_lib/supabaseAdmin.js'
import { scanGmailForUser } from '../_lib/scanGmailForUser.js'

// Botón "Traer de Gmail" en Transacciones: dispara el mismo escaneo
// incremental que el cron (solo mails nuevos desde el último last_scanned_at),
// pero al toque y para un único usuario — el que está logueado.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const userId = await getUserIdFromRequest(req.headers.authorization)
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const admin = supabaseAdmin()
  const { data: conn, error } = await admin
    .from('gmail_connections')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  if (!conn) {
    res.status(400).json({ error: 'No hay una cuenta de Gmail conectada.' })
    return
  }

  try {
    const result = await scanGmailForUser(admin, conn)
    res.status(200).json({ result })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
}
