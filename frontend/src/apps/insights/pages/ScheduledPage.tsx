/** Insights → Scheduled: every schedule this person may see, with what, when, to whom, as what, the last sending and the next; Pause, Resume and Delete for whoever may. */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { PageHelp } from '@/apps/cep/help/HelpPanel'
import { PageHeader } from '@/components/ResourceList'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { useToast } from '@/components/Toast'
import { formatDateTime } from '@/lib/format'
import { useQuery } from '@tanstack/react-query'
import { alertsApi, keys, schedulesApi, useSchedules } from '../api'
import { AlertRow } from '../components/AlertsDialog'
import type { Schedule } from '../types'

const FORMAT: Record<Schedule['format'], string> = { xlsx: 'Excel', csv: 'CSV', pdf: 'PDF', pptx: 'PowerPoint' }

export function ScheduledPage() {
  const { can, me } = useAuth()
  const principal = me?.principal
  const client = useQueryClient()
  const toast = useToast()
  const [filter, setFilter] = useState<'all' | 'mine' | 'paused'>('all')
  const schedules = useSchedules({})
  const refresh = () => client.invalidateQueries({ queryKey: keys.schedules })
  const state = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'pause' | 'resume' }) => schedulesApi.state(id, action),
    onSuccess: refresh, onError: (error) => toast.failure(error, 'The schedule was not changed'),
  })
  const remove = useMutation({ mutationFn: (id: string) => schedulesApi.remove(id), onSuccess: refresh, onError: (error) => toast.failure(error, 'The schedule was not deleted') })
  const rows = (schedules.data?.schedules ?? []).filter((s) => filter === 'all' || (filter === 'mine' ? s.owner_user_id === principal?.id : s.status === 'PAUSED'))
  const mayChange = (s: Schedule) => can('report.admin') || (can('report.edit') && s.owner_user_id === principal?.id)
  const alerts = useQuery({ queryKey: ['insights', 'alerts', 'all'], queryFn: () => alertsApi.list() })
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Scheduled" description="Reports and dashboards sent by email on a schedule." help={<PageHelp chapter="insights" />} />
      <div role="group" aria-label="Which" className="flex flex-wrap gap-1.5">
        {([['all', 'All'], ['mine', 'Mine'], ['paused', 'Paused']] as const).map(([value, label]) => (
          <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}
            className={`h-7 rounded-control-md border px-2.5 text-xs font-semibold transition-colors ${filter === value ? 'border-brand-100 bg-brand-100 text-brand-800' : 'border-line bg-surface text-ink-900 hover:bg-surface-hover'}`}>{label}</button>
        ))}
      </div>
      {schedules.isPending ? <Spinner label="Loading the schedules" /> : schedules.isError ? <ErrorState error={schedules.error} onRetry={() => schedules.refetch()} /> : rows.length === 0 ? (
        <EmptyState title="Nothing Scheduled Yet" hint="Open a report or a dashboard and press Schedule: it goes out by email on the days and at the time you choose, as Excel, CSV or PDF." action={<Link to="/insights/reports" className="text-sm font-semibold text-brand-800 hover:underline">Open Reports</Link>} />
      ) : (
        <div className="overflow-x-auto rounded-md border border-line bg-surface">
          <table className="w-full text-sm" aria-label="Schedules">
            <thead>
              <tr className="text-left text-xs font-semibold tracking-wide text-ink-800 uppercase">
                <th className="px-3 py-2">Report</th><th className="px-3 py-2">Every</th><th className="px-3 py-2">As</th><th className="px-3 py-2">To</th><th className="px-3 py-2">Last Sent</th><th className="px-3 py-2">Next</th><th className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="border-t border-line-subtle">
                  <td className="px-3 py-2">
                    {s.item_gone ? <span className="font-medium text-ink-800">{s.item_name ?? 'A deleted report'}</span> : <Link to={`/insights/${s.kind === 'dashboard' ? 'dashboards' : 'reports'}/${s.item_id}`} className="font-medium text-ink-900 hover:underline">{s.item_name}</Link>}
                    <span className="block text-xs text-ink-800">{s.kind === 'dashboard' ? 'Dashboard · ' : ''}{s.owner_name ?? '—'}</span>
                  </td>
                  <td className="px-3 py-2 text-ink-800">{s.words.replace(/^Every /, '')}</td>
                  <td className="px-3 py-2 text-ink-800">{FORMAT[s.format]}</td>
                  <td className="px-3 py-2 text-ink-800" title={s.recipients.join(', ')}>{s.recipients.length} {s.recipients.length === 1 ? 'person' : 'people'}</td>
                  <td className="px-3 py-2">
                    {s.last_outcome ? <Tag tone={s.last_outcome === 'OK' ? 'success' : 'error'}>{s.last_outcome === 'OK' ? 'Sent' : 'Failed'}</Tag> : <span className="text-ink-700">Not yet</span>}
                    {s.last_sent_at && <span className="block text-xs text-ink-800">{formatDateTime(s.last_sent_at)}{s.last_outcome !== 'OK' && s.last_detail ? ` · ${s.last_detail}` : ''}</span>}
                    {s.status === 'PAUSED' && <span className="block text-xs text-ink-800"><Tag tone="warning">Paused</Tag>{s.failures >= 3 ? ' after 3 failures' : ''}</span>}
                  </td>
                  <td className="cep-num px-3 py-2 whitespace-nowrap text-ink-800">{s.status === 'ACTIVE' && s.next_run_at ? formatDateTime(s.next_run_at) : '—'}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {mayChange(s) && (
                      <span className="flex justify-end gap-3 text-xs font-semibold text-brand-800">
                        <button type="button" className="hover:underline" disabled={state.isPending} onClick={() => state.mutate({ id: s.id, action: s.status === 'ACTIVE' ? 'pause' : 'resume' })}>{s.status === 'ACTIVE' ? 'Pause' : 'Resume'}</button>
                        <button type="button" className="hover:underline" disabled={remove.isPending} onClick={() => { if (window.confirm(`Delete the schedule for “${s.item_name}”?`)) remove.mutate(s.id) }}>Delete</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {alerts.data?.ready && (
        <section aria-label="Alerts" className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-ink-900">Alerts</h2>
          <p className="text-sm text-ink-800">A report's value checked every hour or every day, with an email when it crosses its threshold. Set one from a report's Alerts.</p>
          {alerts.data.alerts.length === 0 ? <p className="text-sm text-ink-700">No alert yet.</p> : (
            <ul className="flex flex-col gap-2">
              {alerts.data.alerts.map((alert) => (
                <div key={alert.id} className="flex flex-col gap-1">
                  <Link to={`/insights/reports/${alert.report_id}`} className="text-xs font-semibold text-brand-800 hover:underline">{alert.report_name ?? 'A deleted report'}</Link>
                  <AlertRow alert={alert} onChanged={() => void alerts.refetch()} />
                </div>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
