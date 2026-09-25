/** The History control in the tab bar: a dropdown of every saved version, newest first, with a Load on each. */
import { History } from 'lucide-react'

import { Pill } from '@/components/Pill'
import { Popover, PopoverHeading } from '@/components/Popover'
import { Spinner } from '@/components/States'
import { formatDateTime } from '@/lib/format'
import type { DesignVersion } from '@/lib/types'
import type { SingleDropdown } from '@/lib/useSingleDropdown'

import type { PillKey } from './IssuePills'

export const HISTORY_LABEL = 'History'
export const HISTORY_HEADING = 'Version History'
export const HISTORY_EMPTY = 'Nothing saved yet.'
export const HISTORY_FAILED = 'The server did not answer. Your last saved version is safe.'
export const CURRENT_LABEL = 'Current'
export const LOAD_LABEL = 'Load'

export interface HistoryMenuProps {
  /** null while the list is being fetched */
  versions: DesignVersion[] | null
  failed?: boolean
  /** the version on the canvas, and the newest one that exists */
  shown: number
  latest: number
  busy?: boolean
  controller: SingleDropdown<PillKey>
  onOpen?: () => void
  onLoad: (version: number) => void
  /** a second menu in the same bar needs its own key and its own name */
  pillKey?: PillKey
  label?: string
  heading?: string
}

const ROW_BUTTON = 'h-7 shrink-0 rounded-sm border px-[10px] text-xs font-semibold transition-colors duration-base ease-standard cep-focus-inset'

export function HistoryMenu({
  versions, failed = false, shown, latest, busy = false, controller, onOpen, onLoad, pillKey = 'history', label = HISTORY_LABEL, heading = HISTORY_HEADING,
}: HistoryMenuProps) {
  const trigger = controller.triggerProps(pillKey)
  const open = controller.isOpen(pillKey)
  const ordered = [...(versions ?? [])].sort((a, b) => b.version_number - a.version_number)

  return (
    <div className="relative">
      <Pill
        {...trigger}
        title={heading}
        icon={History}
        open={open}
        onClick={() => {
          if (!open) onOpen?.()
          trigger.onClick()
        }}
      >
        {label}
      </Pill>

      {open ?
        <Popover label={heading} width={360} placement="bottom-end" {...controller.panelProps(pillKey)}>
          <PopoverHeading>{heading}</PopoverHeading>
          <div className="max-h-80 overflow-y-auto">
            {failed ?
              <p className="px-3 py-3 text-helper text-ink-700">{HISTORY_FAILED}</p>
            : versions === null ?
              <p className="flex items-center gap-2 px-3 py-3 text-helper text-ink-700">
                <Spinner className="h-4 w-4" /> Loading
              </p>
            : ordered.length === 0 ?
              <p className="px-3 py-3 text-helper text-ink-700">{HISTORY_EMPTY}</p>
            : ordered.map((version) => {
                const number = version.version_number
                const isShown = number === shown
                const current = number === latest && isShown
                const meta = [formatDateTime(version.saved_at), version.saved_by].filter(Boolean).join(' · ')
                return (
                  <div key={number} className={`flex items-center gap-2.5 border-b border-line-subtle px-3 py-2.5 transition-colors duration-base ease-standard last:border-b-0 ${isShown ? 'bg-surface-subtle' : 'hover:bg-surface-subtle'}`}>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-helper font-semibold text-ink-900">
                        Version {number}
                        {current ? <span className="font-normal text-ink-700"> · current</span> : null}
                      </span>
                      <span className="truncate text-xs text-ink-700" title={meta}>
                        {meta}
                      </span>
                    </span>
                    <button
                      type="button"
                      data-dropdown-item
                      aria-disabled={isShown || busy || undefined}
                      onClick={isShown || busy ? undefined : () => onLoad(number)}
                      className={`${ROW_BUTTON} ${isShown || busy ? 'cursor-not-allowed border-line bg-line-subtle text-ink-300' : 'border-line bg-surface text-ink-900 hover:bg-line-subtle'}`}
                    >
                      {current ? CURRENT_LABEL : LOAD_LABEL}
                    </button>
                  </div>
                )
              })
            }
          </div>
        </Popover>
      : null}
    </div>
  )
}
