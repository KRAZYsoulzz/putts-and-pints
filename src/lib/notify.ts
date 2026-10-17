export type Tone = 'info' | 'error'

export interface Notice {
  id: number
  tone: Tone
  message: string
}

export interface ConfirmRequest {
  title: string
  message: string
  confirmLabel: string
  danger: boolean
  resolve: (ok: boolean) => void
}

type NoticeListener = (notices: Notice[]) => void
type ConfirmListener = (req: ConfirmRequest | null) => void

let notices: Notice[] = []
const noticeListeners = new Set<NoticeListener>()
let confirmListener: ConfirmListener | null = null
let nextId = 1
let pendingConfirm: ConfirmRequest | null = null

export function subscribeNotices(fn: NoticeListener) {
  noticeListeners.add(fn)
  fn(notices)
  return () => { noticeListeners.delete(fn) }
}

function emitNotices() {
  for (const fn of noticeListeners) fn(notices)
}

export function dismissNotice(id: number) {
  notices = notices.filter(n => n.id !== id)
  emitNotices()
}

export function report(message: string, tone: Tone = 'info') {
  const id = nextId++
  notices = [...notices, { id, tone, message }]
  emitNotices()
  window.setTimeout(() => dismissNotice(id), tone === 'error' ? 8000 : 4200)
}

export function reportError(message: string) { report(message, 'error') }
export function reportInfo(message: string) { report(message, 'info') }

export function subscribeConfirm(fn: ConfirmListener) {
  confirmListener = fn
  fn(pendingConfirm)
  return () => { if (confirmListener === fn) confirmListener = null }
}

export function askConfirm(
  message: string,
  opts?: { title?: string; confirmLabel?: string; danger?: boolean },
): Promise<boolean> {
  if (!confirmListener) return Promise.resolve(window.confirm(message))
  // A second confirm replaces the first; the first one is treated as cancelled.
  pendingConfirm?.resolve(false)
  return new Promise(resolve => {
    pendingConfirm = {
      title: opts?.title ?? 'Are you sure?',
      message,
      confirmLabel: opts?.confirmLabel ?? 'Confirm',
      danger: opts?.danger ?? false,
      resolve: (ok) => {
        pendingConfirm = null
        confirmListener?.(null)
        resolve(ok)
      },
    }
    confirmListener?.(pendingConfirm)
  })
}
