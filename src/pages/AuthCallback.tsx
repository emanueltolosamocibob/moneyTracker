import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

// Supabase solo expone provider_refresh_token/provider_token en el evento
// inicial de sign-in (no en sesiones restauradas de storage), así que este
// paso tiene que correr una única vez, justo después del redirect de Google.
export default function AuthCallback() {
  const [done, setDone] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function persistGmailConnection() {
      const { data } = await supabase.auth.getSession()
      const session = data.session as (typeof data.session & {
        provider_refresh_token?: string | null
        provider_token?: string | null
      }) | null

      if (session?.provider_refresh_token) {
        try {
          await fetch('/api/gmail/connect', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              refresh_token: session.provider_refresh_token,
              email: session.user.email,
            }),
          })
        } catch (err) {
          console.error('No se pudo guardar la conexión de Gmail', err)
        }
      }

      if (!cancelled) setDone(true)
    }

    persistGmailConnection()
    return () => {
      cancelled = true
    }
  }, [])

  if (!done) return null
  return <Navigate to="/" replace />
}
