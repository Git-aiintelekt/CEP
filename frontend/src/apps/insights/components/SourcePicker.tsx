/**
 * The tables and views of a Report Database, found by search (docs/mockups/report-database-catalogue.html, option A). The names
 * are read live by the server and held in memory there for ten minutes; nothing about the database is stored but the pins. It
 * opens on the pinned tables and the folded groups; typing searches every name and draws the first PAGE matches, the groups that
 * hold them open. Choosing a name is the page's business (onPick); its columns are read then.
 */
import { ChevronDown, ChevronRight, RotateCw, Search, Star } from 'lucide-react'
import { useMemo, useState } from 'react'

import { formatDateTime, formatNumber } from '@/lib/format'
import { groupSources, matches, PAGE, type SourceGroup } from '../sourceGroups'
import type { SourceInfo } from '../types'

export function SourcePicker({ sources, pinned, database, readAt, chosen, joined, disabled, reloading, onPick, onTogglePin, onReload }: {
  sources: SourceInfo[]
  pinned: string[]
  database: string
  readAt: string | null
  chosen: string | null
  /** names already joined into the dataset */
  joined: Set<string>
  disabled: boolean
  reloading: boolean
  onPick: (name: string) => void
  /** null: pins cannot be kept on this installation yet */
  onTogglePin: ((name: string) => void) | null
  onReload: () => void
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [only, setOnly] = useState<string | null>(null)
  const [shown, setShown] = useState(PAGE)
  const searching = q.trim().length > 0
  const found = useMemo(() => sources.filter((s) => matches(s, q)), [sources, q])
  const groups = useMemo(() => groupSources(found, pinned, sources.length), [found, pinned, sources.length])
  const visible = only ? groups.filter((g) => g.key === only) : groups
  const isOpen = (key: string, label: string | null) => label === null || key === 'pinned' || searching || Boolean(only) || Boolean(open[key])
  const drawn = visible.reduce<{ left: number; groups: (SourceGroup & { drawn: SourceInfo[] })[] }>((acc, g) => {     // names drawn across the groups, PAGE at a time
    const take = isOpen(g.key, g.label) ? g.items.slice(0, Math.max(0, acc.left)) : []
    return { left: acc.left - take.length, groups: [...acc.groups, { ...g, drawn: take }] }
  }, { left: shown, groups: [] }).groups
  const openTotal = visible.filter((g) => isOpen(g.key, g.label)).reduce((n, g) => n + g.items.length, 0)
  const hidden = Math.max(0, openTotal - shown)
  const mark = (name: string) => {
    const at = searching ? name.toLowerCase().indexOf(q.trim().toLowerCase()) : -1
    if (at < 0) return name
    const end = at + q.trim().length
    return <>{name.slice(0, at)}<mark className="rounded-xs bg-warning-bg text-ink-900">{name.slice(at, end)}</mark>{name.slice(end)}</>
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-800" role="status">
        <span><span className="font-semibold text-ink-900">{formatNumber(sources.length)}</span> tables and views · names read live from {database}{readAt ? ` at ${formatDateTime(readAt)}` : ''}, nothing stored</span>
        <button type="button" onClick={onReload} disabled={reloading} className="inline-flex items-center gap-1 font-medium text-link hover:underline disabled:text-ink-300">
          <RotateCw size={12} strokeWidth={1.5} aria-hidden className={reloading ? 'animate-spin' : ''} />Reload the List
        </button>
      </p>
      <label className="relative">
        <span className="sr-only">Search tables and views</span>
        <Search size={16} strokeWidth={1.5} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-700" />
        <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setOnly(null); setShown(PAGE) }} placeholder={`Search ${formatNumber(sources.length)} tables and views`}
          className="h-8 w-full rounded-control-md border border-transparent bg-surface-sunken pr-3 pl-8 text-sm text-ink-900 placeholder:text-ink-700 focus:bg-surface focus-visible:border-focus focus-visible:outline-none" />
      </label>
      {searching && groups.length > 1 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Narrow the matches">
          <button type="button" aria-pressed={!only} onClick={() => { setOnly(null); setShown(PAGE) }} className={chip(!only)}>All <span className="text-ink-700">{formatNumber(found.length)}</span></button>
          {groups.filter((g) => g.label).slice(0, 5).map((g) => (
            <button key={g.key} type="button" aria-pressed={only === g.key} onClick={() => { setOnly(g.key); setShown(PAGE) }} className={chip(only === g.key)}>{g.label} <span className="text-ink-700">{g.items.length}</span></button>
          ))}
        </div>
      )}
      <div className="max-h-[520px] overflow-auto rounded-md border border-line bg-surface text-sm">
        {drawn.map((g) => (
          <div key={g.key}>
            {g.label && (
              <button type="button" aria-expanded={isOpen(g.key, g.label)} onClick={() => setOpen((now) => ({ ...now, [g.key]: !isOpen(g.key, g.label) }))} disabled={searching || g.key === 'pinned'}
                className="flex w-full items-center gap-1.5 border-b border-line-subtle bg-surface-subtle px-3 py-1.5 text-left text-[11px] font-semibold tracking-wide text-ink-800 uppercase disabled:cursor-default">
                {isOpen(g.key, g.label) ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
                <span className={g.key.startsWith('prefix:') ? 'normal-case' : ''}>{g.label}</span>
                <span className="ml-auto font-medium normal-case">{formatNumber(g.items.length)}</span>
              </button>
            )}
            {g.drawn.map((s) => {
              const pin = pinned.includes(s.name)
              return (
                <div key={`${g.key}:${s.name}`} className={`flex items-center border-b border-line-subtle ${chosen === s.name ? 'bg-brand-100' : joined.has(s.name) ? 'bg-surface-subtle' : 'hover:bg-surface-hover'}`}>
                  <button type="button" disabled={!s.mappable || disabled} onClick={() => onPick(s.name)} aria-pressed={chosen === s.name}
                    className={`flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left disabled:cursor-not-allowed disabled:text-ink-300 ${chosen === s.name ? 'text-brand-800' : 'text-ink-900'}`}>
                    <span className="w-9 shrink-0 text-[10px] font-semibold text-ink-700 uppercase">{s.kind === 'view' ? 'View' : 'Table'}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{mark(s.name)}</span>
                    {(chosen === s.name || joined.has(s.name) || s.mapped_as) && <span className="text-[11px] whitespace-nowrap text-ink-800">{chosen === s.name ? 'base' : joined.has(s.name) ? 'joined' : 'mapped'}</span>}
                  </button>
                  {onTogglePin && (
                    <button type="button" aria-label={`${pin ? 'Unpin' : 'Pin'} ${s.name}`} aria-pressed={pin} onClick={() => onTogglePin(s.name)} className="px-2.5 py-1.5 text-ink-300 hover:text-link">
                      <Star size={13} strokeWidth={1.5} aria-hidden className={pin ? 'fill-current text-link' : ''} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        ))}
        {found.length === 0 && <p className="px-3 py-4 text-xs text-ink-800">Nothing matches.</p>}
        {(searching || hidden > 0) && found.length > 0 && (
          <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-ink-800">
            <span>{searching ? `${formatNumber(found.length)} of ${formatNumber(sources.length)} match` : `${formatNumber(Math.min(shown, found.length))} shown`}</span>
            {hidden > 0 ? <button type="button" onClick={() => setShown((n) => n + PAGE)} className="font-medium text-link hover:underline">Show {Math.min(PAGE, hidden)} More</button> : <span>Names only: nothing was read from the tables</span>}
          </div>
        )}
      </div>
    </div>
  )
}

function chip(on: boolean): string {
  return `inline-flex h-6 items-center gap-1 rounded-control-sm border px-2.5 text-xs ${on ? 'border-link bg-callout-bg font-medium text-brand-800' : 'border-line bg-surface text-ink-900 hover:bg-surface-hover'}`
}
