/**
 * A modal panel from the right edge, over the scrim: 480px on a wide screen, the whole screen on a phone. It slides in,
 * holds focus while open (useDialogBehaviour, the same as Modal: Tab stays inside, Escape closes, focus goes back to
 * the opener), and has a fixed header and footer around a body that scrolls. The Sequence step's message drawer uses it.
 */
import { X } from 'lucide-react'
import { useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { IconButton } from './Button'
import { useDialogBehaviour } from './useDialogBehaviour'
import { useEditorTypeClass } from './editorScope'

interface DrawerProps {
  title: string
  /** a small line above the title: "Message 2 of 4" */
  eyebrow?: string
  onClose: () => void
  children: ReactNode
  /** fixed under the body: the drawer's actions */
  footer?: ReactNode
  /** a banner between the header and the body that does not scroll away */
  banner?: ReactNode
}

export function Drawer({ title, eyebrow, onClose, children, footer, banner }: DrawerProps) {
  const titleId = useId()
  const panel = useRef<HTMLElement>(null)
  useDialogBehaviour(panel, onClose, { escapeClosesMenusFirst: true })

  const editorType = useEditorTypeClass()
  return createPortal(
    <div className={`${editorType} fixed inset-0 z-50 flex justify-end`}>
      <div aria-hidden data-drawer-scrim className="absolute inset-0 animate-fade-in bg-scrim motion-reduce:animate-none" onMouseDown={onClose} />
      <aside ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="relative flex h-full w-full animate-slide-in-right flex-col bg-surface shadow-drawer motion-reduce:animate-none md:w-[480px]">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            {eyebrow && <span className="cep-num text-xs text-ink-800">{eyebrow}</span>}
            <h2 id={titleId} className="font-display text-card-heading font-semibold text-pretty text-ink-900">{title}</h2>
          </div>
          <IconButton label="Close" icon={X} size="sm" onClick={onClose} className="-mr-2" />
        </div>
        {banner && <div className="shrink-0 px-6 pt-4">{banner}</div>}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">{children}</div>
        {footer && <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-6 py-4">{footer}</div>}
      </aside>
    </div>,
    document.body,
  )
}
