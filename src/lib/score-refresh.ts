/** One division's scores while a director is entering them. Synthetic in tests. */
export interface ScoreBoard {
  server: Record<string, number | null>
  local: Record<string, number | null>
  draft: { id: string; raw: string } | null
  savesInFlight: number
  refreshing: boolean
  status: string | null
}

const typingStatus = 'Finish the score you’re typing, then refresh.'
const savingStatus = 'Saving score…'
const refreshingStatus = 'Refreshing scores…'
const refreshedStatus = 'Scores refreshed.'

function blockedStatus(board: Pick<ScoreBoard, 'draft' | 'savesInFlight' | 'refreshing'>): string | null {
  if (board.draft) return typingStatus
  if (board.savesInFlight > 0) return savingStatus
  if (board.refreshing) return refreshingStatus
  return null
}

/** A click may reload only when nothing is half-typed, unsaved, or already refreshing. */
export function requestRefresh(board: ScoreBoard): { board: ScoreBoard; fetch: boolean } {
  const status = blockedStatus(board)
  if (status) return { fetch: false, board: { ...board, status } }
  return { fetch: true, board: { ...board, refreshing: true, status: refreshingStatus } }
}

/**
 * Apply a finished reload. A typed score or an in-flight save stays on the board.
 * An error leaves the local scores as they were. Success does not say the score was saved.
 */
function refreshFailure(fetched: Record<string, number | null> | { error: string }): string | null {
  const keys = Object.keys(fetched)
  const message = (fetched as { error?: unknown }).error
  if (keys.length === 1 && keys[0] === 'error' && typeof message === 'string') return message
  return null
}

export function completeRefresh(
  board: ScoreBoard,
  fetched: Record<string, number | null> | { error: string },
): ScoreBoard {
  const failure = refreshFailure(fetched)
  if (board.draft || board.savesInFlight > 0) {
    return { ...board, refreshing: false, status: blockedStatus(board) }
  }
  if (failure) return { ...board, refreshing: false, status: failure }
  const scores = fetched as Record<string, number | null>
  return {
    ...board,
    refreshing: false,
    local: { ...scores },
    server: { ...scores },
    status: refreshedStatus,
  }
}
