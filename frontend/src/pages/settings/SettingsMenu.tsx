/**
 * The Settings menu, across the top of the page under its heading. Sub menus by default: Find a Setting, then one button per
 * group (and Recent) that opens its pages in a dropdown; the current page's group reads as selected. Show All opens the panel
 * out into columns, every group with its pages, as the left panel once was; a group folds there and stays folded. The choice is
 * remembered per browser.
 */
import { ChevronDown, ChevronsDownUp, ChevronsUpDown, Clock, Search, X, type LucideIcon } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { Popover } from '@/components/Popover'
import type { Feature } from '@/lib/types'
import { useSingleDropdown } from '@/lib/useSingleDropdown'

import { RECENT_SHOWN, findPages, groupOf, pageAt, readFolded, readPanelFolded, readRecent, rememberVisit, visibleGroups, writeFolded, writePanelFolded, type SettingsPage } from './settingsCatalogue'

const ITEM = 'flex h-9 items-center gap-2.5 rounded-control-md px-2.5 text-sm font-medium transition-colors duration-fast ease-standard'
const ITEM_STATE = { rest: 'text-ink-900 hover:bg-surface-subtle', current: 'bg-brand-100 text-brand-800' }
const GROUP_HEAD = 'flex h-9 w-full items-center gap-2 rounded-control-md px-2.5 text-xs font-semibold tracking-wide text-ink-800 uppercase transition-colors duration-fast ease-standard hover:bg-surface-subtle'
const SUB_BUTTON = 'flex h-9 items-center gap-2 rounded-control-md px-3 text-sm font-medium whitespace-nowrap transition-colors duration-fast ease-standard'
const SUB_STATE = { rest: 'text-ink-900 hover:bg-surface-subtle', current: 'bg-brand-100 text-brand-800', open: 'bg-surface-subtle text-ink-900' }

