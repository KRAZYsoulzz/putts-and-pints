import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { CalendarDays, Coins, Download, Flag, LogIn, LogOut, QrCode, Settings2, Trophy, Users } from 'lucide-react'
import { useData } from '../lib/store'
import { Dialog } from './ui'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

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
  const { season, isAdmin, signOut } = useData()
  const [qr, setQr] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [installHelp, setInstallHelp] = useState(false)
  const [isStandalone, setIsStandalone] = useState(() => {
    if (typeof window === 'undefined') return false
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    )
  })
  const nav = useNavigate()

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setDeferredPrompt(null)
      setIsStandalone(true)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const handleInstall = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt()
      const { outcome } = await deferredPrompt.userChoice
      if (outcome === 'accepted') {
        setDeferredPrompt(null)
      }
    } else {
      setInstallHelp(true)
    }
  }

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
          {!isStandalone && (
            <button className="btn btn-ghost btn-block" style={{ justifyContent: 'flex-start' }} onClick={() => void handleInstall()}>
              <Download size={16} strokeWidth={1.75} /> Install app
            </button>
          )}
          <button className="btn btn-ghost btn-block" style={{ justifyContent: 'flex-start' }} onClick={() => setQr(true)}>
            <QrCode size={16} strokeWidth={1.75} /> Share live view
          </button>
          <div className="whoami">
            <span><i className={`dot ${isAdmin ? 'on' : ''}`} />{isAdmin ? 'Admin' : 'View only'}</span>
            {isAdmin
              ? <button className="btn btn-ghost btn-sm" onClick={() => { void signOut(); nav('/') }}><LogOut size={14} /> Sign out</button>
              : <button className="btn btn-ghost btn-sm" onClick={() => nav('/login')}><LogIn size={14} /> Sign in</button>}
          </div>
        </div>
      </aside>

      <header className="mobile-top">
        <img src="/logo.jpg" alt="" />
        <span className="display brand-name">Putts &amp; Pints</span>
        <span className="spacer" />
        {!isStandalone && (
          <button className="btn btn-ghost btn-sm btn-icon" onClick={() => void handleInstall()} aria-label="Install app" title="Install app"><Download size={18} /></button>
        )}
        {isAdmin && (
          <button className="btn btn-ghost btn-sm btn-icon" onClick={() => nav('/settings')} aria-label="Settings"><Settings2 size={18} /></button>
        )}
        {isAdmin
          ? <button className="btn btn-ghost btn-sm btn-icon" onClick={() => { void signOut(); nav('/') }} aria-label="Sign out"><LogOut size={18} /></button>
          : <button className="btn btn-ghost btn-sm btn-icon" onClick={() => nav('/login')} aria-label="Sign in"><LogIn size={18} /></button>}
        <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setQr(true)} aria-label="Share"><QrCode size={18} /></button>
      </header>

      <main className="main"><Outlet /></main>

      <nav className="tabbar">
        {[...PUBLIC_NAV, ...(isAdmin ? ADMIN_NAV.slice(0, 1) : [])].map(n => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'}><n.icon size={20} strokeWidth={1.75} />{n.label}</NavLink>
        ))}
      </nav>

      {deferredPrompt && !isStandalone && (
        <div style={{ position: 'fixed', bottom: '76px', left: 0, right: 0, display: 'flex', justifyContent: 'center', zIndex: 100, pointerEvents: 'none' }}>
          <button className="btn btn-primary" style={{ pointerEvents: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.45)' }} onClick={() => void handleInstall()}>
            <Download size={16} /> INSTALL APP
          </button>
        </div>
      )}

      {qr && (
        <Dialog title="Live view" onClose={() => setQr(false)}>
          <div className="qr"><QRCodeSVG value={window.location.origin} size={220} bgColor="#F2EAD3" fgColor="#0B1220" /></div>
          <p className="muted" style={{ textAlign: 'center' }}>
            Scan to follow tonight's leaderboard, season standings and pots.<br />
            <span className="num faint">{window.location.host}</span>
          </p>
        </Dialog>
      )}

      {installHelp && (
        <Dialog title="Install Putts & Pints" onClose={() => setInstallHelp(false)}>
          <div className="stack" style={{ gap: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <img src="/icon-192.png" alt="Putts & Pints" style={{ width: 52, height: 52, borderRadius: 12 }} />
              <div>
                <div style={{ fontWeight: 700, fontSize: '16px' }}>Putts &amp; Pints</div>
                <div className="muted" style={{ fontSize: '13px' }}>Add to your home screen for quick full-screen access.</div>
              </div>
            </div>
            <div className="panel panel-pad" style={{ fontSize: '13px', lineHeight: 1.5 }}>
              <div style={{ fontWeight: 700, marginBottom: '4px' }}>iPhone / iPad (Safari):</div>
              <div className="muted">Tap the <strong>Share</strong> button at the bottom of Safari, then select <strong>Add to Home Screen</strong>.</div>
            </div>
            <div className="panel panel-pad" style={{ fontSize: '13px', lineHeight: 1.5 }}>
              <div style={{ fontWeight: 700, marginBottom: '4px' }}>Android / Desktop (Chrome / Edge):</div>
              <div className="muted">Tap the browser menu <strong>⋮</strong> (or address bar icon) and select <strong>Install app</strong> or <strong>Add to Home screen</strong>.</div>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  )
}
