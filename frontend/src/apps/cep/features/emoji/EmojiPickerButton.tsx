/**
 * The emoji button beside an input and the popover it opens, the same shell as the tag picker's: 320px wide, capped at
 * 360px, below the button or above it when the room below has run out, rendered into the body so no panel clips it.
 * `EmojiPickerPopover` alone serves a button someone else drew (the rich-text toolbar of the email designer).
 */
import { Smile } from 'lucide-react'
import { useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { POPOVER_WIDTH, placePopover, type Placement } from '@/apps/cep/features/designer/tags/placement'
import { useSingleDropdown, type SingleDropdown } from '@/lib/useSingleDropdown'

import { EmojiPicker, PICKER_LABEL } from './EmojiPicker'

export interface EmojiPickerPopoverProps<K extends string> {
  dropdown: SingleDropdown<K>
  id: K
  anchor: HTMLElement | null
  onPick: (emoji: string) => void
}

export function EmojiPickerPopover<K extends string>({ dropdown, id, anchor, onPick }: EmojiPickerPopoverProps<K>) {
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
  const { ref: attach, id: panelId, onKeyDown } = dropdown.panelProps(id)
  return createPortal(
    <div ref={attach} id={panelId} role="region" aria-label={PICKER_LABEL} onKeyDown={onKeyDown}
      style={{ left: at.left, top: at.top, bottom: at.bottom, width: POPOVER_WIDTH }}
      // a press in here must not read as a press on the page beneath (the canvas ends a text edit on one); the search box keeps its caret
      onMouseDown={(event) => {
        event.stopPropagation()
        if (!(event.target instanceof HTMLInputElement)) event.preventDefault()
      }}
      className="editor-radii editor-type fixed z-50 rounded-md border border-line bg-surface-overlay shadow-menu">
      <EmojiPicker onPick={onPick} onClose={() => dropdown.close({ restoreFocus: false })} />
    </div>,
    document.body,
  )
}

export interface EmojiPickerButtonProps {
  onPick: (emoji: string) => void
  disabled?: boolean
  /** called as the panel opens, before focus moves into it: the moment to note where the caret is */
  onOpen?: () => void
  /** `inset` is the 26px borderless button that sits inside a field */
  variant?: 'standalone' | 'inset'
  onOpenChange?: (open: boolean) => void
}

export function EmojiPickerButton({ onPick, disabled = false, onOpen, variant = 'standalone', onOpenChange }: EmojiPickerButtonProps) {
  const dropdown = useSingleDropdown<'emoji'>()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const trigger = dropdown.triggerProps('emoji')
  const open = dropdown.isOpen('emoji')
  const inset = variant === 'inset'

  useEffect(() => {
    onOpenChange?.(open)
  }, [open, onOpenChange])

  return (
    <>
      <button
        {...trigger}
        ref={(node) => {
          trigger.ref(node)
          setAnchor(node)
        }}
        type="button"
        aria-label={PICKER_LABEL}
        title={PICKER_LABEL}
        aria-disabled={disabled || undefined}
        onClick={disabled ? undefined : () => {
          if (!dropdown.isOpen('emoji')) onOpen?.()
          trigger.onClick()
        }}
        className={
          inset ?
            `inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-sm transition-colors duration-base ease-standard ${
              disabled ? 'cursor-not-allowed bg-fill-subtle text-ink-300' : open ? 'bg-brand-100 text-link' : 'text-ink-800 hover:bg-fill-muted'}`
          : `inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border transition-colors duration-base ease-standard ${
              disabled ? 'cursor-not-allowed border-line bg-fill-subtle text-ink-300' : open ? 'border-link bg-brand-100 text-brand-800' : 'border-line bg-surface text-ink-800 hover:bg-surface-hover'}`
        }
      >
        <Smile size={inset ? 15 : 16} strokeWidth={1.5} aria-hidden />
      </button>
      {disabled ? null : <EmojiPickerPopover dropdown={dropdown} id="emoji" anchor={anchor} onPick={onPick} />}
    </>
  )
}
