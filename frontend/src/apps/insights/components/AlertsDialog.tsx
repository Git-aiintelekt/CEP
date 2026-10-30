/**
 * Alerts on a report: "email me when Delivered Rate falls below 90%". Each alert watches one of the report's values over the
 * report's own filters, checked every hour or every day, and emails once when it crosses the threshold (again only after the
 * value is back). Check Now reads it at once; the list shows each alert's state and last value. Without the right to build
 * reports, an alert goes to you only.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { useState } from 'react'

import { buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { ErrorState, Spinner } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { useToast } from '@/components/Toast'
import { useAuth } from '@/auth/AuthContext'
import { formatDateTime } from '@/lib/format'
import { alertsApi } from '../api'
import type { ReportAlert, ResultColumn } from '../types'
import { AlertFields } from './AlertFields'
import { alertBody, alertDraftOf, alertReady } from './alertDraft'
import { formatCell } from './resultWords'

const STATE: Record<ReportAlert['state'], { label: string; tone: 'success' | 'error' | 'neutral' }> = {
  OK: { label: 'Within', tone: 'success' }, TRIGGERED: { label: 'Crossed', tone: 'error' }, UNKNOWN: { label: 'Not Checked Yet', tone: 'neutral' },
}

export function AlertRow({ alert, column, onChanged }: { alert: ReportAlert; column?: ResultColumn; onChanged: () => void }) {
  const toast = useToast()
  const check = useMutation({ mutationFn: () => alertsApi.check(alert.id), onSuccess: (r) => { toast.success(`It is ${r.value_words}`, r.notified ? 'It crossed the threshold: the email went.' : r.met ? 'Still across the threshold; no new email.' : 'Within the threshold.'); onChanged() }, onError: (e) => toast.failure(e, 'The alert was not checked') })
  const state = useMutation({ mutationFn: () => alertsApi.state(alert.id, alert.status === 'ACTIVE' ? 'pause' : 'resume'), onSuccess: onChanged, onError: (e) => toast.failure(e, 'The alert was not changed') })
  const remove = useMutation({ mutationFn: () => alertsApi.remove(alert.id), onSuccess: onChanged, onError: (e) => toast.failure(e, 'The alert was not deleted') })
  const said = STATE[alert.state]
  const value = (n: number | null) => (n === null ? '—' : column ? formatCell(column, n) : n.toLocaleString())
  return (
    <li className="flex flex-col gap-1.5 rounded-md border border-line p-3" aria-label={alert.name || alert.words}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 text-sm font-medium text-ink-900">{alert.name ? `${alert.name} · ` : ''}{alert.words}</span>
        <Tag tone={said.tone}>{said.label}</Tag>
        {alert.status === 'PAUSED' && <Tag tone="warning">Paused</Tag>}
      </div>
      <span className="cep-num text-xs text-ink-800">
        {alert.last_checked_at ? `Last ${value(alert.last_value)}, ${formatDateTime(alert.last_checked_at)}` : 'Not checked yet'}
        {alert.last_fired_at ? ` · last emailed ${formatDateTime(alert.last_fired_at)}` : ''} · to {alert.recipients.join(', ')}
      </span>
      {alert.last_detail && <span className="text-xs text-danger-text">{alert.last_detail}</span>}
      {alert.can_change !== false && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonSecondary} onClick={() => check.mutate()} disabled={check.isPending}>Check Now</button>
          <button type="button" className={buttonSecondary} onClick={() => state.mutate()} disabled={state.isPending}>{alert.status === 'ACTIVE' ? 'Pause' : 'Resume'}</button>
          <button type="button" className={buttonSecondary} onClick={() => remove.mutate()} disabled={remove.isPending}>Delete</button>
        </div>
      )}
    </li>
  )
}

export function AlertsDialog({ reportId, reportName, measures, onClose }: { reportId: string; reportName: string; measures: ResultColumn[]; onClose: () => void }) {
  const toast = useToast()
  const client = useQueryClient()
  const { me, can } = useAuth()
  const builder = can('report.edit') || can('report.admin')
  const key = ['insights', 'alerts', reportId]
  const alerts = useQuery({ queryKey: key, queryFn: () => alertsApi.list(reportId) })
  const [draft, setDraft] = useState(() => alertDraftOf(null, measures[0]?.key ?? '', me?.principal.email ?? ''))
  const refresh = () => client.invalidateQueries({ queryKey: key })
  const create = useMutation({
    mutationFn: () => alertsApi.create(alertBody(draft, reportId)),
    onSuccess: () => { toast.success('Alert set', 'It is checked on its schedule; Check Now reads it at once.'); setDraft((now) => ({ ...now, threshold: '', name: '' })); void refresh() },
    onError: (error) => toast.failure(error, 'The alert was not set'),
  })
  const ready = alertReady(draft)
  return (
    <Modal title="Alerts" subtitle={reportName} size="lg" scrollBody onClose={onClose} footer={<div className="flex justify-end"><button type="button" className={buttonSecondary} onClick={onClose}>Done</button></div>}>
      {alerts.isPending ? <Spinner label="Loading the alerts" /> : alerts.isError ? <ErrorState error={alerts.error} onRetry={() => alerts.refetch()} />
        : !alerts.data.ready ? <p className="text-sm text-ink-800">Alerts need database patch 0062, which is not applied to this workspace yet.</p>
        : (
          <div className="flex flex-col gap-5">
            {!alerts.data.mail_configured && <p role="alert" className="text-sm text-danger-text">This workspace has no mail server yet (Settings → Mail Server), so no alert can be sent.</p>}
            {alerts.data.alerts.length > 0 && (
              <ul aria-label="Alerts on this report" className="flex flex-col gap-2">
                {alerts.data.alerts.map((alert) => <AlertRow key={alert.id} alert={alert} column={measures.find((m) => m.key === alert.measure)} onChanged={() => void refresh()} />)}
              </ul>
            )}
            <form aria-label="New alert" className="flex flex-col gap-3 rounded-md border border-line p-3" onSubmit={(event) => { event.preventDefault(); if (ready) create.mutate() }}>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink-900"><Bell size={16} strokeWidth={1.5} aria-hidden />New Alert</h3>
              <AlertFields draft={draft} onChange={setDraft} measures={measures} builder={builder} />
              <div className="flex justify-end"><button type="submit" className={buttonPrimary} disabled={!ready || create.isPending || !alerts.data.mail_configured}>Set Alert</button></div>
            </form>
          </div>
        )}
    </Modal>
  )
}
