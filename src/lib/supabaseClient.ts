import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copiá .env.example a .env.local y completá los valores.',
  )
}

// Sin generic `Database`: hasta que exista un proyecto Supabase real, se
// puede regenerar con `supabase gen types typescript` (ver README). Mientras
// tanto tipamos manualmente en el punto de uso con los tipos de src/types.
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Gmail readonly es un scope "sensible" de Google: requiere access_type=offline
// y prompt=consent para que Google devuelva un refresh_token reutilizable,
// que guardamos server-side para poder escanear la casilla en background.
const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'

export async function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      scopes: `openid email profile ${GMAIL_READONLY_SCOPE}`,
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  })
}
