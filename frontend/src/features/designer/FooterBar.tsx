/** The editor's bottom bar: where you stand, and what you can do next. Back lives in the top bar, as designed. */
import { CircleCheck, Save } from 'lucide-react'
import { useId } from 'react'

import { Spinner } from '@/components/States'

import type { summarise } from './issues'

type Summary = ReturnType<typeof summarise>

const BUTTON = 'inline-flex h-9 shrink-0 items-center gap-2 rounded-sm text-[13px] font-semibold whitespace-nowrap transition-colors duration-base ease-standard'
const SECONDARY = `${BUTTON} bg-brand-600 px-[14px] text-white hover:bg-brand-800`
const SECONDARY_BUSY = `${BUTTON} cursor-not-allowed bg-line-subtle px-[14px] text-ink-300`
const PRIMARY = `${BUTTON} bg-brand-600 px-4 text-white hover:bg-brand-800`
const PRIMARY_DISABLED = `${BUTTON} cursor-not-allowed bg-line px-4 text-ink-300`

export interface FooterAction {
  label: string
  onClick: () => void
  busy?: boolean
  disabled?: boolean
  disabledReason?: string
}

interface FooterBarProps {
  note: string
  noteTone?: 'default' | 'danger'
  save?: { onClick: () => void; busy?: boolean }
  primary?: FooterAction
}

/** What the footer says about the design, most urgent first. */
// eslint-disable-next-line react-refresh/only-export-components
export function footerNote(summary: Summary, flaggedLinks: number): { text: string; tone: 'default' | 'danger' } {
  if (summary.errors > 0) return { text: summary.note, tone: 'danger' }
  if (flaggedLinks > 0) return { text: `${flaggedLinks} link ${flaggedLinks === 1 ? 'warning' : 'warnings'} · advisory only.`, tone: 'default' }
  if (summary.warnings > 0) return { text: summary.note, tone: 'default' }
  return { text: 'No errors.', tone: 'default' }
}

export function FooterBar({ note, noteTone = 'default', save, primary }: FooterBarProps) {
  const reasonId = useId()

  return (
    <div className="flex items-center justify-between gap-4 border-t border-line bg-surface px-6 py-3">
      <p aria-live="polite" className={`min-w-0 flex-1 truncate text-helper ${noteTone === 'danger' ? 'text-danger-text' : 'text-ink-700'}`}>
        {note}
      </p>

      <div className="flex shrink-0 items-center gap-3">
        {save && (
          <button type="button" className={save.busy ? SECONDARY_BUSY : SECONDARY} disabled={save.busy} onClick={save.onClick}>
            {save.busy ?
              <Spinner className="h-[15px] w-[15px]" />
            : <Save size={15} strokeWidth={1.5} aria-hidden />}
            {save.busy ? 'Saving…' : 'Save Draft'}
          </button>
        )}
        {primary && (
          <>
            <button
              type="button"
              className={primary.disabled ? PRIMARY_DISABLED : PRIMARY}
              // aria-disabled, not disabled: the button keeps its place in the tab order so the reason can be read
              aria-disabled={primary.disabled || undefined}
              aria-describedby={primary.disabled && primary.disabledReason ? reasonId : undefined}
              title={primary.disabled ? primary.disabledReason : undefined}
              onClick={() => {
                if (!primary.disabled && !primary.busy) primary.onClick()
              }}
            >
              {primary.busy && <Spinner className="h-[15px] w-[15px] border-brand-800 border-t-white" />}
              {primary.label}
              {!primary.busy && <CircleCheck size={15} strokeWidth={1.5} aria-hidden />}
            </button>
            {primary.disabled && primary.disabledReason && (
              <span id={reasonId} className="sr-only">
                {primary.disabledReason}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  )
}
