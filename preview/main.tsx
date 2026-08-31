/**
 * Entry point for the static preview build only.
 *
 * Differences from src/main.tsx + src/App.tsx, and why:
 *  - HashRouter instead of BrowserRouter, because the preview is served from
 *    a nested path on a static host and path-based routes would 404.
 *  - A role switcher across the top, so per-rep scoping can be seen rather
 *    than described.
 * Every page and component below is imported unchanged from src/.
 */
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from '../src/hooks/useAuth'
import Shell from '../src/components/Shell'
import Dashboard from '../src/pages/Dashboard'
import Pipeline from '../src/pages/Pipeline'
import Companies from '../src/pages/Companies'
import CompanyDetail from '../src/pages/CompanyDetail'
import Visits from '../src/pages/Visits'
import FollowUps from '../src/pages/FollowUps'
import RateCard from '../src/pages/RateCard'
import Templates from '../src/pages/Templates'
import Reports from '../src/pages/Reports'
import Team from '../src/pages/Team'
import { setActingUserId, getActingUserId, listPreviewUsers, resetPreviewData } from './mock-supabase'
import '../src/index.css'
import './preview.css'

function RequireOwner({ children }: { children: React.ReactNode }) {
  const { isOwner, loading } = useAuth()
  if (loading) return null
  if (!isOwner) return <Navigate to="/" replace />
  return <>{children}</>
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Shell />}>
        <Route index element={<Dashboard />} />
        <Route path="pipeline" element={<Pipeline />} />
        <Route path="companies" element={<Companies />} />
        <Route path="companies/:id" element={<CompanyDetail />} />
        <Route path="visits" element={<Visits />} />
        <Route path="follow-ups" element={<FollowUps />} />
        <Route path="rate-card" element={<RateCard />} />
        <Route path="templates" element={<Templates />} />
        <Route path="reports" element={<Reports />} />
        <Route path="team" element={<RequireOwner><Team /></RequireOwner>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function Preview() {
  const users = listPreviewUsers()
  const [acting, setActing] = useState(getActingUserId())
  const barRef = useRef<HTMLDivElement>(null)

  // Publish the bar's height so the app's 100vh-based shell can subtract it.
  useEffect(() => {
    const bar = barRef.current
    if (!bar) return
    const apply = () =>
      document.documentElement.style.setProperty('--preview-bar-h', `${bar.offsetHeight}px`)
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(bar)
    return () => ro.disconnect()
  }, [])

  // Remounting on switch is the blunt but honest option: every hook refetches
  // through the mock client as the new user, so the pages show exactly what
  // that person's queries would return.
  function switchTo(id: string) {
    setActingUserId(id)
    setActing(id)
  }

  function reset() {
    resetPreviewData()
    setActing((a) => a)
    switchTo(acting)
  }

  return (
    <div className="preview-root">
      <div className="preview-bar" ref={barRef}>
        <div className="preview-bar-label">
          <strong>Preview</strong>
          <span>sample data, nothing connected</span>
        </div>
        <div className="preview-bar-switch">
          <span className="preview-bar-hint">Viewing as</span>
          {users.map((u) => (
            <button
              key={u.id}
              type="button"
              className={`preview-chip${u.id === acting ? ' active' : ''}`}
              onClick={() => switchTo(u.id)}
            >
              {u.name}
              <em>{u.role === 'owner' ? 'Owner' : 'Rep'}</em>
            </button>
          ))}
          <button type="button" className="preview-reset" onClick={reset}>
            Reset data
          </button>
        </div>
      </div>

      <div className="preview-app" key={acting}>
        <HashRouter>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </HashRouter>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Preview />)
