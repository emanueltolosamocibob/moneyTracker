import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { signInWithGoogle } from '../lib/supabaseClient'

export default function Login() {
  const { user, loading } = useAuth()

  if (loading) return null
  if (user) return <Navigate to="/" replace />

  return (
    <div className="auth-screen gradient-bg">
      <div className="auth-card">
        <h1>
          Tus gastos,
          <br />
          en piloto
          <br />
          automático.
        </h1>
        <p>Seguimiento de gastos personales, detectados solos a partir de tu Gmail.</p>
        <button className="google-btn" onClick={() => signInWithGoogle()}>
          Continuar con Google
        </button>
        <p className="auth-note">
          Vamos a pedirte acceso de solo lectura a Gmail para detectar mails de
          confirmación de pagos. Nunca enviamos ni modificamos correos.
        </p>
      </div>
    </div>
  )
}
