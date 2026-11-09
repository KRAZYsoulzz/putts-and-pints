import { cashWindow } from '../lib/closeout'

const CONFIRMATION_SENTENCE = 'All cash differences shown have been physically settled.'

export interface CorrectionDraftPanelProps {
  cashDue: number
  handled: number
}

export function CorrectionDraftPanel({
  cashDue,
  handled,
}: CorrectionDraftPanelProps) {
  const windowState = cashWindow({
    cashDue,
    handled,
    acknowledged: true,
    confirmation: CONFIRMATION_SENTENCE,
  })

  return (
    <div className="correction-draft-panel">
      <p className="confirmation-sentence">{CONFIRMATION_SENTENCE}</p>
      <p className="correction-state">State: {windowState.state}</p>
      <p className="correction-actionable">Actionable: {windowState.actionable}</p>
    </div>
  )
}

export default CorrectionDraftPanel
