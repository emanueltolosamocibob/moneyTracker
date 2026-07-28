import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabaseClient'

export default function Layout() {
  const { user } = useAuth()

  return (
    <div className="app-shell gradient-bg">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand">MoneyTracker</span>
        </div>
        <nav className="sidebar-nav">
          <NavLink to="/" end className="nav-btn">
            Transacciones
          </NavLink>
          <NavLink to="/budgets" className="nav-btn">
            Presupuestos
          </NavLink>
          <NavLink to="/investments" className="nav-btn">
            Inversiones
          </NavLink>
        </nav>
        <div className="sidebar-user">
          <span>{user?.email}</span>
          <button onClick={() => supabase.auth.signOut()}>Salir</button>
        </div>
      </aside>
      <main className="app-content">
        <Outlet />
      </main>
    </div>
  )
}
