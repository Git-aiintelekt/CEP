/**
 * What turns a field's three callbacks into edits on a component.
 *
 * A drag arrives as many onPreview calls and one onCommit. The first preview opens a grouped edit, every
 * preview writes normally so the canvas keeps up, and the commit rolls the previews back and writes the final
 * value once — so the whole drag costs one undo step. A field that only ever commits (a switch, a select, a
 * text field on Enter) writes once and never opens a group at all.
 *
 * Nothing here imports React or GrapesJS: a test stands one up with a plain object for each.
 */
import type { Component } from 'grapesjs'

import {
  LABEL_KEY, beginGroupedEdit, cancelGroupedEdit, endGroupedEdit, writeContent, writeSetting, type GroupedEditor,
} from './settings'

export interface SettingHandlers {
  onPreview: (value: string) => void
  onCommit: (value: string | null) => void
  onCancel: () => void
}

export interface SettingBinder {
  /** the three callbacks a field takes, for one setting */
  handlers: (key: string) => SettingHandlers
  /** abandon anything still being previewed; called when the selection moves or the panel goes away */
  release: () => void
  /** true while a drag is open, so a caller can tell a preview apart from a settled value */
  previewing: () => boolean
}

export function createSettingBinder(editor: GroupedEditor, component: Component): SettingBinder {
  let openKey: string | null = null

  const release = () => {
    if (openKey === null) return
    openKey = null
    cancelGroupedEdit(editor, component)
  }

  return {
    previewing: () => openKey !== null,
    release,
    handlers: (key: string): SettingHandlers => ({
      onPreview: (value) => {
        // a second field starting a drag while another is open would lose the first one's snapshot
        if (openKey !== null && openKey !== key) release()
        if (openKey === null) {
          openKey = key
          beginGroupedEdit(editor, component)
        }
        writeSetting(component, key, value)
      },

      onCommit: (value) => {
        if (openKey === key) {
          openKey = null
          endGroupedEdit(editor, component, key, value)
          return
        }
        if (openKey !== null) release()
        // a button's label is content, and clearing it would leave a button with nothing to read
        if (key === LABEL_KEY && value !== null) writeContent(component, value)
        else if (key !== LABEL_KEY) writeSetting(component, key, value)
      },

      onCancel: release,
    }),
  }
}
