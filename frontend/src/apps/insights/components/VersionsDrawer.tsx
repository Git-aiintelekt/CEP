/**
 * Versions, a drawer on the report viewer: every saved version with who, when and the note. Open shows that version's
 * rows in the viewer, read-only; Restore makes it the new current version (a new version, so nothing is lost).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Drawer } from '@/components/Drawer'
import { ErrorState, Spinner } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { useToast } from '@/components/Toast'
import { formatDateTime } from '@/lib/format'
import { insightsApi, keys, useVersions } from '../api'
import type { Report } from '../types'
import { VIEW_LABEL } from './ReportViews'

export function VersionsDrawer({ report, shown, canEdit, onOpen, onClose }: { report: Report; shown: number | null; canEdit: boolean; onOpen: (version: number | null) => void; onClose: () => void }) {
  const versions = useVersions(report.id)
  const client = useQueryClient()
  const toast = useToast()
  const restore = useMutation({
    mutationFn: (version: number) => insightsApi.restore(report.id, version),
    onSuccess: (saved, version) => {
      client.setQueryData(keys.report(report.id), { ...saved, can_edit: true })
      client.invalidateQueries({ queryKey: keys.versions(report.id) })
      client.invalidateQueries({ queryKey: ['insights', 'run', report.id] })
      client.invalidateQueries({ queryKey: ['insights', 'reports'] })
      onOpen(null)
      toast.success('Restored', `Version ${version} is now version ${saved.version}.`)
    },
    onError: (error) => toast.failure(error, 'The version was not restored'),
  })
  const link = 'text-xs font-semibold text-brand-800 hover:underline disabled:text-ink-700 disabled:no-underline'
  return (
    <Drawer title="Versions" eyebrow={report.name} onClose={onClose}>
      <p className="mb-3 text-xs text-ink-800">Every saved change. Open shows a version as it was; Restore makes it the current version again, as a new version.</p>
      {versions.isPending ? <Spinner label="Loading the versions" /> : versions.isError ? <ErrorState error={versions.error} onRetry={() => versions.refetch()} /> : (
        <ol aria-label="Versions" className="flex flex-col divide-y divide-line-subtle">
          {versions.data.versions.map((item) => {
            const current = item.version === report.version
            const open = shown === item.version
            return (
              <li key={item.version} className={`flex flex-col gap-1 px-2 py-2.5 ${open ? 'bg-brand-100/40' : ''}`}>
                <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                  <span>Version {item.version}</span>
                  {current && <Tag tone="brand">Current</Tag>}
                  <span className="ml-auto text-xs font-normal text-ink-700">{VIEW_LABEL[item.view_type]}</span>
                </div>
                <span className="text-xs text-ink-800">{item.changed_by_name ?? 'Someone'} · {formatDateTime(item.changed_at)}{item.note ? ` · ${item.note}` : ''}</span>
                <span className="flex gap-3">
                  {current ? (
                    shown !== null && <button type="button" className={link} onClick={() => onOpen(null)}>Back to Current</button>
                  ) : (
                    <>
                      <button type="button" className={link} onClick={() => onOpen(open ? null : item.version)}>{open ? 'Close' : 'Open'}</button>
                      {canEdit && <button type="button" className={link} disabled={restore.isPending}
                        onClick={() => { if (window.confirm(`Restore version ${item.version}? It becomes the current version, as version ${report.version + 1}.`)) restore.mutate(item.version) }}>Restore</button>}
                    </>
                  )}
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </Drawer>
  )
}
