import { useState } from 'react'
import { CONFIRMATION_SENTENCE, cashWindow } from '../lib/closeout'
import { MoneyInput, money } from './ui'

export interface CorrectionDraftPanelProps {
  cashDue: number
  handled: number
  acknowledged?: boolean
  confirmation?: string
  applyFailed?: boolean
  division?: 'M' | 'W'
  bookedCash?: number
  targetCash?: number
  reopenDivision?: boolean
  error?: string | null
  onTargetCashChange?: (value: number) => void
  onHandledChange?: (value: number) => void
  onConfirmSettlement?: (acknowledged: boolean, confirmation: string) => void
  onReopenChange?: (reopen: boolean) => void
  onApply?: () => void
  onCancel?: () => void
}

export function CorrectionDraftPanel({
  cashDue,
  handled,
  acknowledged: controlledAcknowledged,
  confirmation: controlledConfirmation,
  applyFailed,
  division,
  bookedCash,
  targetCash,
  reopenDivision = false,
  error,
  onTargetCashChange,
  onHandledChange,
  onConfirmSettlement,
  onReopenChange,
  onApply,
  onCancel,
}: CorrectionDraftPanelProps) {
  const [localAcknowledged, setLocalAcknowledged] = useState(false)
  const [localConfirmation, setLocalConfirmation] = useState('')

  const acknowledged = controlledAcknowledged ?? localAcknowledged
  const confirmation = controlledConfirmation ?? localConfirmation

  const windowState = cashWindow({
    cashDue,
    handled,
    acknowledged,
    confirmation,
    applyFailed,
  })

  const toggleConfirm = (nextAck: boolean) => {
    const nextSentence = nextAck ? CONFIRMATION_SENTENCE : ''
    setLocalAcknowledged(nextAck)
    setLocalConfirmation(nextSentence)
    onConfirmSettlement?.(nextAck, nextSentence)
  }

  return (
    <div className="correction-draft-panel panel panel-pad stack" style={{ marginTop: 12, gap: 10 }}>
      <div className="eyebrow">
        Correction Draft{division ? ` · ${division === 'M' ? "Men's" : "Women's"} Division` : ''}
      </div>

      {bookedCash !== undefined && targetCash !== undefined && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="kv">
            <dt>Original posted payout cash</dt>
            <dd>{money(bookedCash)}</dd>
          </div>
          {onTargetCashChange ? (
            <div className="field">
              <span>Corrected target payout cash ($)</span>
              <MoneyInput
                value={targetCash}
                aria-label="Corrected target payout cash"
                onChange={onTargetCashChange}
              />
            </div>
          ) : (
            <div className="kv">
              <dt>Corrected target payout cash</dt>
              <dd>{money(targetCash)}</dd>
            </div>
          )}
        </div>
      )}

      {onHandledChange && cashDue > 0 && (
        <div className="field">
          <span>Physical cash difference settled ($ due: {money(cashDue)})</span>
          <MoneyInput
            value={handled}
            aria-label="Physical cash settled"
            onChange={onHandledChange}
          />
        </div>
      )}

      {onReopenChange && (
        <label className="row" style={{ gap: 8, fontSize: 13, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={reopenDivision}
            onChange={(e) => onReopenChange(e.target.checked)}
          />
          <span>Reopen this division for payout adjustments through this correction</span>
        </label>
      )}

      <label className="row" style={{ gap: 8, fontSize: 13, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={acknowledged && confirmation === CONFIRMATION_SENTENCE}
          onChange={(e) => toggleConfirm(e.target.checked)}
        />
        <span className="confirmation-sentence">{CONFIRMATION_SENTENCE}</span>
      </label>

      <div className="kv">
        <dt className="correction-state">State: {windowState.state}</dt>
        <dd className="correction-actionable">Actionable: {windowState.actionable}</dd>
      </div>

      {error && <small className="field-error">{error}</small>}

      {(onApply || onCancel) && (
        <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
          {onCancel && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
              Cancel
            </button>
          )}
          {onApply && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!windowState.confirmationOk || handled !== cashDue}
              onClick={onApply}
            >
              {reopenDivision ? 'Confirm Cash & Reopen Division' : 'Confirm Cash & Post Correction'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default CorrectionDraftPanel

