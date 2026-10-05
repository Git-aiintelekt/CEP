import type { LucideIcon } from 'lucide-react'
import { useRef, type KeyboardEvent } from 'react'

import { tabId, tabPanelId } from './tabIds'
import { Tooltip } from './Tooltip'

export interface TabItem<T extends string> {
  id: T
  label: string
  icon?: LucideIcon
  /** the tab can't be chosen; this sentence says why, in a tooltip */
  disabledReason?: string
}

const SIZE = {
  /** the editor's main views */
  md: { list: 'gap-6', tab: 'h-10 text-sm', icon: 16 },
  /** inside a side panel */
  sm: { list: 'gap-4', tab: 'h-8 text-xs', icon: 14 },
}

interface TabsProps<T extends string> {
  label: string
  tabs: TabItem<T>[]
  value: T
  onChange: (id: T) => void
  /** prefix for the tab and panel ids; the caller's panel uses tabPanelId(idPrefix, id) */
  idPrefix: string
  size?: keyof typeof SIZE
}

/**
 * Underline tabs. Sit them flush on a bar that has a bottom hairline: the 2px underline overlaps it.
 * Arrow keys move and activate in one step, because each tab owns its panel.
 */
export function Tabs<T extends string>({ label, tabs, value, onChange, idPrefix, size = 'md' }: TabsProps<T>) {
  const refs = useRef(new Map<T, HTMLButtonElement | null>())
  const style = SIZE[size]

  const go = (id: T) => {
    onChange(id)
    refs.current.get(id)?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const open = tabs.filter((tab) => !tab.disabledReason)
    const index = open.findIndex((tab) => tab.id === value)
    const next =
      event.key === 'ArrowRight' ? (index + 1) % open.length
      : event.key === 'ArrowLeft' ? (index - 1 + open.length) % open.length
      : event.key === 'Home' ? 0
      : event.key === 'End' ? open.length - 1
      : -1
    if (next === -1) return
    event.preventDefault()
    go(open[next].id)
  }

  return (
    <div role="tablist" aria-label={label} className={`flex items-stretch self-stretch ${style.list}`}>
      {tabs.map(({ id, label: text, icon: Icon, disabledReason }) => {
        const active = id === value
        if (disabledReason) {
          return (
            <Tooltip key={id} content={disabledReason}>
              <button
                type="button"
                role="tab"
                id={tabId(idPrefix, id)}
                aria-selected={false}
                aria-disabled
                tabIndex={-1}
                className={`-mb-px inline-flex shrink-0 cursor-not-allowed items-center gap-2 border-b-2 border-transparent font-semibold whitespace-nowrap text-ink-300 ${style.tab}`}
              >
                {Icon && <Icon size={style.icon} strokeWidth={1.5} aria-hidden />}
                {text}
              </button>
            </Tooltip>
          )
        }
        return (
          <button
            key={id}
            ref={(node) => {
              refs.current.set(id, node)
            }}
            type="button"
            role="tab"
            id={tabId(idPrefix, id)}
            aria-selected={active}
            aria-controls={tabPanelId(idPrefix, id)}
            tabIndex={active ? 0 : -1}
            onClick={() => go(id)}
            onKeyDown={onKeyDown}
            className={`-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 font-semibold whitespace-nowrap transition-colors duration-base ease-standard ${style.tab} ${
              active ? 'border-brand-600 text-brand-800' : 'border-transparent text-ink-800 hover:text-ink-900'
            }`}
          >
            {Icon && <Icon size={style.icon} strokeWidth={1.5} aria-hidden />}
            {text}
          </button>
        )
      })}
    </div>
  )
}
