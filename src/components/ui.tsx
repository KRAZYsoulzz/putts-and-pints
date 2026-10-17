import { useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { clampScore } from '../lib/scoring'
import { DIVISION_LABEL, DIVISIONS, type Division } from '../lib/types'

export const money = (n: number) =>
  (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })

export const fmtDate = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

export function PageHead({ eyebrow, title, children }: { eyebrow?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="display page-title">{title}</h1>
      </div>
      {children && <div className="page-actions">{children}</div>}
    </header>
  )
}

export function Seg<T extends string>({ value, options, onChange }: {
  value: T
  options: { value: T; label: ReactNode; count?: number }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="seg" role="tablist">
      {options.map(o => (
        <button key={o.value} role="tab" aria-selected={value === o.value}
          className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}{o.count != null && <span className="count">{o.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function DivisionSeg({ value, onChange, counts }: {
  value: Division; onChange: (d: Division) => void; counts?: Record<Division, number>
}) {
  return <Seg value={value} onChange={onChange}
    options={DIVISIONS.map(d => ({ value: d, label: DIVISION_LABEL[d], count: counts?.[d] }))} />
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label}
    className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />
}

export function Dialog({ title, onClose, children, footer }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="scrim" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true">
        <div className="dialog-head">
          <h2 className="display dialog-title">{title}</h2>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  )
}

/** Floating menu anchored at a point; closes on outside click / Escape. */
export function Menu({ x, y, onClose, children }: { x: number; y: number; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', key)
    window.addEventListener('scroll', onClose, true)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', key)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [onClose])
  const left = Math.min(x, window.innerWidth - 240)
  const top = Math.min(y, window.innerHeight - 320)
  return <div ref={ref} className="menu" style={{ left, top }} role="menu">{children}</div>
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><div className="display">{title}</div>{children}</div>
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="stat">
      <div className="eyebrow">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

/**
 * Dollar field that keeps what you're typing until you leave it.
 * Saving on every keystroke raced the live refetch and dropped or repeated digits.
 * Negatives are refused unless `allowNegative` (pot adjustments) is set.
 */
export function MoneyInput({ value, onChange, allowNegative = false, ...rest }: {
  value: number
  onChange: (n: number) => void
  allowNegative?: boolean
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const shown = draft ?? (Number.isFinite(value) ? String(value) : '')

  const commit = (raw: string) => {
    const t = raw.trim()
    if (t === '' || t === '-' || t === '.' || t === '-.') {
      setError(null)
      setDraft(null)
      if (value !== 0) onChange(0)
      return
    }
    const n = Number(t)
    if (!Number.isFinite(n)) {
      setError('Enter a dollar amount.')
      setDraft(null)
      return
    }
    if (!allowNegative && n < 0) {
      setError('Amount can’t be negative.')
      setDraft(null)
      return
    }
    const rounded = Math.round(n * 100) / 100
    setError(null)
    setDraft(null)
    if (rounded !== value) onChange(rounded)
  }

  return (
    <div>
      <div className="input-money">
        <input
          className="input num"
          type="text"
          inputMode="decimal"
          value={shown}
          onFocus={e => { setDraft(Number.isFinite(value) ? String(value) : ''); e.target.select() }}
          onChange={e => { setError(null); setDraft(e.target.value) }}
          onBlur={e => commit(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur() }}
          {...rest}
        />
      </div>
      {error && <small className="field-error">{error}</small>}
    </div>
  )
}

/** Score cell. Draft while focused; clamped into 0..max on blur so a negative never hits the database. */
export function ScoreInput({ value, max, disabled, onCommit }: {
  value: number | null
  max: number
  disabled?: boolean
  onCommit: (n: number | null) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? (value ?? '')
  return (
    <input
      className={`score ${value === max ? 'perfect' : ''}`}
      type="number"
      inputMode="numeric"
      min={0}
      max={max}
      disabled={disabled}
      aria-label={`Score, 0 to ${max}`}
      value={shown}
      onFocus={e => { setDraft(value == null ? '' : String(value)); e.target.select() }}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => {
        const raw = draft ?? ''
        setDraft(null)
        if (raw.trim() === '') {
          if (value !== null) onCommit(null)
          return
        }
        const next = clampScore(raw, max)
        if (next == null) return
        if (next !== value) onCommit(next)
      }}
    />
  )
}
