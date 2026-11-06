import { clampScore } from './scoring'

/** Text in the score box, and whether Enter already saved it. */
export interface ScoreEdit {
  draft: string | null
  enterAlreadySaved: boolean
}

export type ScoreAction =
  | { type: 'focus' }
  | { type: 'change'; raw: string }
  | { type: 'enter' }
  | { type: 'blur' }

/**
 * What a blur or Enter should write. `undefined` means do not call the save.
 * The saved value passed in is the one already on screen, so Enter followed by
 * blur does not save a second time.
 */
export function commitScoreEdit(
  edit: ScoreEdit,
  value: number | null,
  max: number,
  source: 'enter' | 'blur',
): { edit: ScoreEdit; commit: number | null | undefined } {
  if (source === 'blur' && edit.enterAlreadySaved) {
    return { edit: { draft: null, enterAlreadySaved: false }, commit: undefined }
  }
  const raw = edit.draft
  if (raw == null) {
    return { edit: { draft: null, enterAlreadySaved: source === 'enter' }, commit: undefined }
  }
  let commit: number | null | undefined
  if (raw.trim() === '') {
    commit = value !== null ? null : undefined
  } else {
    const next = clampScore(raw, max)
    commit = next == null || next === value ? undefined : next
  }
  return { edit: { draft: null, enterAlreadySaved: source === 'enter' }, commit }
}

/** Play a focus / type / Enter / blur sequence against one saved value. */
export function runScoreEdit(value: number | null, max: number, actions: ScoreAction[]): Array<number | null> {
  let edit: ScoreEdit = { draft: null, enterAlreadySaved: false }
  const saves: Array<number | null> = []
  for (const action of actions) {
    if (action.type === 'focus') {
      edit = { draft: value == null ? '' : String(value), enterAlreadySaved: false }
      continue
    }
    if (action.type === 'change') {
      edit = { draft: action.raw, enterAlreadySaved: false }
      continue
    }
    const result = commitScoreEdit(edit, value, max, action.type)
    edit = result.edit
    if (result.commit !== undefined) saves.push(result.commit)
  }
  return saves
}

/** Hand the commit to the caller. A thrown or rejected save is not caught here. */
export function applyScoreEdit(
  edit: ScoreEdit,
  value: number | null,
  max: number,
  source: 'enter' | 'blur',
  onCommit: (n: number | null) => void | Promise<unknown>,
): { edit: ScoreEdit; pending?: Promise<unknown> } {
  const result = commitScoreEdit(edit, value, max, source)
  if (result.commit === undefined) return { edit: result.edit }
  const pending = onCommit(result.commit)
  if (pending && typeof (pending as Promise<unknown>).then === 'function') {
    return { edit: result.edit, pending: pending as Promise<unknown> }
  }
  return { edit: result.edit }
}

/** Null shows the stored score. A failed save puts the typed text back. */
export function draftAfterScoreSave(typed: string, ok: boolean): string | null {
  return ok ? null : typed
}
