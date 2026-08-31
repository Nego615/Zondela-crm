import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import BrandMark from './BrandMark'
import './shell.css'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/pipeline', label: 'Pipeline' },
  { to: '/companies', label: 'Companies' },
  { to: '/visits', label: 'Site visits' },
  { to: '/follow-ups', label: 'Follow-ups' },
  { to: '/rate-card', label: 'STO rate card' },
  { to: '/templates', label: 'Email templates' },
  { to: '/reports', label: 'Reports' },
]

export default function Shell() {
  const { profile, signOut, isOwner } = useAuth()

  const initials = (profile?.full_name || profile?.email || '?')
    .split(' ')
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <div className="shell">
      <aside className="shell-rail">
        <div className="shell-brand">
          <span className="shell-brand-mark">
            <BrandMark size={22} />
          </span>
          <span className="shell-brand-name">
            Zondela House
            <span className="shell-brand-sub">CRM</span>
          </span>
        </div>

        <nav className="shell-nav">
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

      <main className="shell-main">
        <Outlet />
      </main>
    </div>
  )
}
