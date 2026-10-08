/**
 * The picker hung off a button: 320px wide, capped at 360px, below the button or above it when the room below
 * has run out. Rendered into the body so no panel can clip it. Opening, closing, Escape and clicking outside
 * are the caller's useSingleDropdown; this only places the panel and hands the choice back.
 */
import { useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import type { SingleDropdown } from '@/lib/useSingleDropdown'

import { TagPicker, type TagPickerProps } from './TagPicker'
import { POPOVER_WIDTH, placePopover, type Placement } from './placement'

export const PICKER_LABEL = 'Insert Tag'

export interface TagPickerPopoverProps<K extends string> extends Omit<TagPickerProps, 'onClose'> {
  dropdown: SingleDropdown<K>
  id: K
  /** the button the panel hangs off; a plain element, so a button GrapesJS drew works as well as one of ours */
  anchor: HTMLElement | null
}

export function TagPickerPopover<K extends string>({ dropdown, id, anchor, onPick, ...picker }: TagPickerPopoverProps<K>) {
  const open = dropdown.isOpen(id)
  const [at, setAt] = useState<Placement | null>(null)

  useLayoutEffect(() => {
    if (!open || anchor === null) return
    const place = () => setAt(placePopover(anchor.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }))
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, anchor])

  if (!open || at === null) return null
  const { ref: attach, id: panelId } = dropdown.panelProps(id)

  return createPortal(
    <div
      ref={attach}
      id={panelId}
      role="region"
      aria-label={PICKER_LABEL}
      style={{ left: at.left, top: at.top, bottom: at.bottom, width: POPOVER_WIDTH }}
      // A press in here must not read as a press on the page beneath: the canvas ends a text edit on one. The
      // search box keeps the default, so a click still places its caret; nothing else in here needs focus.
      onMouseDown={(event) => {
        event.stopPropagation()
        if (!(event.target instanceof HTMLInputElement)) event.preventDefault()
      }}
      className="editor-radii editor-type fixed z-50 rounded-md border border-line bg-surface shadow-menu"
    >
      <TagPicker
        {...picker}
        onPick={(key) => {
          // whoever asked decides where focus goes next: the input, the canvas, or back to the button
          dropdown.close({ restoreFocus: false })
          onPick(key)
        }}
        onClose={() => dropdown.close()}
      />
    </div>,
    document.body,
  )
}
