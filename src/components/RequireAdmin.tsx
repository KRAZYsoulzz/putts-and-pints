import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useData } from '../lib/store'

/** Season and Settings are director pages. Everyone else goes to sign-in. */
export default function RequireAdmin({ children }: { children: ReactNode }) {
  const { authReady, session, isAdmin } = useData()
  const location = useLocation()

  if (!authReady) {
    return <div className="empty"><p className="muted">Checking access…</p></div>
  }
  if (!session || !isAdmin) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return children
}
