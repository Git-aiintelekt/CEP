/**
 * The editor's left rail: an icon strip that opens one panel at a time beside the canvas.
 * Presentational only — it knows nothing about GrapesJS, and the panels are given to it.
 */
import type { LucideIcon } from 'lucide-react'
import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

export interface RailTab {
  id: string
  label: string
  icon: LucideIcon
  panel: ReactNode
}

export interface LeftRailHandle {
  /** opens a tab from outside, expanding the panel if it was collapsed */
  openTab: (id: string) => void
  /** whether the panel is showing right now, for whoever needs to give the canvas the room */
  isOpen: () => boolean
}

interface LeftRailProps {
  tabs: RailTab[]
  /** where the open tab and the collapsed state are remembered, per viewer */
  storageKey?: string
  /**
   * True while the viewport is too narrow to hold the panel and the canvas at once. The rail folds itself, and
   * unfolds again when the viewport is wide enough — but it never writes either over what the viewer chose, and
   * opening it by hand at any width wins until the viewport crosses the breakpoint again.
   */
  autoCollapse?: boolean
  /**
   * Folded by something else — fullscreen — on top of whatever the viewer and the viewport decided. Lifting it
   * puts the rail back exactly as it was, since nothing underneath was touched. A tab pressed meanwhile is
   * reported rather than acted on, so the caller can leave that mode first.
   */
  forceCollapsed?: boolean
  onPressWhileForced?: (id: string) => void
  /** the canvas beside the rail sizes itself from what is left, so it is told once the new width is on screen */
  onLayoutChange?: () => void
  'aria-label'?: string
}

interface RailState {
  activeId: string
  collapsed: boolean
}

function readState(tabs: RailTab[], storageKey: string | undefined): RailState {
  const fallback: RailState = { activeId: tabs[0]?.id ?? '', collapsed: false }
  if (!storageKey) return fallback
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (raw === null) return fallback
    const stored = JSON.parse(raw) as Partial<RailState>
    // a tab may have been renamed or removed since the state was written
    if (typeof stored.activeId !== 'string' || !tabs.some((tab) => tab.id === stored.activeId)) return fallback
    return { activeId: stored.activeId, collapsed: stored.collapsed === true }
  } catch {
    return fallback
  }
}

export const LeftRail = forwardRef<LeftRailHandle, LeftRailProps>(function LeftRail(
  { tabs, storageKey, autoCollapse = false, forceCollapsed = false, onPressWhileForced, onLayoutChange, 'aria-label': ariaLabel = 'Editor Panels' },
  ref,
) {
  const baseId = useId()
  const [stored, setState] = useState<RailState>(() => readState(tabs, storageKey))
  const [autoFolded, setAutoFolded] = useState(autoCollapse)
  const { activeId } = stored
  const collapsed = forceCollapsed || autoFolded || stored.collapsed

  // Only a crossing folds or unfolds: within a band the viewer's last word stands, re-renders included.
  const wasNarrow = useRef(autoCollapse)
  useEffect(() => {
    if (wasNarrow.current === autoCollapse) return
    wasNarrow.current = autoCollapse
    setAutoFolded(autoCollapse)
  }, [autoCollapse])
  const buttons = useRef(new Map<string, HTMLButtonElement | null>())
  const layoutChanged = useRef(onLayoutChange)
  const settled = useRef(false)

  useEffect(() => {
    layoutChanged.current = onLayoutChange
  })

  // what the viewer chose, never the automatic fold: coming back to a wide window restores their own state
  useEffect(() => {
    if (!storageKey) return
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(stored))
    } catch {
      // storage is a convenience here: a blocked or full store must not break the rail
    }
  }, [stored, storageKey])

  useEffect(() => {
    // the first render already has its final width; only a change asks the canvas to reposition
    if (!settled.current) {
      settled.current = true
      return
    }
    layoutChanged.current?.()
  }, [collapsed])

  useImperativeHandle(ref, () => ({
    openTab: (id: string) => {
      if (!tabs.some((tab) => tab.id === id)) return
      setAutoFolded(false)
      setState({ activeId: id, collapsed: false })
    },
    isOpen: () => !collapsed,
  }))

  const tabId = (id: string) => `${baseId}-tab-${id}`
  const panelId = (id: string) => `${baseId}-panel-${id}`

  const open = (id: string) => {
    setAutoFolded(false)
    setState({ activeId: id, collapsed: false })
    buttons.current.get(id)?.focus()
  }

  const press = (id: string) => {
    if (forceCollapsed) {
      onPressWhileForced?.(id)
      return
    }
    if (collapsed || id !== activeId) open(id)
    else setState({ activeId: id, collapsed: true })
  }

  // Arrow keys move and activate in one step, matching the Content / Preview tabs in EditorFrame.
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = tabs.findIndex((tab) => tab.id === activeId)
    const next =
      event.key === 'ArrowDown' ? (index + 1) % tabs.length
      : event.key === 'ArrowUp' ? (index - 1 + tabs.length) % tabs.length
      : event.key === 'Home' ? 0
      : event.key === 'End' ? tabs.length - 1
      : -1
    if (next === -1 || index === -1) return
    event.preventDefault()
    open(tabs[next].id)
  }

  return (
    <div className="flex h-full min-h-0">
      <div
        role="tablist"
        aria-orientation="vertical"
        aria-label={ariaLabel}
        className="flex w-16 shrink-0 flex-col gap-[2px] border-r border-line-subtle bg-surface py-2"
      >
        {tabs.map((tab) => {
          const selected = !collapsed && tab.id === activeId
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              ref={(node) => {
                buttons.current.set(tab.id, node)
              }}
              type="button"
              role="tab"
              id={tabId(tab.id)}
              aria-selected={selected}
              aria-controls={panelId(tab.id)}
              // collapsed, nothing is selected, but Tab still has to reach the strip at the tab that will reopen
              tabIndex={tab.id === activeId ? 0 : -1}
              onClick={() => press(tab.id)}
              onKeyDown={onTabKeyDown}
              className={`flex shrink-0 flex-col items-center gap-1 border-l-2 px-[2px] py-2 text-[11px] leading-[1.2] ${
                selected ? 'border-brand-600 bg-brand-100 font-semibold text-brand-600' : 'border-transparent font-medium text-ink-700 hover:bg-surface-subtle'
              }`}
            >
              <Icon size={20} strokeWidth={1.5} aria-hidden />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/*
        Every panel stays mounted: a tab switch must not lose the search text or the scroll position.
        The class as well as the attribute, since `display: flex` from a class outranks the browser's [hidden] rule.
      */}
      <div
        hidden={collapsed}
        className={`${collapsed ? 'hidden' : 'flex'} w-48 shrink-0 flex-col border-r border-line bg-surface`}
      >
        {tabs.map((tab) => (
          <div
            key={tab.id}
            role="tabpanel"
            id={panelId(tab.id)}
            aria-labelledby={tabId(tab.id)}
            hidden={tab.id !== activeId}
            className={`${tab.id === activeId ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col`}
          >
            {tab.panel}
          </div>
        ))}
      </div>
    </div>
  )
})
