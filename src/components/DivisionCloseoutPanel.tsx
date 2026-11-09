import { closeoutReader } from '../lib/closeout'
import { money } from './ui'

export interface DivisionCloseoutPanelProps {
  closed: boolean
  sharedPosted: boolean
  correctionPending: boolean
  deficit: number
  division?: 'M' | 'W'
  heldReserve?: { perfect4: number; perfect5: number }
  releasedReserve?: number
  previewText?: string | null
  canClose?: boolean
  isClosing?: boolean
  canCorrect?: boolean
  onCloseDivision?: () => void
  onStartCorrection?: () => void
}

export function DivisionCloseoutPanel({
  closed,
  sharedPosted,
  correctionPending,
  deficit,
  division,
  heldReserve,
  releasedReserve = 0,
  previewText,
  canClose = false,
  isClosing = false,
  canCorrect = false,
  onCloseDivision,
  onStartCorrection,
}: DivisionCloseoutPanelProps) {
  const info = closeoutReader({
    closed,
    sharedPosted,
    correctionPending,
    deficit,
  })
  const divLabel = division === 'W' ? "Women's" : division === 'M' ? "Men's" : 'Division'
  const heldTotal = (heldReserve?.perfect4 ?? 0) + (heldReserve?.perfect5 ?? 0)

  return (
    <div className="division-closeout-panel" style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>{divLabel} Closeout &amp; Shared Pots</div>
      {info.fundingNeeded && (
        <p className="funding-needed field-error" style={{ margin: '0 0 8px' }}>{info.fundingNeeded}</p>
      )}
      {previewText && !info.closed && (
        <pre
          className="closeout-preview muted"
          style={{
            margin: '0 0 10px',
            padding: '8px 10px',
            borderRadius: 6,
            background: 'var(--surface-1)',
            border: '1px solid var(--line)',
            fontSize: 12,
            whiteSpace: 'pre-wrap',
            fontFamily: 'inherit',
          }}
        >
          {previewText}
        </pre>
      )}
      <div className="kv">
        <dt>Division closed</dt>
        <dd className="division-closed">Division closed: {info.closed ? 'Yes' : 'No'}</dd>
      </div>
      <div className="kv">
        <dt>Shared P4/P5 pots</dt>
        <dd className="shared-pots-posted">Shared pots posted: {info.sharedPosted ? 'Yes' : 'No'}</dd>
      </div>
      <div className="kv">
        <dt>Correction draft</dt>
        <dd className="correction-pending">Correction pending: {info.correctionPending ? 'Yes' : 'No'}</dd>
      </div>
      {heldTotal > 0 && !info.sharedPosted && (
        <div className="kv">
          <dt>Held P4/P5 reserve</dt>
          <dd>{money(heldTotal)} (until both divisions close)</dd>
        </div>
      )}
      {releasedReserve > 0 && info.sharedPosted && (
        <div className="kv">
          <dt>Released reserve to Perfect Round</dt>
          <dd>+{money(releasedReserve)}</dd>
        </div>
      )}
      {(onCloseDivision || onStartCorrection) && (
        <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          {onCloseDivision && !info.closed && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!canClose || isClosing || deficit > 0}
              onClick={onCloseDivision}
            >
              {isClosing ? `Closing ${divLabel}…` : `Close ${divLabel} Division`}
            </button>
          )}
          {onStartCorrection && info.closed && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={!canCorrect}
              onClick={onStartCorrection}
            >
              {info.correctionPending ? 'Edit Correction Draft' : `Correct / Reopen ${divLabel}`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default DivisionCloseoutPanel

