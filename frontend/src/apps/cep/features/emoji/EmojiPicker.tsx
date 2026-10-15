/**
 * The emoji list, wherever text is typed: a search box, then a grid of the catalogue, the widely-rendered blocks first.
 * Knows nothing about where the emoji will go — the caller inserts it. The catalogue is loaded on first open, so the
 * 1,200 entries never weigh on the page until someone asks for them.
 */
import { useEffect, useMemo, useState } from 'react'

import { PanelSearch } from '@/apps/cep/features/designer/ui/PanelSearch'

import type { EmojiEntry } from './catalogue'

export const PICKER_LABEL = 'Insert Emoji'
export const EMOJI_FONT = "'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', 'Twemoji Mozilla', sans-serif"
const PAGE = 1000                                              // the whole safe set fits; a search narrows it

let loaded: Promise<{ catalogue: EmojiEntry[]; safe: readonly string[] }> | null = null
function loadCatalogue() {
  loaded ??= import('./catalogue').then((module) => ({ catalogue: module.CATALOGUE, safe: module.SAFE_GROUPS }))
  return loaded
}

export interface EmojiPickerProps {
  onPick: (emoji: string) => void
  onClose: () => void
}

export function EmojiPicker({ onPick, onClose }: EmojiPickerProps) {
  const [query, setQuery] = useState('')
  const [all, setAll] = useState(false)
  const [data, setData] = useState<{ catalogue: EmojiEntry[]; safe: readonly string[] } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    loadCatalogue().then((found) => { if (live) setData(found) }, () => { if (live) setFailed(true) })
    return () => { live = false }
  }, [])

  const shown = useMemo(() => {
    if (!data) return []
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const pool = all ? data.catalogue : data.catalogue.filter((entry) => data.safe.includes(entry.g))
    if (words.length === 0) return pool.slice(0, PAGE)
    return pool.filter((entry) => words.every((word) => entry.n.includes(word) || entry.k.includes(word) || entry.g.toLowerCase().includes(word))).slice(0, PAGE)
  }, [data, query, all])

  return (
    <div className="flex max-h-[360px] flex-col" data-emoji-picker>
      <PanelSearch label="Search Emoji" value={query} placeholder="Search: fire, heart, party…" onChange={setQuery} />
      <div className="flex items-center justify-between px-2 pb-1 text-[11px] text-ink-800">
        <span>{all ? 'Every emoji' : 'Emoji that show everywhere'}</span>
        <button type="button" className="font-semibold text-brand-800 hover:underline" onClick={() => setAll((was) => !was)}>{all ? 'Show Safe Only' : 'Show All'}</button>
      </div>
      <div className="min-h-0 overflow-y-auto px-2 pb-2" role="listbox" aria-label="Emoji">
        {failed ? <p className="p-2 text-xs text-danger-text">The emoji list could not be loaded.</p>
          : !data ? <p className="p-2 text-xs text-ink-800">Loading emoji</p>
          : shown.length === 0 ? <p className="p-2 text-xs text-ink-800">No emoji matches. Try another word.</p>
          : (
            <div className="grid grid-cols-8 gap-0.5">
              {shown.map((entry) => (
                <button key={entry.c} type="button" role="option" aria-selected={false} title={entry.n} aria-label={entry.n} data-dropdown-item
                  style={{ fontFamily: EMOJI_FONT }}
                  className="flex h-8 w-8 items-center justify-center rounded-sm text-xl leading-none hover:bg-fill-subtle focus-visible:bg-brand-100"
                  onClick={() => { onPick(entry.c); onClose() }}>
                  {entry.c}
                </button>
              ))}
            </div>
          )}
      </div>
    </div>
  )
}
