import { closeoutReader } from '../lib/closeout'

export interface DivisionCloseoutPanelProps {
  closed: boolean
  sharedPosted: boolean
  correctionPending: boolean
  deficit: number
}

export function DivisionCloseoutPanel({
  closed,
  sharedPosted,
  correctionPending,
  deficit,
}: DivisionCloseoutPanelProps) {
  const info = closeoutReader({
    closed,
    sharedPosted,
    correctionPending,
    deficit,
  })

  return (
    <div className="division-closeout-panel">
      {info.fundingNeeded && (
        <p className="funding-needed">{info.fundingNeeded}</p>
      )}
      <p className="division-closed">
        Division closed: {info.closed ? 'Yes' : 'No'}
      </p>
      <p className="shared-pots-posted">
        Shared pots posted: {info.sharedPosted ? 'Yes' : 'No'}
      </p>
      <p className="correction-pending">
        Correction pending: {info.correctionPending ? 'Yes' : 'No'}
      </p>
    </div>
  )
}

export default DivisionCloseoutPanel
