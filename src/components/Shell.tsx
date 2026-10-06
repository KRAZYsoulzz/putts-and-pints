import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { CalendarDays, Coins, Flag, LogIn, LogOut, QrCode, Settings2, Trophy, Users } from 'lucide-react'
import { useData } from '../lib/store'
import { supabase } from '../lib/supabase'
import { Dialog } from './ui'

const PUBLIC_NAV = [
  { to: '/', label: 'Tonight', icon: Flag },
  { to: '/standings', label: 'Standings', icon: Trophy },
  { to: '/players', label: 'Players', icon: Users },
  { to: '/pots', label: 'Pots', icon: Coins },
]
const ADMIN_NAV = [
  { to: '/season', label: 'Season', icon: CalendarDays },
  { to: '/settings', label: 'Settings', icon: Settings2 },
]

export default function Shell() {
  const { season, session, isAdmin } = useData()
  const [qr, setQr] = useState(false)
  const nav = useNavigate()
  const link = (n: typeof PUBLIC_NAV[number]) => (
    <NavLink key={n.to} to={n.to} end={n.to === '/'}><n.icon size={17} strokeWidth={1.75} />{n.label}</NavLink>
  )

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <img src="/logo.jpg" alt="" />
          <div>
            <div className="display brand-name">Putts &amp; Pints</div>
            <div className="eyebrow">{season?.name ?? 'No active season'}</div>
          </div>
        </div>

        <nav className="nav">
          {PUBLIC_NAV.map(link)}
          {isAdmin && <><div className="eyebrow nav-label">Manage</div>{ADMIN_NAV.map(link)}</>}
        </nav>

        <div className="sidebar-foot">
          <button className="btn btn-ghost btn-block" style={{ justifyContent: 'flex-start' }} onClick={() => setQr(true)}>
            <QrCode size={16} strokeWidth={1.75} /> Share live view
          </button>
          <div className="whoami">
            <span><i className={`dot ${isAdmin ? 'on' : ''}`} />{isAdmin ? 'Admin' : 'View only'}</span>
            {session
              ? <button className="btn btn-ghost btn-sm" onClick={() => supabase.auth.signOut()}><LogOut size={14} /> Sign out</button>
              : <button className="btn btn-ghost btn-sm" onClick={() => nav('/login')}><LogIn size={14} /> Sign in</button>}
          </div>
        </div>
      </aside>

      <header className="mobile-top">
        <img src="/logo.jpg" alt="" />
        <span className="display brand-name">Putts &amp; Pints</span>
        <span className="spacer" />
        <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setQr(true)} aria-label="Share"><QrCode size={18} /></button>
      </header>

      <main className="main"><Outlet /></main>

      <nav className="tabbar">
        {[...PUBLIC_NAV, ...(isAdmin ? ADMIN_NAV.slice(0, 1) : [])].map(n => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'}><n.icon size={20} strokeWidth={1.75} />{n.label}</NavLink>
        ))}
      </nav>

      {qr && (
        <Dialog title="Live view" onClose={() => setQr(false)}>
          <div className="qr"><QRCodeSVG value={window.location.origin} size={220} bgColor="#F2EAD3" fgColor="#0B1220" /></div>
          <p className="muted" style={{ textAlign: 'center' }}>
            Scan to follow tonight's leaderboard, season standings and pots.<br />
            <span className="num faint">{window.location.host}</span>
          </p>
        </Dialog>
      )}
    </div>
  )
}
