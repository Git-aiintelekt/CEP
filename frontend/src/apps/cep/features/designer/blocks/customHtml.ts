/**
 * A Custom HTML block is one block: its markup is edited in the settings panel, never picked apart on the canvas.
 *
 * The MJML plugin parses the table inside an mj-raw into components of its own (table, tbody, row, cell), so a click
 * on the block used to select a Cell that has no settings, and the HTML field was never reached. Everything inside
 * an mj-raw is made inert (not selectable, hoverable, draggable or listed in Layers), for the markup it starts with
 * and for whatever the panel writes into it later.
 */
import type { Component, Editor } from 'grapesjs'

import { RAW_PARENTS } from './rawPlacement'
import { makeInert } from './receiptSlot'

export const CUSTOM_HTML_TYPE = 'mj-raw'

export function registerCustomHtmlType(editor: Editor): void {
  const raw = editor.Components.getType(CUSTOM_HTML_TYPE)?.model.prototype as { init?: (this: Component) => void } | undefined
  editor.Components.addType(CUSTOM_HTML_TYPE, {
    extend: CUSTOM_HTML_TYPE,
    // re-adding a type does not carry its recogniser over: without this an inserted <mj-raw> became a plain "Block"
    isComponent: (el: HTMLElement) => el.tagName === 'MJ-RAW',
    model: {
      // the plugin lets a raw block into the body only; nothing may be dropped into one, its markup is the panel's
      defaults: { draggable: RAW_PARENTS, droppable: false },
      init(this: Component) {
        raw?.init?.call(this)
        this.components().forEach(makeInert)
        this.listenTo(this.components(), 'add', makeInert)
      },
    },
  })
}
