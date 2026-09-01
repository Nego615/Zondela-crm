import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import Shell from './components/Shell'
import Dashboard from './pages/Dashboard'
import Login from './pages/Login'
import Companies from './pages/Companies'
import CompanyDetail from './pages/CompanyDetail'
import Contacts from './pages/Contacts'
import Appointments from './pages/Appointments'
import FollowUps from './pages/FollowUps'
import Sto from './pages/Sto'
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
        <Route index element={<Dashboard />} />
        <Route path="companies" element={<Companies />} />
        <Route path="companies/:id" element={<CompanyDetail />} />
        <Route path="contacts" element={<Contacts />} />
        <Route path="appointments" element={<Appointments />} />
        <Route path="follow-ups" element={<FollowUps />} />
        <Route path="sto" element={<Sto />} />
        {/* The section used to be the rate card alone; links and bookmarks
            pointing at the old path land on the rate card tab. */}
        <Route path="rate-card" element={<Navigate to="/sto?tab=rate-card" replace />} />
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
