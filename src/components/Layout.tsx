import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabaseClient'
import {
  IconBank,
  IconChevronDown,
  IconHome,
  IconLogout,
  IconPiggyBank,
  IconReceipt,
  IconSettings,
  IconTrendingUp,
  IconWallet,
} from './icons'

const COLLAPSE_KEY = 'sidebarCollapsed'

export default function Layout() {
  const { user } = useAuth()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1')
  // Menú desplegable en mobile: siempre arranca cerrado, no se persiste
  // (a diferencia de `collapsed`, que es la preferencia de sidebar angosta
  // en desktop — son dos conceptos independientes que conviven en el mismo
  // <aside>, ver media query en index.css).
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
  }, [collapsed])

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  return (
    <div className="app-shell gradient-bg">
      <aside className={`sidebar${collapsed ? ' collapsed' : ''}${mobileOpen ? ' mobile-open' : ''}`}>
        <div
          className="sidebar-brand"
          onClick={() => setMobileOpen((o) => !o)}
          role="button"
          tabIndex={0}
          aria-label={mobileOpen ? 'Cerrar menú' : 'Abrir menú'}
          aria-expanded={mobileOpen}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setMobileOpen((o) => !o)
            }
          }}
        >
          <span className="brand nav-label">AutoGasto</span>
          <button
            type="button"
            className="sidebar-toggle"
            onClick={(e) => {
              e.stopPropagation()
              setCollapsed((c) => !c)
            }}
            aria-label={collapsed ? 'Expandir menú' : 'Colapsar menú'}
          >
            <IconChevronDown size={16} />
          </button>
          <span className={`mobile-menu-toggle${mobileOpen ? ' open' : ''}`} aria-hidden="true">
            <IconChevronDown size={20} />
          </span>
        </div>
        <nav className="sidebar-nav">
          <NavLink to="/" end className="nav-btn">
            <IconHome /> <span className="nav-label">Inicio</span>
          </NavLink>
          <NavLink to="/transactions" className="nav-btn">
            <IconReceipt /> <span className="nav-label">Transacciones</span>
          </NavLink>
          <NavLink to="/budgets" className="nav-btn">
            <IconWallet /> <span className="nav-label">Presupuestos</span>
          </NavLink>
          <NavLink to="/investments" className="nav-btn">
            <IconTrendingUp /> <span className="nav-label">Inversiones</span>
          </NavLink>
          <NavLink to="/loans" className="nav-btn">
            <IconBank /> <span className="nav-label">Préstamos</span>
          </NavLink>
          <NavLink to="/goals" className="nav-btn">
            <IconPiggyBank /> <span className="nav-label">Objetivos</span>
          </NavLink>
          <NavLink to="/settings" className="nav-btn">
            <IconSettings /> <span className="nav-label">Configuración</span>
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
