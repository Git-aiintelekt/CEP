import { X } from 'lucide-react'
import { useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { IconButton } from './Button'
import { useDialogBehaviour } from './useDialogBehaviour'

interface ModalProps {
  title: string
  /** one line under the title: what the dialog is about or where its content comes from */
  subtitle?: string
  onClose: () => void
  children: ReactNode
  /** sticky footer, usually the action buttons */
  footer?: ReactNode
  /**
   * md is the 480px dialog; picker (640px) holds a searchable list to choose from; lg is the wider variant for forms with long
   * option lists; xl fits a 600px email preview; screen is a window in the window, four fifths wide and centred, for a preview seen large
   */
  size?: 'md' | 'picker' | 'lg' | 'xl' | 'screen'
  /** a tile before the title (the Templates create dialog's channel tile); the title steps up to 18px with it */
  leading?: ReactNode
  /** a row under the title, such as tags */
  headerExtra?: ReactNode
  /** controls at the right of the header, level with that row: a preview's device switch */
  headerActions?: ReactNode
  /** a bar between the header and the body that does not scroll with it */
  toolbar?: ReactNode
  /** the dialog stays inside the window: the body scrolls between a fixed header and footer */
  scrollBody?: boolean
}

const WIDTH = { md: 'md:max-w-[480px]', picker: 'md:max-w-[640px]', lg: 'md:max-w-3xl', xl: 'md:max-w-[880px]', screen: 'md:max-w-[min(1120px,80vw)]' }

/**
 * Accessible dialog: labelled, Escape closes, Tab stays inside, focus moves in on open and returns to the opener on close.
 * Rendered into document.body, so no transformed ancestor can become its frame and pin it to the top of the page.
 */
export function Modal({ title, subtitle, onClose, children, footer, size = 'md', leading, headerExtra, headerActions, toolbar, scrollBody = false }: ModalProps) {
  const titleId = useId()
  const subtitleId = `${titleId}-subtitle`
  const panel = useRef<HTMLDivElement>(null)

  useDialogBehaviour(panel, onClose)

  return createPortal(
    <div className={`fixed inset-0 z-50 flex animate-fade-in justify-center motion-reduce:animate-none overflow-y-auto bg-scrim p-4 ${size === 'screen' ? 'items-center' : 'items-start md:p-10'}`} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={subtitle ? subtitleId : undefined} className={`w-full rounded-lg bg-surface ${WIDTH[size]} ${scrollBody ? `flex max-h-[calc(100dvh-2rem)] flex-col ${size === 'screen' ? '' : 'md:max-h-[calc(100dvh-5rem)]'}` : ''}`}>
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-3 py-1">
            {leading}
            <div className="min-w-0">
              <h2 id={titleId} className={`font-display font-semibold text-ink-900 ${leading ? 'text-lg' : 'text-base'}`}>{title}</h2>
              {subtitle && <p id={subtitleId} className="mt-0.5 text-helper text-ink-700">{subtitle}</p>}
              {headerExtra && <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{headerExtra}</div>}
            </div>
          </div>
          {headerActions && <div className="flex shrink-0 items-center self-end pb-1">{headerActions}</div>}
          <IconButton label="Close" icon={X} onClick={onClose} />
        </div>
        {toolbar && <div className="shrink-0 border-b border-line px-4 py-2.5">{toolbar}</div>}
        <div className={scrollBody ? 'min-h-0 flex-1 overflow-y-auto px-4 py-4' : 'px-4 py-4'}>{children}</div>
        {footer && <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
