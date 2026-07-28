import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'

interface AuthState {
  session: Session | null
  user: User | null
  loading: boolean
}

const AuthContext = createContext<AuthState>({ session: null, user: null, loading: true })

// Solo para probar el UI en local sin pasar por Google: entrar con
// http://localhost:5173/?mock=1. Se elimina por completo del build de
// producción (import.meta.env.DEV es `false` ahí, así que esta rama muere
// en dead-code elimination). No hay sesión real de Supabase, así que
// cualquier query a la base va a volver vacía por RLS.
const MOCK_USER = {
  id: '00000000-0000-0000-0000-000000000000',
  email: 'dev@localhost',
} as User

function useMockAuth() {
  return import.meta.env.DEV && new URLSearchParams(window.location.search).get('mock') === '1'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const mock = useMockAuth()

  useEffect(() => {
    if (mock) {
      setLoading(false)
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    return () => listener.subscription.unsubscribe()
  }, [mock])

  const user = mock ? MOCK_USER : (session?.user ?? null)

  return <AuthContext.Provider value={{ session, user, loading }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
