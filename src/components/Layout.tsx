import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabaseClient'
import { IconChevronDown, IconLogout, IconReceipt, IconTrendingUp, IconWallet } from './icons'

const COLLAPSE_KEY = 'sidebarCollapsed'

export default function Layout() {
  const { user } = useAuth()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1')

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
  }, [collapsed])

  return (
    <div className="app-shell gradient-bg">
      <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
        <div className="sidebar-brand">
          <span className="brand nav-label">AutoGasto</span>
          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expandir menú' : 'Colapsar menú'}
          >
            <IconChevronDown size={16} />
          </button>
        </div>
        <nav className="sidebar-nav">
          <NavLink to="/" end className="nav-btn">
            <IconReceipt /> <span className="nav-label">Transacciones</span>
          </NavLink>
          <NavLink to="/budgets" className="nav-btn">
            <IconWallet /> <span className="nav-label">Presupuestos</span>
          </NavLink>
          <NavLink to="/investments" className="nav-btn">
            <IconTrendingUp /> <span className="nav-label">Inversiones</span>
          </NavLink>
        </nav>
        <div className="sidebar-user">
          <span className="nav-label">{user?.email}</span>
          <button onClick={() => supabase.auth.signOut()}>
            <IconLogout /> <span className="nav-label">Salir</span>
          </button>
        </div>
      </aside>
      <main className="app-content">
        <Outlet />
      </main>
    </div>
  )
}