function PageLink({ page, base, row = false }: { page: SettingsPage; base: string; row?: boolean }) {
  const Icon = page.icon
  return (
    <NavLink to={page.to.replace('/settings', base)} data-dropdown-item={row || undefined}
      className={({ isActive }) => `${ITEM} ${isActive ? ITEM_STATE.current : ITEM_STATE.rest} ${row ? 'mx-1 cep-focus-inset' : ''}`}>
      {({ isActive }) => (
        <>
          <Icon size={16} strokeWidth={1.5} aria-hidden className={`shrink-0 ${isActive ? 'text-brand-800' : 'text-ink-800'}`} />
          <span className="min-w-0 truncate">{page.label}</span>
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
  const [subMenus, setSubMenus] = useState(readPanelFolded)                        // true: the compact row with dropdowns; false: Show All, the columns
  const menus = useSingleDropdown<string>()
  const groups = visibleGroups(has)

  const settingsPath = pathname.replace(base, '/settings')
  const [recent, setRecent] = useState<string[]>(() => readRecent().filter((path) => path !== settingsPath))
  const [seen, setSeen] = useState(settingsPath)
  if (seen !== settingsPath) {                                                     // a new page: the one just left joins Recent; an open sub menu closes
    setSeen(settingsPath)
    setRecent(rememberVisit(seen).filter((path) => path !== settingsPath))
    menus.close({ restoreFocus: false })
  }
  useEffect(() => {
    rememberVisit(settingsPath)
  }, [settingsPath])

  const toggleGroup = (key: string) => {
    const next = folded.includes(key) ? folded.filter((item) => item !== key) : [...folded, key]
    setFolded(next)
    writeFolded(next)
  }
  const toggleView = () => {
    setSubMenus(!subMenus)
    writePanelFolded(!subMenus)
    menus.close({ restoreFocus: false })
  }
  const found = findPages(groups, needle)
  const searching = needle.trim() !== ''
  const recentPages = recent.map(pageAt).filter((page): page is SettingsPage => Boolean(page) && groups.some((group) => group.pages.some((item) => item.to === page!.to))).slice(0, RECENT_SHOWN)
  const currentGroup = groupOf(settingsPath)?.key

  const viewToggle = (
    <button type="button" aria-label={subMenus ? 'Show all settings' : 'Show the sub menus'} aria-pressed={!subMenus} onClick={toggleView} title={subMenus ? 'Show all settings' : 'Show the sub menus'}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control-md text-ink-800 transition-colors duration-fast ease-standard hover:bg-fill-subtle hover:text-ink-900">
      {subMenus ? <ChevronsUpDown size={16} strokeWidth={1.5} aria-hidden /> : <ChevronsDownUp size={16} strokeWidth={1.5} aria-hidden />}
    </button>
  )
  const search = (
    <label className="relative block w-64 max-w-full shrink-0">
      <span className="sr-only" id={searchId}>Find a setting</span>
      <Search size={16} strokeWidth={1.5} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-800" />
      <input type="search" value={needle} onChange={(event) => setNeedle(event.target.value)} aria-labelledby={searchId} placeholder="Find a setting"
        onKeyDown={(event) => { if (event.key === 'Escape') setNeedle('') }}
        className="h-9 w-full rounded-control-md border border-transparent bg-surface-sunken pr-8 pl-9 text-sm text-ink-900 transition-colors duration-base ease-standard focus:bg-surface focus-visible:border-brand-600" />
      {searching && (
        <button type="button" aria-label="Clear the search" onClick={() => setNeedle('')} className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-0.5 text-ink-800 hover:text-ink-900">
          <X size={14} strokeWidth={1.5} aria-hidden />
        </button>
      )}
    </label>
  )
  const matches = searching && (
    <ul aria-label="Matching settings" className="flex w-full flex-wrap gap-0.5 border-t border-line-subtle pt-2">
      {found.length === 0 && <li className="px-2.5 py-2 text-helper text-ink-800">Nothing matches. Try a page name such as Users or Sending Engines.</li>}
      {found.map((page) => <li key={page.to}><PageLink page={page} base={base} /></li>)}
    </ul>
  )

  if (subMenus) {
    const subMenu = (key: string, label: string, Icon: LucideIcon, pages: SettingsPage[], current: boolean) => {
      const open = menus.isOpen(key)
      return (
        <div key={key} className="relative">
          <button type="button" {...menus.triggerProps(key)} data-group={key} className={`${SUB_BUTTON} ${current ? SUB_STATE.current : open ? SUB_STATE.open : SUB_STATE.rest}`}>
            <Icon size={16} strokeWidth={1.5} aria-hidden className={current ? 'text-brand-800' : 'text-ink-800'} />
            {label}
            <ChevronDown size={14} strokeWidth={1.5} aria-hidden className={`transition-transform duration-fast ${open ? 'rotate-180' : ''}`} />
          </button>
          {open && (
            <Popover {...menus.panelProps(key)} label={label} placement="bottom-start" width={240} className="py-1">
              {pages.map((page) => <PageLink key={page.to} page={page} base={base} row />)}
            </Popover>
          )}
        </div>
      )
    }
    return (
      <nav aria-label="Settings sections" data-settings-menu="submenus" className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-2 rounded-lg border border-line bg-surface px-3 py-2">
        <span className="mr-3">{search}</span>
        {groups.map((group) => subMenu(group.key, group.label, group.icon, group.pages, group.key === currentGroup))}
        {recentPages.length > 0 && subMenu('recent', 'Recent', Clock, recentPages, false)}
        <span className="ml-auto">{viewToggle}</span>
        {matches}
      </nav>
    )
  }

  return (
    <nav aria-label="Settings sections" data-settings-menu="open" className="flex min-w-0 flex-col gap-3 rounded-lg border border-line bg-surface p-3">
      <div className="flex items-center gap-2">
        {search}
        <span className="ml-auto">{viewToggle}</span>
      </div>
      {searching ? matches : (
        <div className="grid gap-x-4 gap-y-3 min-[640px]:grid-cols-2 min-[1024px]:grid-cols-[repeat(auto-fit,minmax(176px,1fr))]">
          {recentPages.length > 0 && (
            <section aria-labelledby={`${searchId}-recent`} className="flex min-w-0 flex-col gap-0.5">
              <h3 id={`${searchId}-recent`} className="flex h-9 items-center gap-2 px-2.5 text-xs font-semibold tracking-wide text-ink-800 uppercase"><Clock size={14} strokeWidth={1.5} aria-hidden />Recent</h3>
              {recentPages.map((page) => <PageLink key={page.to} page={page} base={base} />)}
            </section>
          )}
          {groups.map((group) => {
            const GroupIcon = group.icon
            const open = !folded.includes(group.key)
            const bodyId = `${searchId}-${group.key}`
            return (
              <section key={group.key} aria-label={group.label} className="flex min-w-0 flex-col gap-0.5">
                <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => toggleGroup(group.key)} className={GROUP_HEAD}>
                  <GroupIcon size={14} strokeWidth={1.5} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-left">{group.label}</span>
                  <ChevronDown size={14} strokeWidth={1.5} aria-hidden className={`transition-transform duration-fast ${open ? '' : '-rotate-90'}`} />
                </button>
                {open && <div id={bodyId} className="flex flex-col gap-0.5">{group.pages.map((page) => <PageLink key={page.to} page={page} base={base} />)}</div>}
              </section>
            )
          })}
        </div>
      )}
    </nav>
  )
}
