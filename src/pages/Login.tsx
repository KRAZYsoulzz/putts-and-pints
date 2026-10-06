import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useData } from '../lib/store'

export default function Login() {
  const nav = useNavigate()
  const { setAdmin } = useData()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError('')

    const cleanUser = username.trim().toLowerCase()
    const cleanPass = password.trim()

    if ((cleanUser === 'admin' || cleanUser === 'les') && cleanPass === 'MoneyManLes') {
      setAdmin(true)
      nav('/')
    } else {
      setError('Invalid username or password. Check your credentials.')
    }
  }

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
            autoComplete="username"
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
            autoComplete="current-password"
            placeholder="••••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <div className="notice">{error}</div>}
        <button className="btn btn-primary btn-block">Sign in</button>
        <button type="button" className="btn btn-ghost btn-block" onClick={() => nav('/')}>
          Back to live view
        </button>
      </form>
    </div>
  )
}
