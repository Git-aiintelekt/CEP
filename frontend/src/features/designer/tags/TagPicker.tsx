/**
 * The list of personalization tags, wherever text is typed: recent ones first, then the catalogue by kind.
 * Knows nothing about where the tag will go — the caller inserts it. No GrapesJS here.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

import { TextInput } from '@/components/Form'
import type { PersonalizationTag } from '@/lib/types'

import { PanelSearch } from '../ui/PanelSearch'
import { asToken, groupTags } from '../tags'
import { EMPTY_CATALOGUE_NOTE, NO_DEFAULT_NOTE, NO_MATCH_NOTE, RECENT_LABEL, SEARCH_LABEL, defaultNote } from './pickerNotes'

type Layout = 'popover' | 'panel'

export interface TagPickerProps {
  tags: PersonalizationTag[]
  channel: string
  /** keys, newest first; only the ones still in the catalogue are shown */
  recent: string[]
  onPick: (key: string) => void
  onClose: () => void
  showSearch?: boolean
  /** popover: capped at 360px with its own scroll; panel: fills whatever holds it, which scrolls */
  layout?: Layout
  /** a popover focuses its search as it opens; a panel that is always mounted must not grab focus */
  focusSearchOnMount?: boolean
  /** read-only: the rows are inert and grey, the search still filters */
  disabled?: boolean
}

const ROW = '[data-dropdown-item]'

export function TagPicker({
  tags, channel, recent, onPick, onClose, showSearch = true, layout = 'popover', focusSearchOnMount = true, disabled = false,
}: TagPickerProps) {
  const [query, setQuery] = useState('')
  const list = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)

  // From an effect, not autoFocus: autoFocus fires while the popover's own ref is still being attached, and
  // the dropdown reads that as focus leaving and closes.
  useEffect(() => {
    if (focusSearchOnMount) root.current?.querySelector<HTMLInputElement>('input')?.focus()
  }, [focusSearchOnMount])

  const groups = useMemo(() => groupTags(tags, channel), [tags, channel])
  const usable = useMemo(() => groups.flatMap((group) => group.tags), [groups])

  const shown = useMemo(() => {
    const term = query.trim().toLowerCase()
    const matches = (tag: PersonalizationTag) =>
      term === '' || [tag.label, tag.tag_key, tag.description ?? ''].some((text) => text.toLowerCase().includes(term))
    const byKey = new Map(usable.map((tag) => [tag.tag_key, tag]))
    const recentTags = recent.map((key) => byKey.get(key)).filter((tag): tag is PersonalizationTag => tag !== undefined && matches(tag))
    const sections = groups.map((group) => ({ ...group, tags: group.tags.filter(matches) })).filter((group) => group.tags.length > 0)
    return { recentTags, sections, count: recentTags.length + sections.reduce((sum, group) => sum + group.tags.length, 0) }
  }, [query, usable, groups, recent])

  const rows = () => Array.from(list.current?.querySelectorAll<HTMLElement>(ROW) ?? [])

  const moveFocus = (delta: number | 'first' | 'last') => {
    const items = rows()
    if (items.length === 0) return false
    const at = items.indexOf(document.activeElement as HTMLElement)
    const next =
      delta === 'first' ? 0
      : delta === 'last' ? items.length - 1
      : at === -1 ? (delta > 0 ? 0 : items.length - 1)
      : (at + delta + items.length) % items.length
    items[next].focus()
    return true
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const handled =
      event.key === 'Escape' ? (onClose(), true)
      : event.key === 'ArrowDown' ? moveFocus(1)
      : event.key === 'ArrowUp' ? moveFocus(-1)
      : event.key === 'Home' ? moveFocus('first')
      : event.key === 'End' ? moveFocus('last')
      : false
    if (handled) event.preventDefault()
  }

  return (
    <div ref={root} onKeyDown={onKeyDown} className={`flex flex-col ${layout === 'panel' ? 'h-full min-h-0' : 'max-h-[360px]'}`}>
      {showSearch && usable.length > 0 ?
        layout === 'panel' ?
          <PanelSearch label={SEARCH_LABEL} value={query} placeholder={SEARCH_LABEL} onChange={setQuery} />
        : <div className="shrink-0 p-2">
            <TextInput
              type="search"
              aria-label={SEARCH_LABEL}
              placeholder={SEARCH_LABEL}
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="mt-0 h-8!"
            />
          </div>

      : null}

      <div ref={list} className="min-h-0 flex-1 overflow-y-auto pb-1">
        {usable.length === 0 ?
          <Note layout={layout}>{EMPTY_CATALOGUE_NOTE}</Note>
        : shown.count === 0 ?
          <Note layout={layout}>{NO_MATCH_NOTE}</Note>
        : <>
            {shown.recentTags.length > 0 ?
              <Section label={RECENT_LABEL} tags={shown.recentTags} onPick={onPick} disabled={disabled} layout={layout} />
            : null}
            {shown.sections.map((group) => (
              <Section key={group.kind} label={group.label} tags={group.tags} onPick={onPick} disabled={disabled} layout={layout} />
            ))}
          </>
        }
      </div>
    </div>
  )
}

