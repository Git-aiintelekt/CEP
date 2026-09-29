/**
 * Where the selection sits: the email body down to the selected block. Every ancestor is a button that selects
 * it; the last crumb is the block itself. Knows nothing about GrapesJS.
 */
import { ChevronRight, Monitor, Smartphone } from 'lucide-react'

export const SELECTED_LABEL = 'Selected'
export const NOTHING_SELECTED = 'Nothing selected'
export const ELLIPSIS = '…'
/** the crumbs kept when a chain is long: the last ones, since the nearest ancestors are the useful ones */
export const CRUMBS_SHOWN = 4

/** Worded apart from the layers tree's canvas-only hiding: this block ships and sends. */
export const PHONES_TAG_LABEL = 'Hidden on Phones'
export const PHONES_TAG_NOTE = 'Hidden on phones. It is sent, but phones do not show it.'
export const DESKTOP_TAG_LABEL = 'Hidden on Desktop'
export const DESKTOP_TAG_NOTE = 'Hidden on desktop. It is sent, but only phones show it.'

export interface Crumb {
  id: string
  name: string
  /** carries the hide-on-phones class, so the row says so next to its name */
  hiddenOnPhones?: boolean
  hiddenOnDesktop?: boolean
}

export interface BreadcrumbProps {
  crumbs: Crumb[]
  onSelect: (id: string) => void
}

export function Breadcrumb({ crumbs, onSelect }: BreadcrumbProps) {
  const dropped = Math.max(0, crumbs.length - CRUMBS_SHOWN)
  const shown = crumbs.slice(dropped)
  const hiddenNames = crumbs.slice(0, dropped).map((crumb) => crumb.name).join(' › ')

  return (
    <nav aria-label="Selection" className="flex h-8 shrink-0 items-center gap-1 overflow-hidden border-b border-line bg-surface pr-3 pl-4 whitespace-nowrap">
      <span className="mr-1 shrink-0 text-xs text-ink-500">{SELECTED_LABEL}</span>
      {crumbs.length === 0 ?
        <span className="text-sm text-ink-500">{NOTHING_SELECTED}</span>
      : <ol className="flex min-w-0 items-center gap-1">
          {dropped > 0 ?
            <li className="flex items-center gap-1">
              <span title={hiddenNames} aria-label={`${dropped} more above`} className="text-sm text-ink-500">
                {ELLIPSIS}
              </span>
              <Separator />
            </li>
          : null}
          {shown.map((crumb, index) => {
            const last = index === shown.length - 1
            return (
              <li key={crumb.id} className="flex min-w-0 items-center gap-1">
                {last ?
                  <>
                    <span aria-current="location" className="truncate text-sm font-semibold text-ink-900">
                      {crumb.name}
                    </span>
                    {crumb.hiddenOnPhones ? <PhonesTag /> : null}
                    {crumb.hiddenOnDesktop ? <DesktopTag /> : null}
                  </>
                : <>
                    <button
                      type="button"
                      onClick={() => onSelect(crumb.id)}
                      className="h-6 max-w-40 truncate rounded-sm px-1.5 text-sm text-ink-700 transition-colors duration-base ease-standard hover:bg-line-subtle"
                    >
                      {crumb.name}
                    </button>
                    <Separator />
                  </>
                }
              </li>
            )
          })}
        </ol>
      }
    </nav>
  )
}

function Separator() {
  return <ChevronRight size={14} strokeWidth={1.5} aria-hidden className="shrink-0 text-ink-300" />
}

const TAG = 'ml-1 inline-flex h-[18px] shrink-0 items-center gap-1 rounded-sm bg-line-subtle px-1.5 text-[11px] font-semibold text-ink-700'

function PhonesTag() {
  return (
    <span title={PHONES_TAG_NOTE} className={TAG}>
      <Smartphone size={11} strokeWidth={1.5} aria-hidden />
      {PHONES_TAG_LABEL}
    </span>
  )
}

function DesktopTag() {
  return (
    <span title={DESKTOP_TAG_NOTE} className={TAG}>
      <Monitor size={11} strokeWidth={1.5} aria-hidden />
      {DESKTOP_TAG_LABEL}
    </span>
  )
}
