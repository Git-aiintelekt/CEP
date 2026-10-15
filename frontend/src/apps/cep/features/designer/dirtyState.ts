/**
 * Whether the design has changed since it was last saved or loaded.
 *
 * GrapesJS's own getDirtyCount() cannot answer this: with storageManager disabled it rises to 1 and resets
 * itself a frame later, so undo and redo were read as clean. The editor's 'update' event is the reliable
 * signal — it fires for content edits, renames, moves, adds and removes, and never for merely selecting,
 * hovering or opening a layer. Undo and redo are counted alongside it, since undoing some changes (a layer
 * rename, for one) raises only 'undo'.
 */
export interface DirtyState {
  /** changed since the last save or load */
  edited: boolean
  /** the value last handed to onDirtyChange, so it is called only when the answer changes */
  reported: boolean
}

export const CLEAN: DirtyState = { edited: false, reported: false }

export type DirtyEvent =
  /** the model changed; while a stored design is loading, that is not the reader's doing */
  | { kind: 'edit'; loading: boolean }
  /** saved, or a stored design finished loading: the document on screen is now the reference point */
  | { kind: 'settle' }
  /** opening a repaired design, which must be saved again before its stored HTML is right */
  | { kind: 'set'; edited: boolean }

export function applyDirty(state: DirtyState, event: DirtyEvent): { state: DirtyState; notify: boolean } {
  const edited =
    event.kind === 'edit' ? (event.loading ? state.edited : true)
    : event.kind === 'settle' ? false
    : event.edited

  return { state: { edited, reported: edited }, notify: edited !== state.reported }
}