interface RowsProps {
  tags: PersonalizationTag[]
  onPick: (key: string) => void
  disabled: boolean
  layout?: Layout
}

/** An empty or no-match line: the panel's is the design's quiet note, the popover keeps its own. */
function Note({ layout, children }: { layout: Layout; children: string }) {
  return layout === 'panel' ?
      <p className="px-3 py-1.5 text-[11px] text-ink-300">{children}</p>
    : <p className="px-3 py-3 text-sm text-ink-700">{children}</p>
}

function Section({ label, tags, onPick, disabled, layout = 'popover' }: RowsProps & { label: string }) {
  return (
    <section aria-label={label}>
      <h3 className={layout === 'panel' ? 'px-3 py-1.5 text-xs text-ink-300' : 'px-3 pt-2 pb-1 text-xs font-semibold text-ink-500'}>{label}</h3>
      {tags.map((tag) => (
        <Row key={tag.tag_key} tag={tag} onPick={onPick} disabled={disabled} layout={layout} />
      ))}
    </section>
  )
}

/** In the panel a row is the name and its token; the sample and the default move into the title. */
function PanelRow({ tag, onPick, disabled }: Omit<RowsProps, 'tags' | 'layout'> & { tag: PersonalizationTag }) {
  const fallback = tag.default_value ? defaultNote(tag.default_value) : NO_DEFAULT_NOTE
  return (
    <button
      type="button"
      data-dropdown-item
      aria-disabled={disabled || undefined}
      title={[tag.label, tag.sample_value ? `e.g. ${tag.sample_value}` : '', fallback].filter(Boolean).join(' — ')}
      onClick={disabled ? undefined : () => onPick(tag.tag_key)}
      className={`flex w-full flex-col items-start gap-px px-3 py-1.5 text-left ${disabled ? 'bg-line-subtle' : 'hover:bg-surface-subtle'}`}
    >
      <span className={`w-full truncate text-xs font-semibold ${disabled ? 'text-ink-300' : 'text-ink-900'}`}>{tag.label}</span>
      <span className={`cep-num w-full truncate text-[11px] ${disabled ? 'text-ink-300' : 'text-brand-800'}`}>{asToken(tag.tag_key)}</span>
    </button>
  )
}

function Row({ tag, onPick, disabled, layout = 'popover' }: Omit<RowsProps, 'tags'> & { tag: PersonalizationTag }) {
  if (layout === 'panel') return <PanelRow tag={tag} onPick={onPick} disabled={disabled} />

  const fallback = tag.default_value ? defaultNote(tag.default_value) : NO_DEFAULT_NOTE
  return (
    <button
      type="button"
      data-dropdown-item
      aria-disabled={disabled || undefined}
      title={[tag.label, tag.description].filter(Boolean).join(' — ')}
      onClick={disabled ? undefined : () => onPick(tag.tag_key)}
      className={`flex h-12 w-full flex-col justify-center px-3 text-left transition-colors duration-base ease-standard ${
        disabled ? 'bg-line-subtle text-ink-300' : 'hover:bg-line-subtle'
      }`}
    >
      <span className="flex w-full items-baseline justify-between gap-3">
        <span className={`truncate text-sm ${disabled ? 'text-ink-300' : 'text-ink-900'}`}>{tag.label}</span>
        {tag.sample_value ? <span className={`max-w-[45%] truncate text-xs ${disabled ? 'text-ink-300' : 'text-ink-500'}`}>{tag.sample_value}</span> : null}
      </span>
      <span className="flex w-full items-baseline gap-2 text-xs">
        <span className={`cep-num shrink-0 ${disabled ? 'text-ink-300' : 'text-brand-800'}`}>{asToken(tag.tag_key)}</span>
        <span className={`truncate ${disabled ? 'text-ink-300' : 'text-ink-500'}`}>{fallback}</span>
      </span>
    </button>
  )
}
