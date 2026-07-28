import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabaseClient'

export default function Layout() {
  const { user } = useAuth()

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="brand">MoneyTracker</span>
        <nav className="tabs">
          <NavLink to="/" end>
            Transacciones
          </NavLink>
          <NavLink to="/budgets">Presupuestos</NavLink>
          <NavLink to="/investments">Inversiones</NavLink>
        </nav>
        <div className="user-menu">
          <span>{user?.email}</span>
          <button onClick={() => supabase.auth.signOut()}>Salir</button>
        </div>
      </header>
      <main className="app-content">
        <Outlet />
      </main>
    </div>
  )
}
