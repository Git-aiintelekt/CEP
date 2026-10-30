/**
 * The Settings tab of the editor's right pane (docs/mockups/report-editor-workspace.html): what the report does beyond
 * its rows, one row each, opening the dialog that sets it. Viewer Filters (the questions people answer when they open
 * the report), Detail Report, Tooltip Report (a chart split by a field only) and the Component it is filed under.
 */
import { ChevronRight, Filter, MessageSquareText, TableProperties, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { ComponentSelect } from '../components/ComponentSelect'

function Row({ icon: Icon, title, helper, value, onOpen }: { icon: LucideIcon; title: string; helper: string; value: ReactNode; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex min-h-14 w-full items-center gap-3 border-b border-line-subtle px-4 py-2.5 text-left hover:bg-surface-hover">
      <Icon size={16} strokeWidth={1.5} aria-hidden className="shrink-0 text-ink-800" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink-900">{title}</span>
        <span className="block text-xs text-ink-800">{helper}</span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 text-helper text-ink-800">
        {value}
        <ChevronRight size={14} strokeWidth={1.5} aria-hidden />
      </span>
    </button>
  )
}

const count = (n: number) => (
  <span className="inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-pill bg-brand-100 px-1.5 text-xs font-semibold text-brand-800">{n}</span>
)

export function EditorSettings({ viewerFilters, detailFields, tooltip, component, autoComponent, onViewerFilters, onDetail, onTooltip, onComponent }: {
  viewerFilters: number
  detailFields: number
  /** whether the chart opens a tooltip report; undefined when the view takes none */
  tooltip?: boolean
  component: string | null
  autoComponent: string | null
  onViewerFilters: () => void
  onDetail: () => void
  onTooltip: () => void
  onComponent: (key: string | null) => void
}) {
  return (
    <div role="group" aria-label="Settings" className="flex flex-col">
      <Row icon={Filter} title="Viewer Filters" helper="Questions people answer when they open the report" value={viewerFilters ? count(viewerFilters) : 'None'} onOpen={onViewerFilters} />
      <Row icon={TableProperties} title="Detail Report" helper="Opens when someone clicks a row" value={detailFields ? count(detailFields) : 'None'} onOpen={onDetail} />
      {tooltip !== undefined && <Row icon={MessageSquareText} title="Tooltip Report" helper="Shows when someone points at a chart mark" value={tooltip ? count(1) : 'None'} onOpen={onTooltip} />}
      <div className="flex flex-col gap-1.5 px-4 py-3.5">
        <label htmlFor="editor-component" className="text-sm font-medium text-ink-900">Component</label>
        <span id="editor-component-help" className="text-xs text-ink-800">Where the report is listed in the suite</span>
        <ComponentSelect id="editor-component" describedBy="editor-component-help" value={component} auto={autoComponent} onChange={onComponent} />
      </div>
    </div>
  )
}
