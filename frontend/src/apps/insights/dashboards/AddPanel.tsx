/**
 * The editor's Add panel (docs/mockups/dashboards.html, phase D6), docked at the right so the page stays in view: Report, Text
 * or Button. A report is searched for and picked from the list (by folder), then shown as one of its views or one of its totalled
 * columns as a figure, at a size, under a title. Text is a title and words; a button a label and what it does. Changing a text
 * tile or a button opens the same panel with its fields filled in.
 */
import { useQuery } from '@tanstack/react-query'
import { FileBarChart, MousePointerClick, Search, Type, X, type LucideIcon } from 'lucide-react'
import { useState } from 'react'

import { IconButton } from '@/components/Button'
import { Field, Select, TextArea, TextInput, buttonPrimary } from '@/components/Form'
import { ErrorState, Spinner } from '@/components/States'
import { dashboardsApi, useCatalog, useFolders, useReport, useReports } from '../api'
import { AGGREGATE_LABEL } from '../editor/definition'
import type { DashboardPageT, DashboardTile, ReportSummary, TileShow, ViewType } from '../types'
import { SIZES, startSize } from './canvas'
import { SHOW_LABEL } from './layout'

type Kind = 'report' | 'text' | 'button'
export type NewTile = Omit<DashboardTile, 'id'>

const KINDS: { value: Kind; label: string; icon: LucideIcon }[] = [{ value: 'report', label: 'Report', icon: FileBarChart }, { value: 'text', label: 'Text', icon: Type }, { value: 'button', label: 'Button', icon: MousePointerClick }]
const VIEWS: Exclude<TileShow, 'figure' | 'influencers' | 'decomposition' | 'text' | 'button'>[] = ['grid', 'chart', 'hierarchy', 'pivot', 'summary']
const ACTIONS = [{ value: 'view', label: 'Open a Saved View' }, { value: 'page', label: 'Go to a Page' }, { value: 'report', label: 'Open a Report' }] as const
/** a report saved as an analysing view goes on a dashboard as its rows */
const tileShowOf = (view: ViewType): TileShow => (view === 'influencers' || view === 'decomposition' ? 'grid' : view)

const chip = (on: boolean) => `inline-flex h-8 items-center rounded-full border px-3 text-sm font-medium transition-colors ${on ? 'border-brand-600 bg-brand-100 text-brand-800' : 'border-line bg-surface text-ink-900 hover:bg-surface-hover'}`

function SizePicker({ value, onChange }: { value: number; onChange: (w: number) => void }) {
  return (
    <div role="radiogroup" aria-label="Size" className="flex flex-wrap gap-1.5">
      {SIZES.map((size) => (
        <button key={size.w} type="button" role="radio" aria-checked={value === size.w} onClick={() => onChange(size.w)} className={chip(value === size.w)}>
          {size.label}{size.part && <span className="ml-1 text-xs font-normal text-ink-800">{size.part}</span>}
        </button>
      ))}
    </div>
  )
}

