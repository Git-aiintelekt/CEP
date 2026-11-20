/**
 * Benchmarks (docs/mockups/insights-admin-pages.html): what Good, Watch and Needs Action mean for a measure of a dataset, so
 * Explain → What This Means can say whether a figure is on target. A pack added from Base Reports brings its own suggestions
 * (the banner); search and Dataset narrow the list (kept in the address). Add a Benchmark takes two steps: what to judge, then
 * the bands. A rate can name the count and the base it is made of, to be judged fairly when small. Everyone with Insights
 * reads them; a report or user administrator changes them.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Target, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { PageHelp } from '@/apps/cep/help/HelpPanel'
import { ClearFiltersLink, FilterChip, SingleSelectMenu } from '@/components/FilterChip'
import { buttonPrimary, buttonSecondary } from '@/components/Form'
import { Notice } from '@/components/Notice'
import { PageHeader } from '@/components/ResourceList'
import { SearchField } from '@/components/SearchField'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { useToast } from '@/components/Toast'
import { benchmarksApi, keys } from '../api'
import { BenchmarkFlow } from '../components/BenchmarkFlow'
import { bandsOf } from '../components/benchmarkWords'
import { CountBadge } from '../components/CountBadge'
import { listCardClass, listHeadClass, listRowClass, useListParams } from '../components/listParams'
import { RowMenu } from '../components/RowMenu'
import type { Benchmark } from '../types'

const ICON = { size: 16, strokeWidth: 1.5, 'aria-hidden': true } as const
const BAND = {
  good: { dot: 'bg-success', tag: 'bg-success-bg text-success-text' },
  watch: { dot: 'bg-warning', tag: 'bg-warning-bg text-warning-text' },
  act: { dot: 'bg-danger', tag: 'bg-danger-bg text-danger-text' },
}

function BandTag({ band, children }: { band: keyof typeof BAND; children: string }) {
  return (
    <span className={`cep-num inline-flex h-[22px] items-center gap-1.5 rounded-sm px-2 text-xs font-semibold whitespace-nowrap ${BAND[band].tag}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${BAND[band].dot}`} />{children.charAt(0).toUpperCase() + children.slice(1)}
    </span>
  )
}

export function BenchmarksPage() {
  const toast = useToast()
  const client = useQueryClient()
  const list = useListParams(['q', 'dataset'] as const)
  const benchmarks = useQuery({ queryKey: keys.benchmarks, queryFn: ({ signal }) => benchmarksApi.list(signal) })
  const [editing, setEditing] = useState<Benchmark | 'new' | null>(null)
  const settle = () => { client.invalidateQueries({ queryKey: keys.benchmarks }); client.invalidateQueries({ queryKey: ['insights', 'meaning'] }) }
  const remove = useMutation({
    mutationFn: (b: Benchmark) => benchmarksApi.remove(b.id),
    onSuccess: () => { settle(); toast.success('Benchmark removed') },
    onError: (error) => toast.failure(error, 'The benchmark was not removed'),
  })
  const defaults = useMutation({
    mutationFn: (pack: string) => benchmarksApi.defaults(pack),
    onSuccess: (out) => { settle(); toast.success('Suggested benchmarks added', `${out.added} ${out.added === 1 ? 'benchmark' : 'benchmarks'}`) },
    onError: (error) => toast.failure(error, 'The suggested benchmarks were not added'),
  })
  const state = benchmarks.data
  const editable = Boolean(state?.can_edit && state.ready)
  const all = state?.benchmarks ?? []
  const term = list.get('q').trim().toLowerCase()
  const rows = all.filter((b) => (!term || b.measure_label.toLowerCase().includes(term)) && (!list.get('dataset') || b.dataset === list.get('dataset')))
  const datasets = Array.from(new Map(all.map((b) => [b.dataset, b.dataset_label])).entries()).sort((a, b) => a[1].localeCompare(b[1]))
  const datasetLabel = datasets.find(([key]) => key === list.get('dataset'))?.[1]
  const add = editable ? <button type="button" className={buttonPrimary} onClick={() => setEditing('new')}><Plus {...ICON} />Add a Benchmark</button> : undefined

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Benchmarks" description="What good looks like for a measure. Explain → What This Means judges each figure against them."
        help={<><CountBadge count={state?.ready ? all.length : undefined} /><PageHelp chapter="insights" /></>} actions={add} />
      {benchmarks.isPending ? <Spinner label="Loading the benchmarks" /> : benchmarks.isError ? <ErrorState error={benchmarks.error} onRetry={() => benchmarks.refetch()} /> : !benchmarks.data.ready ? (
        <Notice tone="warning" title="Not Available Yet">Benchmarks need a database update (patch 0080). Ask your administrator.</Notice>
      ) : (
        <>
          {editable && benchmarks.data.offers.map((offer) => (
            <div key={offer.pack} className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface-subtle px-4 py-3 text-sm text-ink-900">
              <Target size={16} strokeWidth={1.5} aria-hidden className="text-brand-600" />
              <span className="flex-1"><b className="font-semibold">{offer.name}</b> suggests {offer.missing} {offer.missing === 1 ? 'benchmark' : 'benchmarks'} for its email rates: delivery, bounces, clicks and unsubscribes.</span>
              <button type="button" className={buttonSecondary} onClick={() => defaults.mutate(offer.pack)} disabled={defaults.isPending}>Add the Suggested Benchmarks</button>
            </div>
          ))}
          {all.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <SearchField label="Search measures" value={list.get('q')} onChange={(next) => list.set({ q: next })} />
              <FilterChip label={datasetLabel ? `Dataset: ${datasetLabel}` : 'Dataset'} active={Boolean(datasetLabel)} menuLabel="Dataset">
                {({ close }) => <SingleSelectMenu label="Dataset" value={list.get('dataset')} options={[{ value: '', label: 'All Datasets' }, ...datasets.map(([value, label]) => ({ value, label }))]} onChange={(value) => { list.set({ dataset: value }); close() }} />}
              </FilterChip>
              {list.filtering && <ClearFiltersLink onClick={list.clear} />}
            </div>
          )}
          {all.length === 0 ? (
            <EmptyState icon={Target} title="No Benchmarks Yet"
              hint={benchmarks.data.offers.length > 0
                ? 'Add the suggested ones above, or your own. Without one, What This Means states the figures but cannot say whether they are good.'
                : 'Without one, What This Means states the figures but cannot say whether they are good. Add Base Reports brings suggested ones for email rates.'}
              action={add} />
          ) : rows.length === 0 ? (
            <EmptyState icon={Target} title="No Benchmarks Match These Filters" hint="Try another dataset, or clear the filters." action={<ClearFiltersLink onClick={list.clear} />} />
          ) : (
            <div className={listCardClass}>
              <table className="w-full text-sm" aria-label="Benchmarks">
                <thead>
                  <tr className={listHeadClass}>
                    <th className="px-3 py-2">Measure</th><th className="px-3 py-2">Dataset</th><th className="px-3 py-2">Good</th><th className="px-3 py-2">Watch</th><th className="px-3 py-2">Needs Action</th><th className="px-3 py-2">Judged Fairly From</th>
                    {editable && <th className="w-12 px-1 py-2"><span className="sr-only">Actions</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((b) => {
                    const bands = bandsOf(b)
                    return (
                      <tr key={b.id} className={listRowClass}>
                        <td className="px-3 py-2 font-medium text-ink-900">{b.measure_label}</td>
                        <td className="px-3 py-2 text-ink-800">{b.dataset_label}</td>
                        <td className="px-3 py-2"><BandTag band="good">{bands.good}</BandTag></td>
                        <td className="px-3 py-2"><BandTag band="watch">{bands.watch}</BandTag></td>
                        <td className="px-3 py-2"><BandTag band="act">{bands.act}</BandTag></td>
                        <td className="px-3 py-2 text-ink-800">{b.count_field && b.base_field ? `${b.count_label ?? b.count_field} of ${b.base_label ?? b.base_field}` : '—'}</td>
                        {editable && (
                          <td className="px-1 py-1.5 text-right">
                            <RowMenu label={`Actions for ${b.measure_label}`} groups={[
                              [{ title: 'Edit', icon: <Pencil {...ICON} />, onSelect: () => setEditing(b) }],
                              [{ title: 'Remove…', icon: <Trash2 {...ICON} className="text-danger-text" />, tone: 'error', disabled: remove.isPending,
                                onSelect: () => { if (window.confirm(`Remove the benchmark for ${b.measure_label}?`)) remove.mutate(b) } }],
                            ]} />
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {editing && <BenchmarkFlow benchmark={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={() => { settle(); setEditing(null) }} />}
    </div>
  )
}
