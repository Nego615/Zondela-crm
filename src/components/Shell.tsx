import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import BrandMark from './BrandMark'
import './shell.css'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/companies', label: 'Companies' },
  { to: '/contacts', label: 'Contacts' },
  { to: '/appointments', label: 'Appointments' },
  { to: '/follow-ups', label: 'Follow-ups' },
  { to: '/sto', label: 'STO' },
  { to: '/templates', label: 'Email templates' },
  { to: '/reports', label: 'Reports' },
]

export default function Shell() {
  const { profile, signOut, isOwner } = useAuth()
  const location = useLocation()

  // Only ever true below the 1024px breakpoint; above it the rail is always
  // visible and this state is inert.
  const [menuOpen, setMenuOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLElement>(null)

  // Navigating is the usual way out of the menu, so close on every route
  // change rather than asking each link to remember to.
  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!menuOpen) return

    // Captured now rather than read from the ref during cleanup, when it may
    // already point somewhere else.
    const toggle = toggleRef.current

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)

    // The drawer covers the page; letting the page behind it scroll under a
    // thumb drag is the classic mobile-menu annoyance.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    drawerRef.current?.querySelector<HTMLElement>('a, button')?.focus()

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      // Send focus back where it came from, but not if the user has since
      // moved it somewhere deliberate.
      if (document.activeElement === document.body) toggle?.focus()
    }
  }, [menuOpen])

  // A drawer left open while the viewport grows would keep the page inert and
  // the scrim up under a sidebar that is now permanently visible.
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)')
    const sync = () => {
      if (desktop.matches) setMenuOpen(false)
    }
    desktop.addEventListener('change', sync)
    return () => desktop.removeEventListener('change', sync)
  }, [])

  const initials = (profile?.full_name || profile?.email || '?')
    .split(' ')
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  const brand = (
    <div className="shell-brand">
      <span className="shell-brand-mark">
        <BrandMark size={22} />
      </span>
      <span className="shell-brand-name">
        Zondela House
        <span className="shell-brand-sub">CRM</span>
      </span>
    </div>
  )

  return (
    <div className={`shell${menuOpen ? ' menu-open' : ''}`}>
      <header className="shell-topbar">
        {brand}
        <button
          ref={toggleRef}
          type="button"
          className="shell-menu-toggle"
          aria-expanded={menuOpen}
          aria-controls="shell-drawer"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span className="shell-burger" aria-hidden="true" />
          {menuOpen ? 'Close' : 'Menu'}
        </button>
      </header>

      {menuOpen && (
        <button
          type="button"
          className="shell-scrim"
          aria-label="Close menu"
          tabIndex={-1}
          onClick={() => setMenuOpen(false)}
        />
      )}

      <aside id="shell-drawer" className="shell-rail" ref={drawerRef}>
        {brand}

        <nav className="shell-nav" aria-label="Main">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `shell-nav-item${isActive ? ' active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
          {isOwner && (
            <NavLink
              to="/team"
              className={({ isActive }) => `shell-nav-item${isActive ? ' active' : ''}`}
            >
              Team
            </NavLink>
          )}
        </nav>

        <div className="shell-user">
          <div className="shell-user-avatar">{initials}</div>
          <div className="shell-user-info">
            <div className="shell-user-name">{profile?.full_name || profile?.email}</div>
            <div className="shell-user-role">{profile?.role === 'owner' ? 'Owner' : 'Marketing'}</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={signOut} aria-label="Sign out">
            Sign out
          </button>
        </div>
      </aside>

      {/* inert rather than aria-hidden: it also stops the page behind the
          drawer taking tab focus or a stray tap. */}
      <main className="shell-main" inert={menuOpen}>
        <Outlet />
      </main>
    </div>
  )
}
