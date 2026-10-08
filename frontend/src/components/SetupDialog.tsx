/**
 * The one frame every create pop-up sits in (Campaign, Contact List, Journey, Template; the "Setup Dialog" design):
 * a 768px dialog with a fixed header (title, close, and for multi-step flows the step line over a segmented bar), a body
 * that scrolls, one error banner at the top of the body, and a fixed footer: Back at the far left from step 2, Cancel
 * then the primary at the right. On phones it is a full-height sheet. The flows keep their own fields and logic.
 */
import { ChevronLeft, X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { IconButton } from './Button'
import { buttonPrimary, buttonSecondary } from './Form'
import { Notice } from './Notice'
import { Spinner } from './States'
import { useDialogBehaviour } from './useDialogBehaviour'

export interface SetupPrimary {
  /** "Next", or on the last step "Create {Thing}" */
  label: string
  disabled?: boolean
  /** saving: a spinner, and a second press does nothing */
  busy?: boolean
  /** read by screen readers while busy: "Creating" */
  busyLabel?: string
  onClick?: () => void
  /** submits this form instead of calling onClick */
  form?: string
}

export interface SetupError {
  title: string
  message: ReactNode
  onRetry?: () => void
}

interface SetupDialogProps {
  /** "Create Campaign" */
  title: string
  /** the steps' names; one step (or none) shows no step line */
  steps?: string[]
  /** 1-based */
  step?: number
  onClose: () => void
  /** Back shows when given (step 2 on) */
  onBack?: () => void
  primary: SetupPrimary
  /** more footer actions, left of Cancel: "Continue in the Background" */
  extraActions?: ReactNode
  /** no Cancel (a finished flow whose only way out is the primary) */
  hideCancel?: boolean
  /** Close, Cancel and Back wait while this is true (a save in flight) */
  locked?: boolean
  error?: SetupError | null
  /** any other banner at the top of the body (a 409 conflict) */
  banner?: ReactNode
  /** 1040px instead of 768px: the template gallery */
  wide?: boolean
  children: ReactNode
}

/** The step line and the bar: one 4px segment per step, done and current in Blue 600. */
function StepLine({ steps, step }: { steps: string[]; step: number }) {
  return (
    <div data-setup-steps className="flex flex-col gap-2">
      <span className="text-helper text-ink-800">Step {step} of {steps.length} · {steps[step - 1]}</span>
      <div role="progressbar" aria-label="Setup Progress" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={step} aria-valuetext={`Step ${step} of ${steps.length}`} className="flex gap-1">
        {steps.map((name, index) => <span key={name} className={`h-1 flex-1 rounded-xs ${index < step ? 'bg-brand-600' : 'bg-fill-subtle'}`} />)}
      </div>
    </div>
  )
}

export function SetupDialog({ title, steps = [], step = 1, onClose, onBack, primary, extraActions, hideCancel = false, locked = false, error, banner, wide = false, children }: SetupDialogProps) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  // the dialog keeps the close handler it opened with, so it reads the lock through a ref
  const lockedNow = useRef(locked)
  useEffect(() => { lockedNow.current = locked }, [locked])
  const close = () => { if (!lockedNow.current) onClose() }
  useDialogBehaviour(panel, close, { escapeClosesMenusFirst: true })

  const press = () => { if (!primary.busy && !primary.disabled) primary.onClick?.() }
  return createPortal(
    <div className="fixed inset-0 z-50 flex animate-fade-in items-stretch justify-center bg-scrim motion-reduce:animate-none md:items-center md:p-6"
      onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} data-setup-dialog
        className={`flex w-full flex-col bg-surface max-md:h-dvh md:max-h-[calc(100dvh-48px)] md:rounded-lg ${wide ? 'md:max-w-[1040px]' : 'md:max-w-[768px]'}`}>
        <header className="flex shrink-0 flex-col gap-2.5 border-b border-line-subtle px-6 pt-5 pb-4">
          <div className="flex items-center justify-between gap-4">
            <h2 id={titleId} className="font-display text-card-heading font-semibold text-ink-900">{title}</h2>
            <IconButton label="Close" icon={X} onClick={close} disabled={locked} />
          </div>
          {steps.length > 1 && <StepLine steps={steps} step={step} />}
        </header>

        <div data-setup-body className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6" aria-busy={primary.busy || undefined}>
          {error && (
            <Notice tone="error" layout="banner" title={error.title}
              action={error.onRetry && <button type="button" className={buttonSecondary} onClick={error.onRetry}>Try Again</button>}>
              {typeof error.message === 'string' ? <p>{error.message}</p> : error.message}
            </Notice>
          )}
          {banner}
          {children}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line-subtle px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {onBack && (
            <button type="button" className={buttonSecondary} onClick={onBack} disabled={locked}>
              <ChevronLeft size={16} strokeWidth={1.5} aria-hidden />Back
            </button>
          )}
          <span className="flex-1" />
          {extraActions}
          {!hideCancel && <button type="button" className={buttonSecondary} onClick={close} disabled={locked}>Cancel</button>}
          <button type={primary.form ? 'submit' : 'button'} form={primary.form} onClick={primary.form ? undefined : press}
            disabled={primary.disabled} aria-disabled={primary.busy || undefined} className={buttonPrimary}>
            {primary.busy && <Spinner size="sm" tone="onBrand" label={primary.busyLabel} />}
            {primary.label}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
