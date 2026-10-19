/**
 * Add or change a text tile (a title and words: blank lines between paragraphs, "- " for a bullet, **bold**) or a button (a
 * label, and what it does: open one of the dashboard's saved views, go to one of its pages, or open a report).
 */
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { Field, Select, TextArea, TextInput, buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { dashboardsApi, useReports } from '../api'
import type { DashboardPageT, DashboardTile } from '../types'

type Kind = 'text' | 'button'
const ACTIONS = [{ value: 'view', label: 'Open a Saved View' }, { value: 'page', label: 'Go to a Page' }, { value: 'report', label: 'Open a Report' }] as const

export function WordTileDialog({ kind, dashboardId, pages, tile, onSave, onClose }: {
  kind: Kind; dashboardId: string; pages: DashboardPageT[]; tile?: DashboardTile; onSave: (tile: Omit<DashboardTile, 'id'>) => void; onClose: () => void
}) {
  const [title, setTitle] = useState(tile?.title ?? '')
  const [text, setText] = useState(tile?.text ?? '')
  const [label, setLabel] = useState(tile?.label ?? '')
  const [action, setAction] = useState<'view' | 'page' | 'report'>(tile?.action?.kind ?? 'view')
  const [target, setTarget] = useState(tile?.action?.id ?? '')
  const views = useQuery({ queryKey: ['insights', 'views', dashboardId], queryFn: () => dashboardsApi.views(dashboardId), enabled: kind === 'button' })
  const reports = useReports({})
  const targets = action === 'view' ? (views.data?.views ?? []).map((v) => ({ id: v.id, label: v.name }))
    : action === 'page' ? pages.map((p) => ({ id: p.id, label: p.title }))
    : (reports.data?.reports ?? []).map((r) => ({ id: r.id, label: r.name }))
  const ready = kind === 'text' ? text.trim().length > 0 : label.trim().length > 0 && targets.some((t) => t.id === target)
  const save = () => onSave(kind === 'text'
    ? { report_id: '', show: 'text', text: text.trim(), ...(title.trim() ? { title: title.trim() } : {}) }
    : { report_id: '', show: 'button', label: label.trim(), action: { kind: action, id: target } })
  return (
    <Modal title={kind === 'text' ? (tile ? 'Change the Text' : 'Add Text') : (tile ? 'Change the Button' : 'Add a Button')} onClose={onClose} size="md"
      footer={<div className="flex justify-end gap-2"><button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button><button type="button" className={buttonPrimary} disabled={!ready} onClick={save}>{tile ? 'Save' : 'Add to Dashboard'}</button></div>}>
      {kind === 'text' ? (
        <div className="flex flex-col gap-4">
          <Field label="Title" hint="Optional">{(ids) => <TextInput id={ids.id} describedBy={ids.describedBy} value={title} maxLength={100} onChange={(event) => setTitle(event.target.value)} />}</Field>
          <Field label="Text" hint="A blank line starts a paragraph; a line starting with - is a bullet; **words** are bold">
            {(ids) => <TextArea id={ids.id} describedBy={ids.describedBy} value={text} rows={7} maxLength={4000} onChange={(event) => setText(event.target.value)} />}
          </Field>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Field label="Label">{(ids) => <TextInput id={ids.id} value={label} maxLength={60} placeholder="Email Only" onChange={(event) => setLabel(event.target.value)} />}</Field>
          <Field label="When Pressed">{(ids) => <Select id={ids.id} value={action} onChange={(event) => { setAction(event.target.value as typeof action); setTarget('') }}>{ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</Select>}</Field>
          <Field label={action === 'view' ? 'Saved View' : action === 'page' ? 'Page' : 'Report'} hint={action === 'view' && !targets.length ? 'Save a view of this dashboard first (Views, on the dashboard).' : undefined}>
            {(ids) => (
              <Select id={ids.id} describedBy={ids.describedBy} value={target} onChange={(event) => setTarget(event.target.value)}>
                <option value="">Choose one</option>
                {targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </Select>
            )}
          </Field>
        </div>
      )}
    </Modal>
  )
}
