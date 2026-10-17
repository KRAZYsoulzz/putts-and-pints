import { useEffect, useState } from 'react'
import { subscribeConfirm, subscribeNotices, type ConfirmRequest, type Notice } from '../lib/notify'
import { Dialog } from './ui'

export default function Notices() {
  const [notices, setNotices] = useState<Notice[]>([])
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)

  useEffect(() => subscribeNotices(setNotices), [])
  useEffect(() => subscribeConfirm(setConfirm), [])

  return (
    <>
      {notices.length > 0 && (
        <div className="toaster" role="status" aria-live="polite">
          {notices.map(n => (
            <div key={n.id} className={`toast ${n.tone}`}>{n.message}</div>
          ))}
        </div>
      )}
      {confirm && (
        <Dialog title={confirm.title} layer="top" onClose={() => confirm.resolve(false)}>
          <p style={{ margin: 0 }}>{confirm.message}</p>
          <div className="dialog-actions">
            <button className="btn btn-ghost" onClick={() => confirm.resolve(false)}>Cancel</button>
            <button
              className={`btn ${confirm.danger ? 'btn-danger' : 'btn-primary'}`}
              onClick={() => confirm.resolve(true)}
              autoFocus
            >
              {confirm.confirmLabel}
            </button>
          </div>
        </Dialog>
      )}
    </>
  )
}
