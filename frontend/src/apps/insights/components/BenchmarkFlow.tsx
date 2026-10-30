/**
 * Add a Benchmark and Edit (docs/mockups/insights-admin-pages.html), in the shared create frame: 1 What to Judge (the dataset,
 * the measure, and whether higher or lower is better), 2 The Bands (where Good ends and Needs Action starts, each number with
 * the measure's unit; Watch is what lies between), shown as a coloured bar and a sentence as you type. A rate can name the
 * count and the base it is made of, folded under Judge Small Numbers Fairly. Edit opens on step 2.
 */
import { useMutation } from '@tanstack/react-query'
import { ChevronRight, TrendingDown, TrendingUp } from 'lucide-react'
import { useState } from 'react'

import { Field, Select } from '@/components/Form'
import { SetupDialog } from '@/components/SetupDialog'
import { useToast } from '@/components/Toast'
import { benchmarksApi, useCatalog } from '../api'
import type { Benchmark, BenchmarkBody } from '../types'
import { bandsOf, unitOf } from './benchmarkWords'

const STEPS = ['What to Judge', 'The Bands']

function BandInput({ label, tone, value, onChange, unit, words, error }: { label: string; tone: string; value: string; onChange: (next: string) => void; unit: { before: string; after: string }; words: string; error?: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-x-3 gap-y-1 border-t border-line-subtle px-3 py-2.5 sm:grid-cols-[8.5rem_9rem_1fr] first:border-t-0">
      <span className="flex items-center gap-2 text-sm font-semibold text-ink-900"><span aria-hidden className={`h-2 w-2 rounded-full ${tone}`} />{label}</span>
      <label className="flex h-9 items-center gap-1 rounded-control-md border border-line-control bg-surface px-3 focus-within:border-focus focus-within:shadow-focus">
        {unit.before && <span aria-hidden className="text-sm text-ink-800">{unit.before}</span>}
        <input aria-label={label} inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={error ? true : undefined} className="cep-input-bare min-w-0 flex-1 bg-transparent text-sm text-ink-900 focus:outline-none" />
        {unit.after && <span aria-hidden className="text-sm text-ink-800">{unit.after}</span>}
      </label>
      <span className={`col-span-2 text-helper sm:col-span-1 ${error ? 'text-danger-text' : 'text-ink-800'}`}>{error ?? words}</span>
    </div>
  )
}

