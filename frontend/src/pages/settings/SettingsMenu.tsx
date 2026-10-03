/**
 * The Settings menu panel: Find a Setting, the pages visited most recently, then every group with its pages. A group folds and
 * stays folded; the panel folds to its icons. The current page reads as selected (Blue 100, Blue 800), as the rail does.
 */
import { ChevronDown, ChevronsLeft, ChevronsRight, Clock, Search, X } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import type { Feature } from '@/lib/types'

import { RECENT_SHOWN, findPages, pageAt, readFolded, readPanelFolded, readRecent, rememberVisit, visibleGroups, writeFolded, writePanelFolded, type SettingsPage } from './settingsCatalogue'

const ITEM = 'flex h-9 items-center gap-2.5 rounded-control-md px-2.5 text-sm font-medium transition-colors duration-fast ease-standard'
const ITEM_STATE = { rest: 'text-ink-900 hover:bg-surface-subtle', current: 'bg-brand-100 text-brand-800' }
const GROUP_HEAD = 'flex h-9 w-full items-center gap-2 rounded-control-md px-2.5 text-xs font-semibold tracking-wide text-ink-800 uppercase transition-colors duration-fast ease-standard hover:bg-surface-subtle'

function PageLink({ page, folded, base }: { page: SettingsPage; folded: boolean; base: string }) {
  const Icon = page.icon
  return (
    <NavLink to={page.to.replace('/settings', base)} title={folded ? page.label : undefined} aria-label={folded ? page.label : undefined}
      className={({ isActive }) => `${ITEM} ${isActive ? ITEM_STATE.current : ITEM_STATE.rest} ${folded ? 'justify-center px-0' : ''}`}>
      {({ isActive }) => (
        <>
          <Icon size={16} strokeWidth={1.5} aria-hidden className={`shrink-0 ${isActive ? 'text-brand-800' : 'text-ink-800'}`} />
          {!folded && <span className="min-w-0 truncate">{page.label}</span>}
        </>
      )}
    </NavLink>
  )
}

/** on the page: the signed-in viewer's features */
export function SettingsMenu() {
  const { has } = useAuth()
  return <SettingsMenuPanel has={has} />
}

/** `base`: where the pages live (the dev playground mounts them under its own address) */
export function SettingsMenuPanel({ has, base = '/settings' }: { has: (feature: Feature) => boolean; base?: string }) {
  const { pathname } = useLocation()
  const searchId = useId()
  const [needle, setNeedle] = useState('')
  const [folded, setFolded] = useState<string[]>(readFolded)
  const [panelFolded, setPanelFolded] = useState(readPanelFolded)
  const groups = visibleGroups(has)

  const settingsPath = pathname.replace(base, '/settings')
  const [recent, setRecent] = useState<string[]>(() => readRecent().filter((path) => path !== settingsPath))
  const [seen, setSeen] = useState(settingsPath)
  if (seen !== settingsPath) {                                                     // a new page: the one just left joins Recent
    setSeen(settingsPath)
    setRecent(rememberVisit(seen).filter((path) => path !== settingsPath))
  }
  useEffect(() => {
    rememberVisit(settingsPath)
  }, [settingsPath])

  const toggleGroup = (key: string) => {
    const next = folded.includes(key) ? folded.filter((item) => item !== key) : [...folded, key]
    setFolded(next)
    writeFolded(next)
  }
  const togglePanel = () => {
    setPanelFolded(!panelFolded)
    writePanelFolded(!panelFolded)
  }
  const found = findPages(groups, needle)
  const searching = needle.trim() !== ''
  const recentPages = recent.map(pageAt).filter((page): page is SettingsPage => Boolean(page) && groups.some((group) => group.pages.some((item) => item.to === page!.to))).slice(0, RECENT_SHOWN)

  return (
    <nav aria-label="Settings sections" data-settings-menu={panelFolded ? 'folded' : 'open'}
      className={`flex shrink-0 flex-col self-start rounded-lg border border-line bg-surface ${panelFolded ? 'w-14 p-2' : 'w-60 p-3'}`}>
      <div className={`flex items-center gap-2 ${panelFolded ? 'justify-center' : ''}`}>
        {!panelFolded && (
          <label className="relative block min-w-0 flex-1">
            <span className="sr-only" id={searchId}>Find a setting</span>
            <Search size={16} strokeWidth={1.5} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-800" />
            <input type="search" value={needle} onChange={(event) => setNeedle(event.target.value)} aria-labelledby={searchId} placeholder="Find a setting"
              onKeyDown={(event) => { if (event.key === 'Escape') setNeedle('') }}
              className="h-10 w-full rounded-control-lg border border-transparent bg-surface-sunken pr-8 pl-9 text-sm text-ink-900 transition-colors duration-base ease-standard focus:bg-surface focus-visible:border-brand-600" />
            {searching && (
              <button type="button" aria-label="Clear the search" onClick={() => setNeedle('')} className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-0.5 text-ink-800 hover:text-ink-900">
                <X size={14} strokeWidth={1.5} aria-hidden />
              </button>
            )}
          </label>
        )}
        <button type="button" aria-label={panelFolded ? 'Expand the settings menu' : 'Collapse the settings menu'} aria-expanded={!panelFolded} onClick={togglePanel}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control-md text-ink-800 transition-colors duration-fast ease-standard hover:bg-fill-subtle hover:text-ink-900">
          {panelFolded ? <ChevronsRight size={16} strokeWidth={1.5} aria-hidden /> : <ChevronsLeft size={16} strokeWidth={1.5} aria-hidden />}
        </button>
      </div>

      {searching && !panelFolded ? (
        <ul aria-label="Matching settings" className="mt-3 flex flex-col gap-0.5">
          {found.length === 0 && <li className="px-2.5 py-2 text-helper text-ink-800">Nothing matches. Try a page name such as Users or Sending Engines.</li>}
          {found.map((page) => <li key={page.to}><PageLink page={page} folded={false} base={base} /></li>)}
        </ul>
      ) : (
        <div className={`flex flex-col ${panelFolded ? 'mt-2 gap-1' : 'mt-3 gap-3'}`}>
          {recentPages.length > 0 && !panelFolded && (
            <section aria-labelledby={`${searchId}-recent`} className="flex flex-col gap-0.5">
              <h3 id={`${searchId}-recent`} className="flex h-9 items-center gap-2 px-2.5 text-xs font-semibold tracking-wide text-ink-800 uppercase"><Clock size={14} strokeWidth={1.5} aria-hidden />Recent</h3>
              {recentPages.map((page) => <PageLink key={page.to} page={page} folded={false} base={base} />)}
            </section>
          )}
          {groups.map((group) => {
            const GroupIcon = group.icon
            const open = panelFolded || !folded.includes(group.key)
            const bodyId = `${searchId}-${group.key}`
            return (
              <section key={group.key} aria-label={group.label} className="flex flex-col gap-0.5">
                {panelFolded
                  ? <span aria-hidden className="mx-auto my-1 h-px w-6 bg-line-subtle" />
                  : (
                    <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => toggleGroup(group.key)} className={GROUP_HEAD}>
                      <GroupIcon size={14} strokeWidth={1.5} aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-left">{group.label}</span>
                      <ChevronDown size={14} strokeWidth={1.5} aria-hidden className={`transition-transform duration-fast ${open ? '' : '-rotate-90'}`} />
                    </button>
                  )}
                {open && <div id={bodyId} className="flex flex-col gap-0.5">{group.pages.map((page) => <PageLink key={page.to} page={page} folded={panelFolded} base={base} />)}</div>}
              </section>
            )
          })}
        </div>
      )}
    </nav>
  )
}
