/**
 * Insights → Scheduled (docs/mockups/insights-admin-pages.html): two tabs. Schedules: every schedule this person may see, with
 * what, when, as what, to whom, the last sending and the next, filtered by kind, owner and status (kept in the address); New
 * Schedule and each row's ⋯ (Edit Schedule, Open, Pause or Resume, Delete) for whoever may. Alerts: every alert, with what it
 * watches, how often, its last value and its state; New Alert and each row's ⋯ (Edit Alert, Check Now, Pause, Delete).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellRing, CalendarClock, ExternalLink, Pause, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { PageHelp } from '@/apps/cep/help/HelpPanel'
import { ClearFiltersLink, FilterChip, SingleSelectMenu } from '@/components/FilterChip'
import { buttonPrimary } from '@/components/Form'
import { Notice } from '@/components/Notice'
import { PageHeader } from '@/components/ResourceList'
import { SearchField } from '@/components/SearchField'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { Tabs } from '@/components/Tabs'
import { useToast } from '@/components/Toast'
import { formatDateTime } from '@/lib/format'
import { alertsApi, keys, schedulesApi, useSchedules } from '../api'
import { AlertFlow } from '../components/AlertFlow'
import { listCardClass, listHeadClass, listRowClass, useListParams } from '../components/listParams'
import { RowMenu } from '../components/RowMenu'
import { ScheduleFlow } from '../components/ScheduleFlow'
import type { ReportAlert, Schedule } from '../types'

const FORMAT: Record<Schedule['format'], string> = { xlsx: 'Excel', csv: 'CSV', pdf: 'PDF', pptx: 'PowerPoint' }
const ICON = { size: 16, strokeWidth: 1.5, 'aria-hidden': true } as const
const KINDS = [{ value: 'report', label: 'Reports' }, { value: 'dashboard', label: 'Dashboards' }]
const STATUSES = [{ value: 'active', label: 'Active' }, { value: 'paused', label: 'Paused' }, { value: 'failing', label: 'Failing' }]
const ALERT_STATE: Record<ReportAlert['state'], { label: string; tone: 'success' | 'error' | 'neutral' }> = {
  OK: { label: 'Within', tone: 'success' }, TRIGGERED: { label: 'Crossed', tone: 'error' }, UNKNOWN: { label: 'Not Checked Yet', tone: 'neutral' },
}

const statusOf = (s: Schedule) => (s.status === 'PAUSED' ? 'paused' : s.last_outcome && s.last_outcome !== 'OK' ? 'failing' : 'active')

function Recipients({ addresses }: { addresses: string[] }) {
  const shown = addresses.slice(0, 2)
  return (
    <span className="flex flex-wrap items-center gap-1" title={addresses.join(', ')}>
      {shown.map((address) => (
        <span key={address} className="inline-flex h-6 max-w-44 items-center gap-1.5 rounded-pill bg-surface-sunken pr-2 pl-0.5 text-xs text-ink-900">
          <span aria-hidden className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[11px] font-bold text-brand-800">{address.charAt(0).toUpperCase()}</span>
          <span className="truncate">{address}</span>
        </span>
      ))}
      {addresses.length > shown.length && <Tag>{`+${addresses.length - shown.length}`}</Tag>}
    </span>
  )
}

function SchedulesTab({ onEdit }: { onEdit: (s: Schedule) => void }) {
  const { can, me } = useAuth()
  const navigate = useNavigate()
  const client = useQueryClient()
  const toast = useToast()
  const list = useListParams(['q', 'kind', 'owner', 'status'] as const)
  const schedules = useSchedules({})
  const refresh = () => client.invalidateQueries({ queryKey: keys.schedules })
  const state = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'pause' | 'resume' }) => schedulesApi.state(id, action),
    onSuccess: refresh, onError: (error) => toast.failure(error, 'The schedule was not changed'),
  })
  const remove = useMutation({ mutationFn: (id: string) => schedulesApi.remove(id), onSuccess: refresh, onError: (error) => toast.failure(error, 'The schedule was not deleted') })
  const mayChange = (s: Schedule) => can('report.admin') || (can('report.edit') && s.owner_user_id === me?.principal.id)
  const all = schedules.data?.schedules ?? []
  const q = list.get('q').trim().toLowerCase()
  const rows = all.filter((s) => (!q || (s.item_name ?? '').toLowerCase().includes(q))
    && (!list.get('kind') || s.kind === list.get('kind')) && (!list.get('owner') || s.owner_name === list.get('owner')) && (!list.get('status') || statusOf(s) === list.get('status')))
  const owners = Array.from(new Set(all.map((s) => s.owner_name).filter((n): n is string => Boolean(n)))).sort()
  const label = (options: { value: string; label: string }[], key: 'kind' | 'status', name: string) => {
    const on = options.find((o) => o.value === list.get(key))
    return on ? `${name}: ${on.label}` : name
  }

  return (
    <div className="flex flex-col gap-4">
      {schedules.data && !schedules.data.mail_configured && <Notice tone="warning" title="No Mail Server Yet">Schedules wait until the workspace has a mail server (Settings → Mail Server). They can still be set up.</Notice>}
      <div className="flex flex-wrap items-center gap-2">
        <SearchField label="Search schedules" value={list.get('q')} onChange={(next) => list.set({ q: next })} />
        <FilterChip label={label(KINDS, 'kind', 'Kind')} active={Boolean(list.get('kind'))} menuLabel="Kind">
          {({ close }) => <SingleSelectMenu label="Kind" value={list.get('kind')} options={[{ value: '', label: 'Reports and Dashboards' }, ...KINDS]} onChange={(value) => { list.set({ kind: value }); close() }} />}
        </FilterChip>
        <FilterChip label={list.get('owner') ? `Owner: ${list.get('owner')}` : 'Owner'} active={Boolean(list.get('owner'))} menuLabel="Owner">
          {({ close }) => <SingleSelectMenu label="Owner" value={list.get('owner')} options={[{ value: '', label: 'Anyone' }, ...owners.map((name) => ({ value: name, label: name }))]} onChange={(value) => { list.set({ owner: value }); close() }} />}
        </FilterChip>
        <FilterChip label={label(STATUSES, 'status', 'Status')} active={Boolean(list.get('status'))} menuLabel="Status">
          {({ close }) => <SingleSelectMenu label="Status" value={list.get('status')} options={[{ value: '', label: 'Any Status' }, ...STATUSES]} onChange={(value) => { list.set({ status: value }); close() }} />}
        </FilterChip>
        {list.filtering && <ClearFiltersLink onClick={list.clear} />}
      </div>
      {schedules.isPending ? <Spinner label="Loading the schedules" /> : schedules.isError ? <ErrorState error={schedules.error} onRetry={() => schedules.refetch()} /> : all.length === 0 ? (
        <EmptyState icon={CalendarClock} title="Nothing Scheduled Yet" hint="New Schedule sends a report or a dashboard by email on the days and at the time you choose." />
      ) : rows.length === 0 ? (
        <EmptyState icon={CalendarClock} title="No Schedules Match These Filters" hint="Try another kind, owner or status, or clear the filters." action={<ClearFiltersLink onClick={list.clear} />} />
      ) : (
        <div className={listCardClass}>
          <table className="w-full text-sm" aria-label="Schedules">
            <thead>
              <tr className={listHeadClass}>
                <th className="px-3 py-2">Report or Dashboard</th><th className="px-3 py-2">Every</th><th className="px-3 py-2">As</th><th className="px-3 py-2">Recipients</th><th className="px-3 py-2">Last Sent</th><th className="px-3 py-2">Next</th><th className="w-12 px-1 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className={listRowClass}>
                  <td className="px-3 py-2">
                    {s.item_gone ? <span className="font-medium text-ink-800">{s.item_name ?? 'A deleted report'}</span> : <Link to={`/insights/${s.kind === 'dashboard' ? 'dashboards' : 'reports'}/${s.item_id}`} className="font-medium text-ink-900 hover:underline">{s.item_name}</Link>}
                    <span className="block text-xs text-ink-800">{s.kind === 'dashboard' ? 'Dashboard' : 'Report'} · {s.owner_name ?? '—'}</span>
                  </td>
                  <td className="px-3 py-2 text-ink-800">{s.words.replace(/^Every /, '')}</td>
                  <td className="px-3 py-2 text-ink-800">{FORMAT[s.format]}</td>
                  <td className="px-3 py-2"><Recipients addresses={s.recipients} /></td>
                  <td className="px-3 py-2">
                    {s.last_outcome ? <Tag tone={s.last_outcome === 'OK' ? 'success' : 'error'}>{s.last_outcome === 'OK' ? 'Sent' : 'Failed'}</Tag> : <span className="text-ink-700">Not yet</span>}
                    {s.last_sent_at && <span className="block text-xs text-ink-800">{formatDateTime(s.last_sent_at)}{s.last_outcome !== 'OK' && s.last_detail ? ` · ${s.last_detail}` : ''}</span>}
                    {s.status === 'PAUSED' && <span className="block text-xs text-ink-800"><Tag tone="warning">Paused</Tag>{s.failures >= 3 ? ' after 3 failures' : ''}</span>}
                  </td>
                  <td className="cep-num px-3 py-2 whitespace-nowrap text-ink-800">{s.status === 'ACTIVE' && s.next_run_at ? formatDateTime(s.next_run_at) : '—'}</td>
                  <td className="px-1 py-1.5 text-right">
                    <RowMenu label={`Actions for the schedule of ${s.item_name ?? 'a deleted report'}`} groups={[
                      [
                        mayChange(s) && !s.item_gone && { title: 'Edit Schedule', icon: <Pencil {...ICON} />, onSelect: () => onEdit(s) },
                        !s.item_gone && { title: s.kind === 'dashboard' ? 'Open the Dashboard' : 'Open the Report', icon: <ExternalLink {...ICON} />, onSelect: () => navigate(`/insights/${s.kind === 'dashboard' ? 'dashboards' : 'reports'}/${s.item_id}`) },
                      ],
                      [mayChange(s) && { title: s.status === 'ACTIVE' ? 'Pause' : 'Resume', icon: s.status === 'ACTIVE' ? <Pause {...ICON} /> : <Play {...ICON} />, disabled: state.isPending, onSelect: () => state.mutate({ id: s.id, action: s.status === 'ACTIVE' ? 'pause' : 'resume' }) }],
                      [mayChange(s) && { title: 'Delete…', icon: <Trash2 {...ICON} className="text-danger-text" />, tone: 'error', disabled: remove.isPending, onSelect: () => { if (window.confirm(`Delete the schedule for “${s.item_name}”?`)) remove.mutate(s.id) } }],
                    ]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function AlertsTab({ alerts, onEdit }: { alerts: ReturnType<typeof useAlerts>; onEdit: (alert: ReportAlert) => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const client = useQueryClient()
  const refresh = () => client.invalidateQueries({ queryKey: ['insights', 'alerts'] })
  const check = useMutation({ mutationFn: (id: string) => alertsApi.check(id), onSuccess: (r) => { toast.success(`It is ${r.value_words}`, r.notified ? 'It crossed the threshold: the email went.' : r.met ? 'Still across the threshold; no new email.' : 'Within the threshold.'); void refresh() }, onError: (e) => toast.failure(e, 'The alert was not checked') })
  const state = useMutation({ mutationFn: (a: ReportAlert) => alertsApi.state(a.id, a.status === 'ACTIVE' ? 'pause' : 'resume'), onSuccess: refresh, onError: (e) => toast.failure(e, 'The alert was not changed') })
  const remove = useMutation({ mutationFn: (id: string) => alertsApi.remove(id), onSuccess: refresh, onError: (e) => toast.failure(e, 'The alert was not deleted') })
  if (alerts.isPending) return <Spinner label="Loading the alerts" />
  if (alerts.isError) return <ErrorState error={alerts.error} onRetry={() => alerts.refetch()} />
  if (!alerts.data.ready) return <Notice tone="warning" title="Not Available Yet">Alerts need database patch 0062, which is not applied to this workspace yet.</Notice>
  return (
    <div className="flex flex-col gap-4">
      {!alerts.data.mail_configured && <Notice tone="warning" title="No Mail Server Yet">This workspace has no mail server (Settings → Mail Server), so no alert can be emailed.</Notice>}
      {alerts.data.alerts.length === 0 ? (
        <EmptyState icon={BellRing} title="No Alerts Yet" hint="New Alert watches one of a report's values and emails you when it crosses a threshold." />
      ) : (
        <div className={listCardClass}>
          <table className="w-full text-sm" aria-label="Alerts">
            <thead>
              <tr className={listHeadClass}>
                <th className="px-3 py-2">Report</th><th className="px-3 py-2">Watches</th><th className="px-3 py-2">Checked</th><th className="px-3 py-2">Last Value</th><th className="px-3 py-2">State</th><th className="px-3 py-2">Recipients</th><th className="w-12 px-1 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {alerts.data.alerts.map((a) => {
                const said = ALERT_STATE[a.state]
                const may = a.can_change !== false
                return (
                  <tr key={a.id} className={listRowClass}>
                    <td className="px-3 py-2">
                      <Link to={`/insights/reports/${a.report_id}`} className="font-medium text-ink-900 hover:underline">{a.report_name ?? 'A deleted report'}</Link>
                      {a.name && <span className="block text-xs text-ink-800">{a.name}</span>}
                    </td>
                    <td className="px-3 py-2 text-ink-800">{a.words}</td>
                    <td className="px-3 py-2 text-ink-800">{a.every === 'hour' ? 'Every hour' : `Every day at ${a.at_time ?? '08:00'}`}</td>
                    <td className="cep-num px-3 py-2 text-ink-800">{a.last_value === null ? '—' : a.last_value.toLocaleString()}{a.last_checked_at && <span className="block text-xs">{formatDateTime(a.last_checked_at)}</span>}</td>
                    <td className="px-3 py-2"><span className="flex flex-wrap gap-1"><Tag tone={said.tone}>{said.label}</Tag>{a.status === 'PAUSED' && <Tag tone="warning">Paused</Tag>}</span>{a.last_detail && <span className="block text-xs text-danger-text">{a.last_detail}</span>}</td>
                    <td className="px-3 py-2"><Recipients addresses={a.recipients} /></td>
                    <td className="px-1 py-1.5 text-right">
                      <RowMenu label={`Actions for the alert on ${a.report_name ?? 'a deleted report'}`} groups={[
                        [
                          may && { title: 'Edit Alert', icon: <Pencil {...ICON} />, onSelect: () => onEdit(a) },
                          may && { title: 'Check Now', icon: <BellRing {...ICON} />, disabled: check.isPending, onSelect: () => check.mutate(a.id) },
                          { title: 'Open the Report', icon: <ExternalLink {...ICON} />, onSelect: () => navigate(`/insights/reports/${a.report_id}`) },
                        ],
                        [may && { title: a.status === 'ACTIVE' ? 'Pause' : 'Resume', icon: a.status === 'ACTIVE' ? <Pause {...ICON} /> : <Play {...ICON} />, disabled: state.isPending, onSelect: () => state.mutate(a) }],
                        [may && { title: 'Delete…', icon: <Trash2 {...ICON} className="text-danger-text" />, tone: 'error', disabled: remove.isPending, onSelect: () => { if (window.confirm('Delete this alert?')) remove.mutate(a.id) } }],
                      ]} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function useAlerts() {
  return useQuery({ queryKey: ['insights', 'alerts', 'all'], queryFn: () => alertsApi.list() })
}

export function ScheduledPage() {
  const { can, me } = useAuth()
  const builder = can('report.edit') || can('report.admin')
  const tabs = useListParams(['tab'] as const)
  const tab = tabs.get('tab') === 'alerts' ? 'alerts' : 'schedules'
  const schedules = useSchedules({})
  const alerts = useAlerts()
  const [scheduling, setScheduling] = useState<{ existing?: Schedule } | null>(null)
  const [alerting, setAlerting] = useState<{ existing?: ReportAlert } | null>(null)
  const zone = me?.tenant.timezone ?? 'UTC'
  let action: ReactNode
  if (tab === 'schedules' && builder) action = <button type="button" className={buttonPrimary} onClick={() => setScheduling({})}><Plus {...ICON} />New Schedule</button>
  else if (tab === 'alerts' && alerts.data?.ready) action = <button type="button" className={buttonPrimary} onClick={() => setAlerting({})}><Plus {...ICON} />New Alert</button>
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Scheduled" help={<PageHelp chapter="insights" />} actions={action} />
      <div className="flex overflow-x-auto border-b border-line">
        <Tabs label="Scheduled" idPrefix="scheduled" value={tab} onChange={(next) => tabs.set({ tab: next === 'alerts' ? 'alerts' : '' })}
          tabs={[{ id: 'schedules', label: 'Schedules', count: schedules.data?.schedules.length }, { id: 'alerts', label: 'Alerts', count: alerts.data?.ready ? alerts.data.alerts.length : undefined }]} />
      </div>
      {tab === 'schedules' ? <SchedulesTab onEdit={(existing) => setScheduling({ existing })} /> : <AlertsTab alerts={alerts} onEdit={(existing) => setAlerting({ existing })} />}
      {scheduling && <ScheduleFlow existing={scheduling.existing} zone={zone} onClose={() => setScheduling(null)} />}
      {alerting && <AlertFlow existing={alerting.existing} onClose={() => setAlerting(null)} />}
    </div>
  )
}
