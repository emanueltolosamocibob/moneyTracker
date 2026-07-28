import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getUserIdFromRequest, supabaseAdmin } from '../_lib/supabaseAdmin'

// Llamado desde AuthCallback justo después del OAuth de Google, con el
// refresh_token de Gmail que Supabase capturó en la sesión inicial.
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

  const { refresh_token, email } = req.body ?? {}
  if (!refresh_token || !email) {
    res.status(400).json({ error: 'Missing refresh_token or email' })
    return
  }

  const admin = supabaseAdmin()
  const { error } = await admin.from('gmail_connections').upsert({
    user_id: userId,
    email,
    refresh_token,
    connected_at: new Date().toISOString(),
  })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.status(200).json({ ok: true })
}
