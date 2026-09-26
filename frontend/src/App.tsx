import { Navigate, NavLink, Outlet, Route, Routes, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, FileSpreadsheet, House, Inbox, LogOut, ScrollText, Users } from 'lucide-react'
import { api } from './api'
import { useAuth, useUser } from './auth'
import { Loading, ToastHost } from './ui'
import type { Referral, Role } from './types'
import Login from './pages/Login'
import Home from './pages/Home'
import Students from './pages/Students'
import StudentRecord from './pages/StudentRecord'
import Referrals from './pages/Referrals'
import Schedule from './pages/Schedule'
import Billing from './pages/Billing'
import Audit from './pages/Audit'
import SessionDrawer from './pages/SessionDrawer'

const ROLE_LABEL: Record<Role, string> = {
  counselor: 'Counselor',
  admin: 'Administrator',
  billing: 'Billing specialist',
}

export default function App() {
  const { user, ready } = useAuth()
  if (!ready) return <Loading />
  return (
    <>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
        <Route element={user ? <Shell /> : <Navigate to="/login" replace />}>
          <Route index element={user?.role === 'billing' ? <Navigate to="/billing" replace /> : <Home />} />
          <Route path="students" element={<Clinical><Students /></Clinical>} />
          <Route path="students/:id/*" element={<Clinical><StudentRecord /></Clinical>} />
          <Route path="referrals" element={<Clinical><Referrals /></Clinical>} />
          <Route path="schedule" element={<Clinical><Schedule /></Clinical>} />
          <Route path="billing" element={<Only roles={['billing', 'admin']}><Billing /></Only>} />
          <Route path="audit" element={<Only roles={['admin']}><Audit /></Only>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <ToastHost />
    </>
  )
}

function Only({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const user = useUser()
  return roles.includes(user.role) ? <>{children}</> : <Navigate to="/" replace />
}

function Clinical({ children }: { children: React.ReactNode }) {
  return <Only roles={['counselor', 'admin']}>{children}</Only>
}

function Shell() {
  const user = useUser()
  const { signOut } = useAuth()
  const [params, setParams] = useSearchParams()
  const sessionId = params.get('session')
  const clinical = user.role !== 'billing'

  const newReferrals = useQuery({
    queryKey: ['referrals', 'new'],
    queryFn: () => api.get<Referral[]>('/api/referrals?status=new'),
    enabled: clinical,
  })
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<{ notes_to_sign: unknown[] }>('/api/dashboard'),
    enabled: user.role === 'counselor',
  })

  const closeSession = () => {
    const next = new URLSearchParams(params)
    next.delete('session')
    setParams(next, { replace: true })
  }

  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand">
          <img src="/cairn.svg" width={30} height={30} alt="" />
          <div>
            <div className="brand-name">Cairn</div>
            <div className="brand-district">Riverbend Unified</div>
          </div>
        </div>
        <nav className="nav" aria-label="Main">
          {clinical && (
            <NavLink to="/" end>
              <House size={18} /> <span className="label">{user.role === 'admin' ? 'District' : 'Today'}</span>
              {user.role === 'counselor' && !!dashboard.data?.notes_to_sign.length && (
                <span className="nav-count" title="Notes to sign">{dashboard.data.notes_to_sign.length}</span>
              )}
            </NavLink>
          )}
          {clinical && (
            <NavLink to="/students">
              <Users size={18} /> <span className="label">{user.role === 'admin' ? 'Students' : 'My caseload'}</span>
            </NavLink>
          )}
          {clinical && (
            <NavLink to="/referrals">
              <Inbox size={18} /> <span className="label">Referrals</span>
              {!!newReferrals.data?.length && <span className="nav-count">{newReferrals.data.length}</span>}
            </NavLink>
          )}
          {clinical && (
            <NavLink to="/schedule">
              <CalendarDays size={18} /> <span className="label">Schedule</span>
            </NavLink>
          )}
          {user.role !== 'counselor' && (
            <NavLink to="/billing">
              <FileSpreadsheet size={18} /> <span className="label">Medicaid billing</span>
            </NavLink>
          )}
          {user.role === 'admin' && (
            <NavLink to="/audit">
              <ScrollText size={18} /> <span className="label">Access log</span>
            </NavLink>
          )}
        </nav>
        <div className="rail-user">
          <div className="who">{user.full_name}</div>
          <div className="role xs faint">
            {ROLE_LABEL[user.role]}
            {user.credentials ? `, ${user.credentials}` : ''}
          </div>
          <button className="btn ghost small" onClick={signOut}>
            <LogOut size={16} /> <span className="label">Sign out</span>
          </button>
        </div>
      </aside>
      <main className="main">
        <div className="page">
          <Outlet />
        </div>
      </main>
      {sessionId && clinical && <SessionDrawer id={Number(sessionId)} onClose={closeSession} />}
    </div>
  )
}
