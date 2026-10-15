/**
 * The app launcher behind the dots at the far left of the top bar: every component the workspace has, as tiles, with a
 * search box; the ones still to come are named below, so people know what exists.
 */
import { Grip, Search } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Popover } from '@/components/Popover'
import type { Me } from '@/lib/types'
import { useSingleDropdown } from '@/lib/useSingleDropdown'
import { comingSentence, type EntitledComponent } from './manifests'

export function AppLauncher({ me, components, current }: { me: Me | null; components: EntitledComponent[]; current: EntitledComponent | null }) {
  const coming = comingSentence(me)
  const dropdown = useSingleDropdown<'apps'>()
  const [query, setQuery] = useState('')
  const term = query.trim().toLowerCase()
  const shown = term ? components.filter((item) => item.name.toLowerCase().includes(term) || item.tagline.toLowerCase().includes(term)) : components
  const open = dropdown.isOpen('apps')
  return (
    <div className="relative">
      <button
        type="button"
        {...dropdown.triggerProps('apps')}
        aria-label="Apps"
        title="Apps"
        className={`flex h-10 w-10 items-center justify-center rounded-control-md transition-colors outline-none focus-visible:outline-2 focus-visible:outline-focus ${open ? 'bg-brand-100 text-brand-800' : 'text-ink-800 hover:bg-surface-hover hover:text-ink-900'}`}
      >
        <Grip size={22} strokeWidth={1.5} aria-hidden />
      </button>
      {open && (
        <Popover {...dropdown.panelProps('apps')} label="Apps" placement="bottom-start" width={420} className="p-3.5">
          <label className="relative mb-3 block">
            <span className="sr-only">Find apps</span>
            <Search size={16} strokeWidth={1.5} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-700" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find C360 apps"
              className="h-9 w-full rounded-control-md border border-line-control bg-surface pr-3 pl-8 text-sm text-ink-900 placeholder:text-ink-700 focus-visible:border-focus focus-visible:outline-none"
            />
          </label>
          {shown.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-ink-800">No app matches.</p>
          ) : (
            <ul aria-label="Your apps" className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {shown.map((item) => {
                const isCurrent = item.key === current?.key
                return (
                  <li key={item.key}>
                    <Link
                      to={item.home}
                      data-dropdown-item
                      aria-current={isCurrent ? 'true' : undefined}
                      onClick={() => dropdown.close({ restoreFocus: false })}
                      className={`flex flex-col items-center gap-1.5 rounded-md px-1 py-2.5 text-center text-xs leading-tight text-ink-900 transition-colors outline-none hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus ${isCurrent ? 'bg-surface-subtle ring-1 ring-line-subtle' : ''}`}
                    >
                      <span aria-hidden className={`flex h-10 w-10 items-center justify-center rounded-md ${item.tile}`}><item.icon size={20} strokeWidth={1.5} /></span>
                      <span className="font-medium">{item.name}</span>
                      {item.access === 'TRIAL' && item.until && <span className="text-[11px] text-ink-700">Trial to {new Date(item.until).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>}
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
          {coming && <p className="mt-2.5 border-t border-line-subtle pt-2.5 text-xs text-ink-800">{coming}</p>}
        </Popover>
      )}
    </div>
  )
}
