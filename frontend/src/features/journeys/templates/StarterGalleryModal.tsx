/** View More: every CEP starter, by category, with a search. A card opens the starter's preview over this pop-up. */
import { LayoutGrid, Search } from 'lucide-react'
import { useState } from 'react'

import { Modal } from '@/components/Modal'
import { ErrorState, Spinner } from '@/components/States'
import type { JourneyStarter, JourneyTemplateCategory } from '@/lib/types'

import { useStarters } from './templateApi'
import { CATEGORIES, CATEGORY_META, itemCategoryLabel, triggerSentence } from './templateMeta'
import { GalleryStarterCard } from './TemplateCards'
import { StarterTag } from './TemplateParts'

type Filter = JourneyTemplateCategory | 'ALL'

function matches(starter: JourneyStarter, needle: string): boolean {
  if (needle === '') return true
  return `${starter.name} ${starter.description} ${itemCategoryLabel(starter.category)} ${triggerSentence(starter.graph.entry_rules[0])}`.toLowerCase().includes(needle)
}

export function StarterGalleryModal({ onClose, onPreview }: { onClose: () => void; onPreview: (starter: JourneyStarter) => void }) {
  const starters = useStarters()
  const [filter, setFilter] = useState<Filter>('ALL')
  const [search, setSearch] = useState('')
  const needle = search.trim().toLowerCase()
  const all = starters.data ?? []
  const inCategory = filter === 'ALL' ? all : all.filter((starter) => starter.category === filter)
  const shown = inCategory.filter((starter) => matches(starter, needle))
  const categories: { key: Filter; label: string; icon: typeof LayoutGrid; count: number }[] = [
    { key: 'ALL', label: 'All', icon: LayoutGrid, count: all.length },
    ...CATEGORIES.map((key) => ({ key, label: CATEGORY_META[key].label, icon: CATEGORY_META[key].icon, count: all.filter((starter) => starter.category === key).length })),
  ]
  const heading = filter === 'ALL' ? 'All' : CATEGORY_META[filter].label

  return (
    <Modal
      title="Starter Templates"
      subtitle="10 ready-made retail journeys from CEP. Using one creates a copy; the original never changes."
      headerExtra={<StarterTag />}
      onClose={onClose}
      size="screen"
      scrollBody
    >
      {starters.isError ? (
        <ErrorState error={starters.error} onRetry={() => void starters.refetch()} />
      ) : starters.isPending ? (
        <p className="flex items-center gap-2 py-12 text-sm text-ink-800"><Spinner size="sm" /> Loading the starters</p>
      ) : (
        <div className="grid gap-6 md:grid-cols-[200px_minmax(0,1fr)]">
          <nav aria-label="Category">
            <p className="px-3 pb-2 text-xs font-semibold text-ink-800">Category</p>
            <ul className="flex flex-col gap-0.5">
              {categories.map((item) => {
                const selected = filter === item.key
                const Icon = item.icon
                return (
                  <li key={item.key}>
                    <button type="button" aria-pressed={selected} onClick={() => setFilter(item.key)}
                      className={`flex h-9 w-full items-center gap-2 rounded-control-md px-3 text-left text-sm transition-colors duration-fast ease-standard ${selected ? 'bg-brand-100 font-semibold text-brand-800' : 'text-ink-900 hover:bg-surface-hover'}`}>
                      <Icon size={16} strokeWidth={1.5} aria-hidden className="shrink-0" />
                      <span className="flex-1">{item.label}</span>{' '}
                      <span className="cep-num text-xs text-ink-800">{item.count}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </nav>

          <section aria-label="Starters" className="min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-display text-card-heading font-semibold text-ink-900">{heading} · {shown.length}</h3>
              <label className="relative block w-full sm:w-64">
                <span className="sr-only">Search Starter Templates</span>
                <Search size={16} strokeWidth={1.5} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-800" />
                <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search Starter Templates"
                  className="h-9 w-full rounded-lg border border-transparent bg-surface-sunken pr-3 pl-9 text-sm text-ink-900 transition-colors duration-base ease-standard focus:bg-surface focus-visible:border-focus" />
              </label>
            </div>
            {shown.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-base font-semibold text-ink-900">No matching starters</p>
                <p className="mt-1 text-helper text-ink-800">Try another category or clear the search.</p>
              </div>
            ) : (
              <ul className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {shown.map((starter) => (
                  <li key={starter.key} className="min-w-0"><GalleryStarterCard starter={starter} onClick={() => onPreview(starter)} /></li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Modal>
  )
}
