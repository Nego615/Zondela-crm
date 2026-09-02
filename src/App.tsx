import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import type { Permission } from './lib/permissions'
import Shell from './components/Shell'
import Dashboard from './pages/Dashboard'
import Login from './pages/Login'
import SetPassword from './pages/SetPassword'
import Companies from './pages/Companies'
import CompanyDetail from './pages/CompanyDetail'
import Contacts from './pages/Contacts'
import Appointments from './pages/Appointments'
import FollowUps from './pages/FollowUps'
import Sto from './pages/Sto'
import Reports from './pages/Reports'
import Users from './pages/admin/Users'
import UserDetail from './pages/admin/UserDetail'
import RolesPermissions from './pages/admin/RolesPermissions'
import ActivityLogs from './pages/admin/ActivityLogs'
import SystemSettings from './pages/admin/SystemSettings'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, profile, loading } = useAuth()

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-soft)' }}>
        Loading…
      </div>
    )
  }

  // A session without a profile is someone mid-invitation, or an account that
  // was deactivated while they were signed in — either way, not somebody the
  // app has anything to show.
  if (!session || !profile) return <Navigate to="/login" replace />
  return <>{children}</>
}

/**
 * Keeps a route out of the nav and out of the URL bar for someone who lacks the
 * permission. It is a courtesy, not a defence: the data behind every one of
 * these pages is gated by RLS policies and permission checks in the database,
 * so someone who forces their way to the URL gets the page frame and no data.
 */
function RequirePermission({
  permission,
  children,
}: {
  permission: Permission
  children: React.ReactNode
}) {
  const { can, loading, profile } = useAuth()
  // Wait for the profile: permissions arrive with it, and redirecting early
  // would bounce an administrator off their own admin page on every refresh.
  if (loading || !profile) return null
  if (!can(permission)) return <Navigate to="/" replace />
  return <>{children}</>
}

function AppRoutes() {
  const { session, profile } = useAuth()

  return (
    <Routes>
      {/* Both halves are needed: RequireAuth sends anyone without a profile
          here, so redirecting away on a bare session would bounce them
          between the two forever. */}
      <Route path="/login" element={session && profile ? <Navigate to="/" replace /> : <Login />} />
      {/* Where the invitation and password-reset emails land. Both are open
          routes by necessity — the visitor has no session yet beyond the
          recovery one the emailed link just created. */}
      <Route path="/set-password" element={<SetPassword mode="invite" />} />
      <Route path="/reset-password" element={<SetPassword mode="reset" />} />
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
        {/* Email templates moved into STO — they are only read when an
            agreement goes out. Old links and bookmarks land on that tab. */}
        <Route path="templates" element={<Navigate to="/sto?tab=templates" replace />} />
        <Route path="reports" element={<Reports />} />

        {/* Admin. The Team page was the owner-only roster; it is now the users
            list, and the old path still gets there. */}
        <Route path="team" element={<Navigate to="/admin/users" replace />} />
        <Route
          path="admin/users"
          element={
            <RequirePermission permission="users.view">
              <Users />
            </RequirePermission>
          }
        />
        <Route
          path="admin/users/:id"
          element={
            <RequirePermission permission="users.view">
              <UserDetail />
            </RequirePermission>
          }
        />
        <Route
          path="admin/roles"
          element={
            <RequirePermission permission="roles.view">
              <RolesPermissions />
            </RequirePermission>
          }
        />
        <Route
          path="admin/activity"
          element={
            <RequirePermission permission="logs.view">
              <ActivityLogs />
            </RequirePermission>
          }
        />
        <Route
          path="admin/settings"
          element={
            <RequirePermission permission="settings.manage">
              <SystemSettings />
            </RequirePermission>
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
