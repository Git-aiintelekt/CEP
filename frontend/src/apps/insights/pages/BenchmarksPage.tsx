/**
 * Benchmarks: what Good, Watch and Act mean for a measure of a dataset, so Explain → What This Means can say whether a figure is
 * on target. A rate can name the count and the base it is made of; then its 95% range is worked out, and the verdict is "Likely …"
 * when the range crosses a band's edge. An added pack brings its own defaults (Add the Email Campaign Defaults). Everyone with
 * Insights reads them; a report or user administrator changes them.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { PageHelp } from '@/apps/cep/help/HelpPanel'
import { iconButtonClass } from '@/components/buttonStyles'
import { Field, Select, TextInput, buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { Notice } from '@/components/Notice'
import { PageHeader } from '@/components/ResourceList'
import { ErrorState, Spinner } from '@/components/States'
import { useToast } from '@/components/Toast'
import { benchmarksApi, keys, useCatalog } from '../api'
import { meaningNumber } from '../components/meaningWords'
import type { Benchmark, BenchmarkBody } from '../types'

function bandsOf(b: Pick<Benchmark, 'higher_is_better' | 'good' | 'act' | 'format'>) {
  const good = meaningNumber(b.good, b.format)
  const act = meaningNumber(b.act, b.format)
  return b.higher_is_better
    ? { good: `${good} or more`, watch: `${act} to ${good}`, act: `under ${act}` }
    : { good: `${good} or less`, watch: `${good} to ${act}`, act: `over ${act}` }
}

function BenchmarkDialog({ benchmark, onClose, onSaved }: { benchmark?: Benchmark; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const catalog = useCatalog()
  const datasets = catalog.data?.datasets ?? []
  const [draft, setDraft] = useState({
    dataset: benchmark?.dataset ?? '', measure: benchmark?.measure ?? '', higher: benchmark?.higher_is_better ?? true,
    good: benchmark ? String(benchmark.good) : '', act: benchmark ? String(benchmark.act) : '', count: benchmark?.count_field ?? '', base: benchmark?.base_field ?? '',
  })
  const set = (patch: Partial<typeof draft>) => setDraft((now) => ({ ...now, ...patch }))
  const dataset = datasets.find((d) => d.key === draft.dataset)
  const measures = (dataset?.fields ?? []).filter((f) => f.role === 'measure')
  const good = Number(draft.good)
  const act = Number(draft.act)
  const numbers = draft.good.trim() !== '' && draft.act.trim() !== '' && Number.isFinite(good) && Number.isFinite(act)
  const sideways = numbers && (draft.higher ? act > good : act < good)
  const halfRange = Boolean(draft.count) !== Boolean(draft.base)
  const body: BenchmarkBody = { higher_is_better: draft.higher, good, act, count_field: draft.count || null, base_field: draft.base || null,
    ...(benchmark ? { row_version: benchmark.row_version } : { dataset: draft.dataset, measure: draft.measure }) }
  const save = useMutation({
    mutationFn: () => (benchmark ? benchmarksApi.update(benchmark.id, body) : benchmarksApi.create(body)),
    onSuccess: (saved) => { toast.success(benchmark ? 'Benchmark saved' : 'Benchmark added', `${saved.measure_label} on ${saved.dataset_label}`); onSaved() },
    onError: (error) => toast.failure(error, 'The benchmark was not saved'),
  })
  const ready = (benchmark || (draft.dataset && draft.measure)) && numbers && !sideways && !halfRange && !save.isPending
  const format = measures.find((m) => m.key === draft.measure)?.format ?? benchmark?.format ?? null

  return (
    <Modal title={benchmark ? `Edit ${benchmark.measure_label}` : 'Add a Benchmark'} subtitle={benchmark ? `On ${benchmark.dataset_label}` : 'What good looks like for one measure'} onClose={onClose}
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button>
          <button type="button" className={buttonPrimary} disabled={!ready} onClick={() => save.mutate()}>{benchmark ? 'Save Benchmark' : 'Add Benchmark'}</button>
        </div>
      )}>
      <div className="flex flex-col gap-3">
        {!benchmark && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Dataset" required>{({ id }) => (
              <Select id={id} value={draft.dataset} onChange={(e) => set({ dataset: e.target.value, measure: '', count: '', base: '' })}>
                <option value="">Choose a dataset</option>
                {datasets.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
              </Select>
            )}</Field>
            <Field label="Measure" required>{({ id }) => (
              <Select id={id} value={draft.measure} onChange={(e) => set({ measure: e.target.value })} disabled={!dataset}>
                <option value="">Choose a measure</option>
                {measures.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </Select>
            )}</Field>
          </div>
        )}
        <Field label="Better When">{({ id }) => (
          <Select id={id} value={draft.higher ? 'higher' : 'lower'} onChange={(e) => set({ higher: e.target.value === 'higher' })}>
            <option value="higher">Higher is better, like a delivery rate</option>
            <option value="lower">Lower is better, like a bounce rate</option>
          </Select>
        )}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Good" required hint={draft.higher ? 'Good at or above this' : 'Good at or below this'}>{({ id, describedBy }) => <TextInput id={id} describedBy={describedBy} inputMode="decimal" value={draft.good} onChange={(e) => set({ good: e.target.value })} placeholder="95" />}</Field>
          <Field label="Act" required hint={draft.higher ? 'Act below this; Watch between' : 'Act above this; Watch between'} error={sideways ? (draft.higher ? 'Act is at or below Good when higher is better.' : 'Act is at or above Good when lower is better.') : undefined}>
            {({ id, describedBy }) => <TextInput id={id} describedBy={describedBy} invalid={sideways} inputMode="decimal" value={draft.act} onChange={(e) => set({ act: e.target.value })} placeholder="90" />}
          </Field>
        </div>
        {numbers && !sideways && (
          <p className="text-helper text-ink-800">Good {bandsOf({ higher_is_better: draft.higher, good, act, format }).good} · Watch {bandsOf({ higher_is_better: draft.higher, good, act, format }).watch} · Act {bandsOf({ higher_is_better: draft.higher, good, act, format }).act}</p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Made Of: Count" hint="For a rate: the count on top, like Delivered">{({ id, describedBy }) => (
            <Select id={id} describedBy={describedBy} value={draft.count} onChange={(e) => set({ count: e.target.value })} disabled={!benchmark && !dataset}>
              <option value="">None</option>
              {(dataset?.fields ?? []).filter((f) => f.role === 'measure').map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              {benchmark && !dataset && benchmark.count_field && <option value={benchmark.count_field}>{benchmark.count_field}</option>}
            </Select>
          )}</Field>
          <Field label="Made Of: Base" hint="And the base, like Sent" error={halfRange ? 'Give both the count and the base, or neither.' : undefined}>{({ id, describedBy }) => (
            <Select id={id} describedBy={describedBy} value={draft.base} onChange={(e) => set({ base: e.target.value })} disabled={!benchmark && !dataset}>
              <option value="">None</option>
              {(dataset?.fields ?? []).filter((f) => f.role === 'measure').map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              {benchmark && !dataset && benchmark.base_field && <option value={benchmark.base_field}>{benchmark.base_field}</option>}
            </Select>
          )}</Field>
        </div>
        <p className="text-helper text-ink-800">With the count and the base, a verdict is given only when the rate&apos;s 95% range clears the band, and not at all under 30 in the base.</p>
      </div>
    </Modal>
  )
}

export function BenchmarksPage() {
  const toast = useToast()
  const client = useQueryClient()
  const list = useQuery({ queryKey: keys.benchmarks, queryFn: ({ signal }) => benchmarksApi.list(signal) })
  const [editing, setEditing] = useState<Benchmark | 'new' | null>(null)
  const settle = () => { client.invalidateQueries({ queryKey: keys.benchmarks }); client.invalidateQueries({ queryKey: ['insights', 'meaning'] }) }
  const remove = useMutation({
    mutationFn: (b: Benchmark) => benchmarksApi.remove(b.id),
    onSuccess: () => { settle(); toast.success('Benchmark removed') },
    onError: (error) => toast.failure(error, 'The benchmark was not removed'),
  })
  const defaults = useMutation({
    mutationFn: (pack: string) => benchmarksApi.defaults(pack),
    onSuccess: (out) => { settle(); toast.success('Defaults added', `${out.added} ${out.added === 1 ? 'benchmark' : 'benchmarks'}`) },
    onError: (error) => toast.failure(error, 'The defaults were not added'),
  })
  const state = list.data
  const editable = Boolean(state?.can_edit && state.ready)

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Benchmarks" description="What good looks like for a measure. Explain → What This Means judges each figure against them." help={<PageHelp chapter="insights" />}
        actions={editable ? <button type="button" className={buttonPrimary} onClick={() => setEditing('new')}><Plus size={16} strokeWidth={1.5} aria-hidden />Add a Benchmark</button> : undefined} />
      {list.isPending ? <Spinner label="Loading the benchmarks" /> : list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : !list.data.ready ? (
        <Notice tone="warning" title="Not Available Yet">Benchmarks need a database update (patch 0080). Ask your administrator.</Notice>
      ) : (
        <>
          {editable && list.data.offers.map((offer) => (
            <div key={offer.pack} className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface-subtle px-3 py-2 text-sm text-ink-900">
              <span className="flex-1">{offer.name} suggests {offer.missing} {offer.missing === 1 ? 'benchmark' : 'benchmarks'} for its email rates: delivery, bounces, clicks and unsubscribes.</span>
              <button type="button" className={buttonSecondary} onClick={() => defaults.mutate(offer.pack)} disabled={defaults.isPending}>Add the Email Campaign Defaults</button>
            </div>
          ))}
          {list.data.benchmarks.length === 0 ? (
            <p className="text-sm text-ink-800">No benchmarks yet. Without one, What This Means states the figures but cannot say whether they are good.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-line bg-surface">
              <table className="w-full text-sm" aria-label="Benchmarks">
                <thead>
                  <tr className="text-left text-xs font-semibold tracking-wide text-ink-800 uppercase">
                    <th className="px-3 py-2">Measure</th><th className="px-3 py-2">Dataset</th><th className="px-3 py-2">Good</th><th className="px-3 py-2">Watch</th><th className="px-3 py-2">Act</th><th className="px-3 py-2">Range From</th>
                    {editable && <th className="w-20 px-1 py-2"><span className="sr-only">Actions</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {list.data.benchmarks.map((b) => {
                    const bands = bandsOf(b)
                    return (
                      <tr key={b.id} className="border-t border-line-subtle align-top">
                        <td className="px-3 py-2 font-medium text-ink-900">{b.measure_label}</td>
                        <td className="px-3 py-2 text-ink-800">{b.dataset_label}</td>
                        <td className="cep-num px-3 py-2 whitespace-nowrap text-ink-900">{bands.good}</td>
                        <td className="cep-num px-3 py-2 whitespace-nowrap text-ink-900">{bands.watch}</td>
                        <td className="cep-num px-3 py-2 whitespace-nowrap text-ink-900">{bands.act}</td>
                        <td className="px-3 py-2 text-ink-800">{b.count_field && b.base_field ? `${b.count_label ?? b.count_field} of ${b.base_label ?? b.base_field}` : '—'}</td>
                        {editable && (
                          <td className="px-1 py-1.5">
                            <div className="flex justify-end gap-1">
                              <button type="button" aria-label={`Edit ${b.measure_label}`} className={iconButtonClass({})} onClick={() => setEditing(b)}><Pencil size={16} strokeWidth={1.5} aria-hidden /></button>
                              <button type="button" aria-label={`Remove ${b.measure_label}`} className={iconButtonClass({})} disabled={remove.isPending}
                                onClick={() => { if (window.confirm(`Remove the benchmark for ${b.measure_label}?`)) remove.mutate(b) }}><Trash2 size={16} strokeWidth={1.5} aria-hidden /></button>
                            </div>
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
      {editing && <BenchmarkDialog benchmark={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={() => { settle(); setEditing(null) }} />}
    </div>
  )
}
