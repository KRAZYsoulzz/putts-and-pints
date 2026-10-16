import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { resolveLoginEmail, safeNextPath } from '../lib/auth'
import { useData } from '../lib/store'
import { supabase } from '../lib/supabase'

export default function Login() {
  const nav = useNavigate()
  const location = useLocation()
  const next = safeNextPath((location.state as { from?: string } | null)?.from)
  const { authReady, isAdmin } = useData()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)

    const email = await resolveLoginEmail(username)
    if (!email) {
      setBusy(false)
      setError('Director usernames are not linked yet. Add the admin and les aliases in Supabase, or sign in with the director email.')
      return
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    if (signInError) {
      setBusy(false)
      setError(signInMessage(signInError.message))
      return
    }

    const { data: admin, error: adminError } = await supabase.rpc('pp_is_admin')
    if (adminError || admin !== true) {
      await supabase.auth.signOut()
      setBusy(false)
      setError(adminError
        ? 'Signed in, but director access could not be verified. Run supabase/002_admin_auth.sql and add this user as a director, then try again.'
        : 'This account is not a tournament director.')
      return
    }

    nav(next, { replace: true })
  }

  if (authReady && isAdmin) return <Navigate to={next} replace />

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <img src="/logo.jpg" alt="Putts & Pints" />
        <div style={{ textAlign: 'center' }}>
          <div className="eyebrow">Tournament Director</div>
          <h1 className="display" style={{ fontSize: 34, marginTop: 6 }}>Sign in</h1>
        </div>
        <label className="field">
          <span>Username</span>
          <input
            className="input"
            type="text"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="admin"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            required
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            className="input"
            type="password"
            name="password"
            autoComplete="current-password"
            placeholder="••••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <div className="notice">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy || !authReady}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <button type="button" className="btn btn-ghost btn-block" onClick={() => nav('/')}>
          Back to live view
        </button>
        <p className="muted" style={{ textAlign: 'center', fontSize: 12, margin: 0 }}>
          Directors use username admin or les. Players and viewers stay on the public scoreboard.
        </p>
      </form>
    </div>
  )
}

function signInMessage(message: string): string {
  if (/invalid login credentials/i.test(message)) {
    return 'Invalid username or password. Check your credentials.'
  }
  if (/email not confirmed/i.test(message)) {
    return 'This director account is not confirmed yet. Confirm the user in Supabase, then try again.'
  }
  return message
}
