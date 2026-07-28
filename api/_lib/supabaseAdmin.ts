import { createClient } from '@supabase/supabase-js'

// Service role: bypassa RLS. Solo se usa server-side (funciones de Vercel),
// nunca se expone al cliente. Sin generic `Database` por el mismo motivo que
// en src/lib/supabaseClient.ts (ver ese archivo).
export function supabaseAdmin() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function getUserIdFromRequest(authHeader: string | undefined) {
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice('Bearer '.length)
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!)
  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) return null
  return data.user.id
}
