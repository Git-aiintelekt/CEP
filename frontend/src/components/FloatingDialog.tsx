import { useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { BREAKPOINT, useMinWidth } from '@/lib/useMediaQuery'

import { useDialogBehaviour } from './useDialogBehaviour'
import { useEditorTypeClass } from './editorScope'

interface FloatingDialogProps {
  /** id of the element that names the dialog, usually the heading inside `header` */
  labelledBy: string
  onClose: () => void
  /** pinned at the top; the caller owns its padding and hairline */
  header: ReactNode
  /** the only part that scrolls */
  children: ReactNode
  /** pinned at the bottom; clears the phone's home bar */
  footer?: ReactNode
  returnFocus?: () => HTMLElement | null
  /** px from md up; never wider than the viewport minus 48px */
  width?: number
  /** a CSS length capping the height from md up; the panel is as tall as its content up to it */
  maxHeight?: string
  /** columns: from md up the body doesn't scroll itself; its children sit side by side and each scrolls on its own */
  bodyScroll?: 'body' | 'columns'
  /** from md up, dim the page behind it (a pop-up to fill in rather than a peek) */
  dim?: boolean
  /** on phones, the sheet takes the whole screen */
  fullSheet?: boolean
}

/**
 * A modal dialog for looking at something without leaving the page. From md up it floats (760px unless told) over the page with
 * no dimming (an invisible layer still catches outside clicks); on phones it is a bottom sheet over the scrim.
 * The behaviour is Modal's: labelled, focus kept inside, Escape (after any open menu) closes, focus goes back on close.
 */
export function FloatingDialog({ labelledBy, onClose, header, children, footer, returnFocus, width = 760, maxHeight = 'calc(100dvh - 96px)', bodyScroll = 'body', dim = false, fullSheet = false }: FloatingDialogProps) {
  const panel = useRef<HTMLDivElement>(null)
  const wide = useMinWidth(BREAKPOINT.md)
  useDialogBehaviour(panel, onClose, { returnFocus, escapeClosesMenusFirst: true })

  const closeOutside = (event: React.MouseEvent) => event.target === event.currentTarget && onClose()
  const editorType = useEditorTypeClass()
  return createPortal(
    wide ? (
      <div data-dialog-layer={dim ? 'scrim' : 'clear'} className={`${editorType} fixed inset-0 z-50 flex items-center justify-center px-6 py-12 ${dim ? 'animate-fade-in bg-scrim motion-reduce:animate-none' : ''}`} onMouseDown={closeOutside}>
        <div
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          style={{ width, maxHeight }}
          className="flex max-w-full animate-fade-in flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-toast motion-reduce:animate-none"
        >
          <div className="shrink-0">{header}</div>
          <div className={bodyScroll === 'columns' ? 'flex min-h-0 flex-1 overflow-hidden' : 'min-h-0 flex-1 overflow-y-auto overscroll-contain'}>{children}</div>
          {footer && <div className="shrink-0">{footer}</div>}
        </div>
      </div>
    ) : (
      <div data-dialog-layer="scrim" className={`${editorType} fixed inset-0 z-50 flex animate-fade-in items-end bg-scrim motion-reduce:animate-none`} onMouseDown={closeOutside}>
        <div
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          className={`flex w-full animate-sheet-up flex-col overflow-hidden bg-surface motion-reduce:animate-none ${fullSheet ? 'h-dvh' : 'h-[90dvh] rounded-t-lg'}`}
        >
          {!fullSheet && <div aria-hidden className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-fill-muted" />}
          <div className="shrink-0">{header}</div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
          {footer && <div className="shrink-0 pb-[env(safe-area-inset-bottom)]">{footer}</div>}
        </div>
      </div>
    ),
    document.body,
  )
}