function ReportPicker({ chosen, onChoose }: { chosen: ReportSummary | null; onChoose: (report: ReportSummary) => void }) {
  const [q, setQ] = useState('')
  const reports = useReports({ q: q.trim() || undefined })
  const folders = useFolders()
  const list = reports.data?.reports ?? []
  const groups = [
    ...(folders.data?.folders ?? []).map((folder) => ({ name: folder.name, items: list.filter((r) => r.folder_id === folder.id) })),
    { name: 'No Folder', items: list.filter((r) => !r.folder_id || !folders.data?.folders.some((f) => f.id === r.folder_id)) },
  ].filter((group) => group.items.length > 0)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <label className="relative mx-4 mt-3 mb-1">
        <span className="sr-only">Search reports</span>
        <Search size={14} strokeWidth={1.5} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-800" />
        <input type="search" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search reports"
          className="h-8 w-full rounded-pill border border-transparent bg-surface-sunken pr-3 pl-8 text-sm text-ink-900 placeholder:text-ink-300 focus:bg-surface focus-visible:border-focus focus-visible:outline-none" />
      </label>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {reports.isPending ? <div className="p-4"><Spinner label="Loading the reports" /></div> : reports.isError ? <div className="p-4"><ErrorState error={reports.error} onRetry={() => reports.refetch()} /></div>
          : groups.length === 0 ? <p className="px-4 pt-4 text-sm text-ink-800">No report matches.</p>
          : groups.map((group) => (
            <section key={group.name} aria-label={group.name}>
              <h3 className="px-4 pt-3 pb-1 text-xs font-semibold text-ink-800">{group.name}</h3>
              <ul className="flex flex-col">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <button type="button" aria-pressed={chosen?.id === item.id} onClick={() => onChoose(item)}
                      className={`flex w-full items-center gap-2.5 px-4 py-2 text-left ${chosen?.id === item.id ? 'bg-brand-100' : 'hover:bg-surface-hover'}`}>
                      <FileBarChart size={16} strokeWidth={1.5} aria-hidden className="shrink-0 text-ink-800" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink-900">{item.name}</span>
                        <span className="block truncate text-xs text-ink-800">{SHOW_LABEL[item.view_type]} · {item.dataset_label}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </div>
    </div>
  )
}

export function AddPanel({ dashboardId, pages, pageTitle, tile, onAdd, onClose }: {
  dashboardId: string
  pages: DashboardPageT[]
  /** the page the tile goes on: the button says so */
  pageTitle: string
  /** a text tile or a button being changed */
  tile?: DashboardTile & { w?: number }
  onAdd: (tile: NewTile, width: number) => void
  onClose: () => void
}) {
  const [kind, setKind] = useState<Kind>(tile?.show === 'button' ? 'button' : tile?.show === 'text' ? 'text' : 'report')
  const [chosen, setChosen] = useState<ReportSummary | null>(null)
  const [show, setShow] = useState<TileShow>('grid')
  const [measure, setMeasure] = useState('')
  const [title, setTitle] = useState(tile?.title ?? '')
  const [text, setText] = useState(tile?.text ?? '')
  const [label, setLabel] = useState(tile?.label ?? '')
  const [action, setAction] = useState<'view' | 'page' | 'report'>(tile?.action?.kind ?? 'view')
  const [target, setTarget] = useState(tile?.action?.id ?? '')
  const [width, setWidth] = useState<number | null>(tile?.w ?? null)
  const report = useReport(chosen?.id)
  const catalog = useCatalog()
  const views = useQuery({ queryKey: ['insights', 'views', dashboardId], queryFn: () => dashboardsApi.views(dashboardId), enabled: kind === 'button' })
  const reports = useReports({})
  const dataset = catalog.data?.datasets.find((d) => d.key === chosen?.dataset)
  const measures = (report.data?.definition.columns ?? []).filter((column) => column.aggregate).map((column) => ({
    key: column.field, label: column.label ?? dataset?.fields.find((f) => f.key === column.field)?.label ?? column.field, aggregate: column.aggregate as keyof typeof AGGREGATE_LABEL,
  }))
  const targets = action === 'view' ? (views.data?.views ?? []).map((v) => ({ id: v.id, label: v.name }))
    : action === 'page' ? pages.map((p) => ({ id: p.id, label: p.title }))
    : (reports.data?.reports ?? []).map((r) => ({ id: r.id, label: r.name }))
  const showing: TileShow = kind === 'report' ? show : kind
  const size = width ?? startSize(showing).w
  const ready = kind === 'report' ? Boolean(chosen) && (show !== 'figure' || Boolean(measure))
    : kind === 'text' ? text.trim().length > 0
    : label.trim().length > 0 && targets.some((t) => t.id === target)

  const add = () => {
    if (!ready) return
    if (kind === 'report' && chosen) onAdd({ report_id: chosen.id, show, ...(title.trim() ? { title: title.trim() } : {}), ...(show === 'figure' ? { measure } : {}) }, size)
    else if (kind === 'text') onAdd({ report_id: '', show: 'text', text: text.trim(), ...(title.trim() ? { title: title.trim() } : {}) }, size)
    else onAdd({ report_id: '', show: 'button', label: label.trim(), action: { kind: action, id: target } }, size)
  }
  const heading = tile ? (tile.show === 'button' ? 'Change the Button' : 'Change the Text') : 'Add to the Dashboard'

  return (
    <aside aria-label={heading} className="flex min-h-0 w-86 shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex h-13 shrink-0 items-center gap-2 border-b border-line-subtle px-4">
        <h2 className="flex-1 text-card-title font-semibold text-ink-900">{heading}</h2>
        <IconButton label="Close the Panel" icon={X} size="sm" onClick={onClose} />
      </div>
      {!tile && (
        <div role="radiogroup" aria-label="What to Add" className="flex shrink-0 gap-1.5 border-b border-line-subtle px-4 py-3">
          {KINDS.map((item) => (
            <button key={item.value} type="button" role="radio" aria-checked={kind === item.value} onClick={() => { setKind(item.value); setWidth(null) }}
              className={`flex h-14 flex-1 flex-col items-center justify-center gap-1 rounded-md border text-sm font-medium transition-colors ${kind === item.value ? 'border-brand-600 bg-brand-100 text-brand-800' : 'border-line text-ink-900 hover:bg-surface-hover'}`}>
              <item.icon size={16} strokeWidth={1.5} aria-hidden />{item.label}
            </button>
          ))}
        </div>
      )}

      {kind === 'report' ? (
        <ReportPicker chosen={chosen} onChoose={(item) => { setChosen(item); setShow(tileShowOf(item.view_type)); setMeasure(''); setWidth(null) }} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {kind === 'text' ? (
            <>
              <Field label="Title" hint="Optional">{(ids) => <TextInput id={ids.id} describedBy={ids.describedBy} value={title} maxLength={100} onChange={(event) => setTitle(event.target.value)} />}</Field>
              <Field label="Text" hint="A blank line starts a paragraph; a line starting with - is a bullet; **words** are bold">
                {(ids) => <TextArea id={ids.id} describedBy={ids.describedBy} value={text} rows={7} maxLength={4000} onChange={(event) => setText(event.target.value)} />}
              </Field>
            </>
          ) : (
            <>
              <Field label="Label">{(ids) => <TextInput id={ids.id} value={label} maxLength={60} placeholder="Email Only" onChange={(event) => setLabel(event.target.value)} />}</Field>
              <Field label="When Pressed">{(ids) => <Select id={ids.id} value={action} onChange={(event) => { setAction(event.target.value as typeof action); setTarget('') }}>{ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</Select>}</Field>
              <Field label={action === 'view' ? 'Saved View' : action === 'page' ? 'Page' : 'Report'} hint={action === 'view' && !targets.length ? 'Save a view of this dashboard first (View, on the dashboard).' : undefined}>
                {(ids) => (
                  <Select id={ids.id} describedBy={ids.describedBy} value={target} onChange={(event) => setTarget(event.target.value)}>
                    <option value="">Choose one</option>
                    {targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </Select>
                )}
              </Field>
            </>
          )}
        </div>
      )}

      <div className="flex shrink-0 flex-col gap-3 border-t border-line-subtle px-4 py-3">
        {kind === 'report' && chosen && (
          <>
            <div role="radiogroup" aria-label="Show It As" className="flex flex-col gap-1.5">
              <p className="text-xs font-semibold text-ink-800">Show It As</p>
              <div className="flex flex-wrap gap-1.5">
                {VIEWS.map((view) => (
                  <button key={view} type="button" role="radio" aria-checked={show === view} onClick={() => { setShow(view); setWidth(null) }} className={chip(show === view)}>{SHOW_LABEL[view]}</button>
                ))}
                {report.isPending ? <Spinner size="sm" label="Loading the report" /> : measures.map((item) => (
                  <button key={item.key} type="button" role="radio" aria-checked={show === 'figure' && measure === item.key} title={`${AGGREGATE_LABEL[item.aggregate]} over the period`}
                    onClick={() => { setShow('figure'); setMeasure(item.key); setWidth(null) }} className={chip(show === 'figure' && measure === item.key)}>
                    {item.label}<span className="ml-1 text-xs font-normal text-ink-800">Figure</span>
                  </button>
                ))}
              </div>
            </div>
            <Field label="Title on the Dashboard" hint="Optional">{(ids) => <TextInput id={ids.id} describedBy={ids.describedBy} value={title} placeholder={chosen.name} maxLength={100} onChange={(event) => setTitle(event.target.value)} />}</Field>
          </>
        )}
        {(kind !== 'report' || chosen) && (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-semibold text-ink-800">Size</p>
            <SizePicker value={size} onChange={setWidth} />
          </div>
        )}
        <button type="button" className={`${buttonPrimary} w-full justify-center`} disabled={!ready} onClick={add}>
          {tile ? 'Save Changes' : `Add to ${pageTitle}`}
        </button>
      </div>
    </aside>
  )
}
