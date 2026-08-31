import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import Shell from './components/Shell'
import Login from './pages/Login'
import Pipeline from './pages/Pipeline'
import Companies from './pages/Companies'
import CompanyDetail from './pages/CompanyDetail'
import Visits from './pages/Visits'
import FollowUps from './pages/FollowUps'
import RateCard from './pages/RateCard'
import Templates from './pages/Templates'
import Reports from './pages/Reports'
import Team from './pages/Team'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-soft)' }}>
        Loading…
      </div>
    )
  }

  if (!session) return <Navigate to="/login" replace />
  return <>{children}</>
}

function RequireOwner({ children }: { children: React.ReactNode }) {
  const { isOwner, loading } = useAuth()
  if (loading) return null
  if (!isOwner) return <Navigate to="/" replace />
  return <>{children}</>
}

function AppRoutes() {
  const { session } = useAuth()

  return (
    <Routes>
      <Route path="/login" element={session ? <Navigate to="/" replace /> : <Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Shell />
          </RequireAuth>
        }
      >
        <Route index element={<Pipeline />} />
        <Route path="companies" element={<Companies />} />
        <Route path="companies/:id" element={<CompanyDetail />} />
        <Route path="visits" element={<Visits />} />
        <Route path="follow-ups" element={<FollowUps />} />
        <Route path="rate-card" element={<RateCard />} />
        <Route path="templates" element={<Templates />} />
        <Route path="reports" element={<Reports />} />
        <Route
          path="team"
          element={
            <RequireOwner>
              <Team />
            </RequireOwner>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
