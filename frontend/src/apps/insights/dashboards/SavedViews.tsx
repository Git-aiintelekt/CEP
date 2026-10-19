/**
 * Saved views of a dashboard: a period, slicer picks, cross-filters, the page and the tiles' drills under a name. A view is
 * a person's own, or shared by someone who can change the dashboard with everyone who opens it. Picking one applies it.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bookmark, X } from 'lucide-react'
import { useState } from 'react'

import { IconButton } from '@/components/Button'
import { Checkbox } from '@/components/Checkbox'
import { FilterChip } from '@/components/FilterChip'
import { Field, TextInput, buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { Spinner } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { useToast } from '@/components/Toast'
import { dashboardsApi } from '../api'
import type { SavedView, ViewState } from '../types'

export function SavedViews({ dashboardId, canShare, current, onApply, applied }: {
  dashboardId: string
  canShare: boolean
  /** the dashboard as it is now, to save */
  current: ViewState
  onApply: (view: SavedView) => void
  /** the view picked last, named on the chip */
  applied: string | null
}) {
  const toast = useToast()
  const client = useQueryClient()
  const key = ['insights', 'dashboard-views', dashboardId]
  const views = useQuery({ queryKey: key, queryFn: () => dashboardsApi.views(dashboardId) })
  const [saving, setSaving] = useState(false)
  const remove = useMutation({
    mutationFn: (id: string) => dashboardsApi.deleteView(dashboardId, id),
    onSuccess: () => void client.invalidateQueries({ queryKey: key }),
    onError: (error) => toast.failure(error, 'The view was not removed'),
  })
  const list = views.data?.views ?? []
  const name = list.find((view) => view.id === applied)?.name
  return (
    <>
      <FilterChip label={name ? `View: ${name}` : 'Views'} active={Boolean(name)} menuLabel="Saved views" menuWidth={300}>
        {({ close }) => (
          <div className="flex flex-col">
            {views.isPending ? <div className="p-3"><Spinner size="sm" label="Loading the views" /></div> : (
              <ul aria-label="Saved views" className="max-h-64 overflow-y-auto py-1">
                {list.length === 0 && <li className="px-3 py-2 text-xs text-ink-800">No saved view yet. Set the period and the slicers, then save them as a view.</li>}
                {list.map((view) => (
                  <li key={view.id} className="flex items-center gap-1 pr-1">
                    <button type="button" onClick={() => { onApply(view); close() }} className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left text-sm text-ink-900 hover:bg-surface-hover">
                      <Bookmark size={14} strokeWidth={1.5} aria-hidden className="shrink-0 text-ink-700" />
                      <span className="min-w-0 flex-1 truncate">{view.name}</span>
                      {view.shared && <Tag tone="brand">Shared</Tag>}
                    </button>
                    {(view.mine || canShare) && <IconButton label={`Remove the view ${view.name}`} icon={X} size="xs" onClick={() => remove.mutate(view.id)} />}
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-line-subtle px-3 py-2">
              <button type="button" className="text-sm font-semibold text-brand-800 hover:underline" onClick={() => { close(); setSaving(true) }}>Save the Current View</button>
            </div>
          </div>
        )}
      </FilterChip>
      {saving && <SaveViewDialog dashboardId={dashboardId} canShare={canShare} current={current} onClose={() => setSaving(false)} onSaved={(view) => { setSaving(false); onApply(view) }} />}
    </>
  )
}

function SaveViewDialog({ dashboardId, canShare, current, onClose, onSaved }: { dashboardId: string; canShare: boolean; current: ViewState; onClose: () => void; onSaved: (view: SavedView) => void }) {
  const toast = useToast()
  const client = useQueryClient()
  const [name, setName] = useState('')
  const [shared, setShared] = useState(false)
  const save = useMutation({
    mutationFn: () => dashboardsApi.saveView(dashboardId, { name: name.trim(), shared, state: current }),
    onSuccess: (view) => { toast.success('View saved', `${view.name} is in Views.`); void client.invalidateQueries({ queryKey: ['insights', 'dashboard-views', dashboardId] }); onSaved(view) },
    onError: (error) => toast.failure(error, 'The view was not saved'),
  })
  return (
    <Modal title="Save the Current View" subtitle="The period, the slicers, the page and the tiles' drills, under a name" onClose={onClose} size="md"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button>
          <button type="button" className={buttonPrimary} disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>Save View</button>
        </div>
      )}>
      <div className="flex flex-col gap-3">
        <Field label="Name" required>{({ id }) => <TextInput id={id} value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="Email only, this quarter" autoFocus />}</Field>
        {canShare && <Checkbox label="Share with everyone who opens this dashboard" checked={shared} onChange={(event) => setShared(event.target.checked)} />}
      </div>
    </Modal>
  )
}
