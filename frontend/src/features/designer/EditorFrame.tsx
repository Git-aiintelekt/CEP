/**
 * The chrome around a template editor: top bar, the caller's tabs, a scrolling main area and optional footer.
 * Presentational only — it owns no editor state and decides nothing about saving.
 */
import { ArrowLeft, type LucideIcon } from 'lucide-react'
import { useEffect, useId, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { NAV_BAR_WIDTH } from '@/components/NavBar'
import { StatusBadge } from '@/components/StatusBadge'
import { BREAKPOINT, useMinWidth } from '@/lib/useMediaQuery'

import { WizardTracker, type WizardTrackerProps } from './WizardTracker'

export interface EditorTabDef<T extends string = string> {
  id: T
  label: string
  Icon: LucideIcon
}

export interface EditorPane<T extends string = string> {
  id: T
  content: ReactNode
  /** the panel scrolls itself; leave off for panes such as the canvas that manage their own scrolling */
  scrolls?: boolean
}

interface EditorFrameProps<T extends string> {
  name: string
  status: string
  /** real saves only, e.g. "Version 3 · unsaved changes" */
  saveNote: string
  /** warning while there is unsaved work, so the note reads as a state and not as a timestamp */
  saveNoteTone?: 'default' | 'warning'
  backTo: string
  /** the parent may cancel the navigation, e.g. to confirm leaving unsaved work */
  onBack?: (event: MouseEvent) => void
  tabs: EditorTabDef<T>[]
  tab: T
  onTabChange: (tab: T) => void
  /** the app's navigation bar, rendered as the editor's first column */
  nav?: ReactNode
  topBarEnd?: ReactNode
  tabBarEnd?: ReactNode
  /** a strip directly under the tab bar, above whichever pane is showing */
  notice?: ReactNode
  footer?: ReactNode
  wizard?: WizardTrackerProps
  panes: EditorPane<T>[]
}

export function EditorFrame<T extends string>({
  name, status, saveNote, saveNoteTone = 'default', backTo, onBack, tabs, tab, onTabChange, nav, topBarEnd, tabBarEnd, notice, footer, wizard, panes,
}: EditorFrameProps<T>) {
  const baseId = useId()
  const tabRefs = useRef(new Map<T, HTMLButtonElement | null>())
  // the bar takes its 72px out of the room the editor itself needs
  const wideEnough = useMinWidth(BREAKPOINT.lg + (nav ? NAV_BAR_WIDTH : 0))

  // 56px top bar + 44px tab bar + 4px, matching the design's top:104
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--cep-toast-top', '104px')
    return () => {
      root.style.removeProperty('--cep-toast-top')
    }
  }, [])

  const tabId = (id: T) => `${baseId}-tab-${id}`
  const panelId = (id: T) => `${baseId}-panel-${id}`

  const go = (id: T) => {
    onTabChange(id)
    tabRefs.current.get(id)?.focus()
  }

  // Arrow keys move and activate in one step, which is the expected behaviour for tabs that own their panel.
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = tabs.findIndex((item) => item.id === tab)
    const next =
      event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length
      : event.key === 'Home' ? 0
      : event.key === 'End' ? tabs.length - 1
      : -1
    if (next === -1) return
    event.preventDefault()
    go(tabs[next].id)
  }

  const backLink = (
    <Link
      to={backTo}
      onClick={onBack}
      aria-label="Back to Templates"
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-line text-ink-700 transition-colors duration-base ease-standard hover:bg-line-subtle hover:text-ink-900 active:bg-line"
    >
      <ArrowLeft size={18} strokeWidth={1.5} aria-hidden />
    </Link>
  )

  if (!wideEnough) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-canvas px-6 text-center">
        <p className="max-w-sm text-sm text-ink-700">The template editor needs a wider window. Widen it to at least 1024 px to continue.</p>
        <Link to={backTo} onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-800 hover:underline">
          <ArrowLeft size={16} strokeWidth={1.5} aria-hidden /> Back to Templates
        </Link>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-canvas">
      {nav}
      <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex min-h-14 shrink-0 items-center gap-4 border-b border-line bg-surface px-6 py-2">
        {backLink}
        <div className="flex min-w-0 items-center gap-2.5">
          <h1 className="min-w-0 truncate font-sans text-sm font-semibold text-ink-900">{name}</h1>
          <StatusBadge status={status} />
        </div>
        <span className={`cep-num ml-auto shrink-0 text-helper ${saveNoteTone === 'warning' ? 'text-warning-text' : 'text-ink-700'}`}>{saveNote}</span>
        {topBarEnd && <div className="flex shrink-0 items-center gap-2">{topBarEnd}</div>}
      </header>

      {wizard && (
        <div className="shrink-0 border-b border-line bg-surface px-6 py-2">
          <WizardTracker {...wizard} />
        </div>
      )}

      <div className="sticky top-0 z-10 flex shrink-0 items-stretch gap-6 border-b border-line bg-surface px-6">
        <div role="tablist" aria-label="Editor View" className="flex items-stretch gap-6">
          {tabs.map(({ id, label, Icon }) => {
            const active = tab === id
            return (
              <button
                key={id}
                ref={(node) => {
                  tabRefs.current.set(id, node)
                }}
                type="button"
                role="tab"
                id={tabId(id)}
                aria-selected={active}
                aria-controls={panelId(id)}
                tabIndex={active ? 0 : -1}
                onClick={() => go(id)}
                onKeyDown={onTabKeyDown}
                className={`-mb-px inline-flex h-11 items-center gap-2 border-b-2 text-sm font-semibold transition-colors duration-base ease-standard ${
                  active ? 'border-brand-600 text-brand-600' : 'border-transparent text-ink-700 hover:text-ink-900'
                }`}
              >
                <Icon size={16} strokeWidth={1.5} aria-hidden />
                {label}
              </button>
            )
          })}
        </div>
        {tabBarEnd && <div className="ml-auto flex items-center gap-2 py-1.5">{tabBarEnd}</div>}
      </div>
      {notice}

      {/*
        Every pane stays mounted: unmounting the one holding the canvas destroys the GrapesJS editor,
        its undo history and any unsaved work.
      */}
      <main className="flex min-h-0 flex-1 flex-col">
        {/* the class, not just the attribute: `display: flex` from a class outranks the browser's [hidden] rule */}
        {panes.map((pane) => (
          <div
            key={pane.id}
            role="tabpanel"
            id={panelId(pane.id)}
            aria-labelledby={tabId(pane.id)}
            hidden={tab !== pane.id}
            className={`${tab === pane.id ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col${pane.scrolls ? ' overflow-auto' : ''}`}
          >
            {pane.content}
          </div>
        ))}
      </main>

      {footer && <div className="shrink-0 border-t border-line bg-surface">{footer}</div>}
      </div>
    </div>
  )
}
