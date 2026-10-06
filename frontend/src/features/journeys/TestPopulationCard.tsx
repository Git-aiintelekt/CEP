/** "Who should this test run send to?" — a random sample of the live audience, or saved test lists
 * (contact lists with list_environment TEST — GET /contact-lists/?list_environment=TEST). */
import { useState } from 'react'

import { Checkbox } from '@/components/Checkbox'
import { TextInput } from '@/components/Form'
import { Spinner } from '@/components/States'
import { formatNumber, formatRelative } from '@/lib/format'
import type { JourneyTestPopulation } from '@/lib/types'

import { RadioCard } from './RadioCard'
import { useTestLists } from './testPublish'

interface TestPopulationCardProps {
  value: JourneyTestPopulation
  onChange: (value: JourneyTestPopulation) => void
}

export function TestPopulationCard({ value, onChange }: TestPopulationCardProps) {
  const [search, setSearch] = useState('')
  const lists = useTestLists()
  const rows = (lists.data?.results ?? []).filter((list) => list.name.toLowerCase().includes(search.toLowerCase()))
  const chosen = new Set(value.contact_list_ids ?? [])

  const toggle = (id: string) => {
    const next = new Set(chosen)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange({ ...value, contact_list_ids: [...next] })
  }

  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <h2 className="font-display text-card-heading font-semibold text-ink-900">Test Population</h2>
      <p className="mt-1 text-helper text-ink-800">Who should this test run send to?</p>

      <div role="radiogroup" aria-label="Test Population" className="mt-4 space-y-3">
        <RadioCard
          name="test-population-mode"
          checked={value.mode === 'RANDOM'}
          onSelect={() => onChange({ ...value, mode: 'RANDOM' })}
          title="Random Sample of Live Audience"
          description="A random slice of customers who currently qualify for entry."
          aside={value.mode === 'RANDOM' && (
            <span className="flex shrink-0 items-center gap-2">
              <span className="w-20 shrink-0">
                <TextInput
                  type="number"
                  min={1}
                  max={200}
                  controlSize="sm"
                  className="text-right tabular-nums"
                  value={value.sample_size ?? 50}
                  onChange={(event) => onChange({ ...value, sample_size: Math.min(200, Math.max(1, Math.round(Number(event.target.value)) || 1)) })}
                  aria-label="Sample Size"
                />
              </span>
              <span className="text-sm text-ink-800">customers</span>
            </span>
          )}
        />

        <RadioCard
          name="test-population-mode"
          checked={value.mode === 'LIST'}
          onSelect={() => onChange({ ...value, mode: 'LIST' })}
          title="Specific Test List"
          description="Send only to a curated internal list of testers."
        >
          <div className="mt-3 space-y-2">
            <TextInput controlSize="sm" placeholder="Search Test Lists" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search Test Lists" />
            {lists.isLoading ? (
              <p className="flex items-center gap-2 text-helper text-ink-800"><Spinner size="sm" /> Loading test lists</p>
            ) : rows.length === 0 ? (
              <p className="text-helper text-ink-800">No saved test lists yet. Create one with Test environment in Contact Lists.</p>
            ) : (
              <ul className="max-h-48 overflow-y-auto rounded-md border border-line bg-surface">
                {rows.map((list) => (
                  <li key={list.id} className="flex items-center justify-between gap-2 border-b border-line-subtle px-3 py-2 last:border-b-0 hover:bg-surface-subtle">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink-900">{list.name}</p>
                      <p className="text-helper text-ink-800">{formatNumber(list.member_count)} contacts · Updated {formatRelative(list.last_refreshed_at ?? list.updated_at)}</p>
                    </div>
                    <Checkbox label="" aria-label={`Include ${list.name}`} checked={chosen.has(list.id)} onChange={() => toggle(list.id)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </RadioCard>
      </div>
    </section>
  )
}
