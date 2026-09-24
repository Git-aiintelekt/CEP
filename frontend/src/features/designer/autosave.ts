/** When the workspace saves a draft by itself. Pure, so the rule is tested without the editor. */

/** How long after the last edit the draft is saved on its own. */
export const AUTOSAVE_MS = 30_000

export interface AutosaveState {
  dirty: boolean
  readOnly: boolean
  /** the last save was refused as someone else's version: nothing goes out until the reader reloads */
  conflict: boolean
  /** an older version is on the canvas: saving it as the newest is the reader's call, never the clock's */
  restored: boolean
  busy: boolean
  /** the edits as they stand: the canvas tick with the subject and the preheader */
  stamp: string
  /** the stamp an automatic save failed on; the same edits are not retried until something changes */
  failedStamp: string | null
}

export function autosaveDue(state: AutosaveState): boolean {
  return state.dirty && !state.readOnly && !state.conflict && !state.restored && !state.busy && state.stamp !== state.failedStamp
}
