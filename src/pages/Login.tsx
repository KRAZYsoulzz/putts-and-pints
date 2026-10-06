import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Login() {
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) setError(error.message)
    else nav('/')
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <img src="/logo.jpg" alt="Putts & Pints" />
        <div style={{ textAlign: 'center' }}>
          <div className="eyebrow">Tournament manager</div>
          <h1 className="display" style={{ fontSize: 34, marginTop: 6 }}>Sign in</h1>
        </div>
        <label className="field"><span>Email</span>
          <input className="input" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} autoFocus required />
        </label>
        <label className="field"><span>Password</span>
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
        </label>
        {error && <div className="notice">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <button type="button" className="btn btn-ghost btn-block" onClick={() => nav('/')}>Back to live view</button>
      </form>
    </div>
  )
}