export function BenchmarkFlow({ benchmark, onClose, onSaved }: { benchmark?: Benchmark; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const catalog = useCatalog()
  const datasets = catalog.data?.datasets ?? []
  const [step, setStep] = useState(benchmark ? 2 : 1)
  const [folded, setFolded] = useState(!(benchmark?.count_field || benchmark?.base_field))
  const [draft, setDraft] = useState({
    dataset: benchmark?.dataset ?? '', measure: benchmark?.measure ?? '', higher: benchmark?.higher_is_better ?? true,
    good: benchmark ? String(benchmark.good) : '', act: benchmark ? String(benchmark.act) : '', count: benchmark?.count_field ?? '', base: benchmark?.base_field ?? '',
  })
  const set = (patch: Partial<typeof draft>) => setDraft((now) => ({ ...now, ...patch }))
  const dataset = datasets.find((d) => d.key === draft.dataset)
  const measures = (dataset?.fields ?? []).filter((f) => f.role === 'measure')
  const measure = measures.find((m) => m.key === draft.measure)
  const measureLabel = measure?.label ?? benchmark?.measure_label ?? 'The measure'
  const format = measure?.format ?? benchmark?.format ?? null
  const unit = unitOf(format)
  const good = Number(draft.good)
  const act = Number(draft.act)
  const numbers = draft.good.trim() !== '' && draft.act.trim() !== '' && Number.isFinite(good) && Number.isFinite(act)
  const sideways = numbers && (draft.higher ? act > good : act < good)
  const halfRange = Boolean(draft.count) !== Boolean(draft.base)
  const bands = numbers && !sideways ? bandsOf({ higher_is_better: draft.higher, good, act, format }) : null
  const body: BenchmarkBody = { higher_is_better: draft.higher, good, act, count_field: draft.count || null, base_field: draft.base || null,
    ...(benchmark ? { row_version: benchmark.row_version } : { dataset: draft.dataset, measure: draft.measure }) }
  const save = useMutation({
    mutationFn: () => (benchmark ? benchmarksApi.update(benchmark.id, body) : benchmarksApi.create(body)),
    onSuccess: (saved) => { toast.success(benchmark ? 'Benchmark saved' : 'Benchmark added', `${saved.measure_label} on ${saved.dataset_label}`); onSaved() },
    onError: (error) => toast.failure(error, 'The benchmark was not saved'),
  })
  const picked = Boolean(benchmark || (draft.dataset && draft.measure))
  const primary = step === 1
    ? { label: 'Next', disabled: !picked, onClick: () => setStep(2) }
    : { label: benchmark ? 'Save Benchmark' : 'Add Benchmark', disabled: !picked || !numbers || sideways || halfRange, busy: save.isPending, busyLabel: 'Saving', onClick: () => save.mutate() }
  // the bar: Needs Action, Watch, Good laid along the measure, for a percentage over 0 to 100
  const top = format === 'percent' ? 100 : Math.max(good, act) * 1.25 || 1
  const span = (from: number, to: number) => `${Math.max(0, Math.min(100, ((to - from) / top) * 100))}%`
  const low = Math.min(good, act)
  const high = Math.max(good, act)

  return (
    <SetupDialog title={benchmark ? `Edit ${benchmark.measure_label}` : 'Add a Benchmark'} steps={STEPS} step={step} onClose={onClose} onBack={step === 2 ? () => setStep(1) : undefined} primary={primary} locked={save.isPending}>
      {step === 1 ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Dataset" required>{({ id }) => (
              <Select id={id} value={draft.dataset} disabled={Boolean(benchmark)} onChange={(e) => set({ dataset: e.target.value, measure: '', count: '', base: '' })}>
                <option value="">Choose a dataset</option>
                {(benchmark && !dataset ? [{ key: benchmark.dataset, label: benchmark.dataset_label }] : datasets).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
              </Select>
            )}</Field>
            <Field label="Measure" required hint={format === 'percent' ? 'A percentage' : format === 'money' ? 'An amount of money' : measure ? 'A number' : undefined}>{({ id, describedBy }) => (
              <Select id={id} describedBy={describedBy} value={draft.measure} disabled={Boolean(benchmark) || !dataset} onChange={(e) => set({ measure: e.target.value })}>
                <option value="">Choose a measure</option>
                {(benchmark && !dataset ? [{ key: benchmark.measure, label: benchmark.measure_label }] : measures).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </Select>
            )}</Field>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold text-ink-900">Better When</legend>
            <div role="radiogroup" aria-label="Better When" className="grid gap-2 sm:grid-cols-2">
              {([[true, 'Higher', 'Like a delivery rate', TrendingUp], [false, 'Lower', 'Like a bounce rate', TrendingDown]] as const).map(([higher, title, hint, Icon]) => (
                <button key={title} type="button" role="radio" aria-checked={draft.higher === higher} onClick={() => set({ higher })}
                  className={`flex items-start gap-3 rounded-md border p-3 text-left ${draft.higher === higher ? 'border-brand-600 bg-brand-100' : 'border-line bg-surface hover:bg-surface-hover'}`}>
                  <Icon size={16} strokeWidth={1.5} aria-hidden className={`mt-0.5 ${draft.higher === higher ? 'text-brand-600' : 'text-ink-800'}`} />
                  <span><span className="block text-sm font-semibold text-ink-900">{title}</span><span className="block text-xs text-ink-800">{hint}</span></span>
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 rounded-md border border-line px-3 py-2.5">
            {draft.higher ? <TrendingUp size={16} strokeWidth={1.5} aria-hidden className="text-brand-600" /> : <TrendingDown size={16} strokeWidth={1.5} aria-hidden className="text-brand-600" />}
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink-900">{measureLabel}</span><span className="block text-xs text-ink-800">{dataset?.label ?? benchmark?.dataset_label} · {draft.higher ? 'higher is better' : 'lower is better'}</span></span>
            <button type="button" className="text-sm font-semibold text-brand-800 hover:underline" onClick={() => setStep(1)}>Change</button>
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-semibold text-ink-900">Where Each Band Starts</p>
            <div role="group" aria-label="The Bands" className="overflow-hidden rounded-md border border-line">
              <BandInput label="Good" tone="bg-success" value={draft.good} onChange={(next) => set({ good: next })} unit={unit} words={draft.higher ? 'and above' : 'and below'} />
              <div className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-x-3 gap-y-1 border-t border-line-subtle px-3 py-2.5 sm:grid-cols-[8.5rem_9rem_1fr]">
                <span className="flex items-center gap-2 text-sm font-semibold text-ink-900"><span aria-hidden className="h-2 w-2 rounded-full bg-warning" />Watch</span>
                <span className="cep-num pl-3 text-sm text-ink-800">{bands ? bands.watch : '—'}</span>
                <span className="col-span-2 text-helper text-ink-800 sm:col-span-1">In between, set for you</span>
              </div>
              <BandInput label="Needs Action" tone="bg-danger" value={draft.act} onChange={(next) => set({ act: next })} unit={unit} words={draft.higher ? 'and below' : 'and above'}
                error={sideways ? (draft.higher ? 'Needs Action is at or below Good when higher is better.' : 'Needs Action is at or above Good when lower is better.') : undefined} />
            </div>
          </div>
          {bands && (
            <>
              <div aria-hidden className="flex h-2.5 overflow-hidden rounded-pill bg-fill-subtle">
                <span className={draft.higher ? 'bg-danger' : 'bg-success'} style={{ width: span(0, low) }} />
                <span className="bg-warning" style={{ width: span(low, high) }} />
                <span className={draft.higher ? 'bg-success' : 'bg-danger'} style={{ flex: 1 }} />
              </div>
              <p role="status" className="rounded-md border border-line-subtle bg-surface-subtle px-3 py-2.5 text-sm text-ink-900">
                A {measureLabel} of <b>{bands.good} is Good</b>, <b>{bands.watch} is Watch</b> and <b>{bands.act} Needs Action</b>.
              </p>
            </>
          )}
          <button type="button" aria-expanded={!folded} onClick={() => setFolded(!folded)} className="flex flex-wrap items-center gap-x-2 self-start text-left text-sm font-semibold text-ink-900">
            <ChevronRight size={16} strokeWidth={1.5} aria-hidden className={`transition-transform ${folded ? '' : 'rotate-90'}`} />Judge Small Numbers Fairly<span className="font-normal text-ink-800">Optional, for a rate</span>
          </button>
          {!folded && (
            <div className="flex flex-col gap-3 rounded-md border border-line-subtle p-3">
              <p className="text-helper text-ink-800">Name what the rate is made of. Then a verdict is given only when the rate is clearly in a band, and not at all when fewer than 30 are counted.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Counted" hint="On top, like Delivered">{({ id, describedBy }) => (
                  <Select id={id} describedBy={describedBy} value={draft.count} onChange={(e) => set({ count: e.target.value })} disabled={!dataset && !benchmark}>
                    <option value="">None</option>
                    {measures.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                    {benchmark && !dataset && benchmark.count_field && <option value={benchmark.count_field}>{benchmark.count_label ?? benchmark.count_field}</option>}
                  </Select>
                )}</Field>
                <Field label="Out Of" hint="The base, like Sent" error={halfRange ? 'Give both, or neither.' : undefined}>{({ id, describedBy }) => (
                  <Select id={id} describedBy={describedBy} value={draft.base} onChange={(e) => set({ base: e.target.value })} disabled={!dataset && !benchmark}>
                    <option value="">None</option>
                    {measures.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                    {benchmark && !dataset && benchmark.base_field && <option value={benchmark.base_field}>{benchmark.base_label ?? benchmark.base_field}</option>}
                  </Select>
                )}</Field>
              </div>
            </div>
          )}
        </div>
      )}
    </SetupDialog>
  )
}
