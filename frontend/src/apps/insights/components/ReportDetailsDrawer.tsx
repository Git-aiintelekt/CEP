/**
 * Report Details: what a report is and where it stands, in one drawer opened from the report's header. Description,
 * owner, data, folder and component (changed here by whoever may edit), who it is shared with, its schedule, alerts and
 * comments, and its version and dates. Each link opens the dialog the report page already has.
 */
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { Drawer } from '@/components/Drawer'
import { formatDate } from '@/lib/format'
import { alertsApi, useVersions } from '../api'
import type { Report, RunResult } from '../types'
import { ComponentSelect } from './ComponentSelect'
import { FolderSelect } from './FolderSelect'
import { runWords } from './resultWords'

interface ReportDetailsDrawerProps {
  report: Report
  datasetLabel: string
  info: RunResult | undefined
  schedule: string | null
  comments: number
  canSchedule: boolean
  onClose: () => void
  onFolder: (folderId: string | null) => void
  onComponent: (key: string | null) => void
  saving: boolean
  onShare: () => void
  onSchedule: () => void
  onAlerts: () => void
  onComments: () => void
  onVersions: () => void
}

const LINK = 'font-medium text-link hover:underline'

function Row({ label, children, htmlFor }: { label: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-4 text-sm">
      {htmlFor ? <label htmlFor={htmlFor} className="text-ink-800">{label}</label> : <span className="text-ink-800">{label}</span>}
      <span className="flex min-w-0 items-center gap-1.5 text-right text-ink-900">{children}</span>
    </div>
  )
}

function Action({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={LINK}>{children}</button>
}

function Section({ children }: { children: ReactNode }) {
  return <section className="flex flex-col gap-2 border-t border-line-subtle py-4 first:border-t-0 first:pt-0">{children}</section>
}

export function ReportDetailsDrawer({ report, datasetLabel, info, schedule, comments, canSchedule, onClose, onFolder, onComponent, saving, onShare, onSchedule, onAlerts, onComments, onVersions }: ReportDetailsDrawerProps) {
  const versions = useVersions(report.id)
  const alerts = useQuery({ queryKey: ['insights', 'alerts', report.id], queryFn: () => alertsApi.list(report.id) })
  const newest = versions.data?.versions.find((v) => v.version === report.version)
  const alertCount = alerts.data?.alerts.length ?? 0
  const sharedWords = report.visibility === 'WORKSPACE' ? 'Everyone in the workspace' : report.shared ? 'Shared' : 'Only you'
  return (
    <Drawer title="Report Details" onClose={onClose}>
      <div className="flex flex-col">
        <Section>
          <span className="text-sm text-ink-800">Description</span>
          <p className="text-sm text-ink-900">
            {report.description || <span className="text-ink-800">No description yet.</span>}
            {report.can_edit && <> <Link to={`/insights/reports/${report.id}/edit`} className={LINK}>Edit</Link></>}
          </p>
        </Section>
        <Section>
          <Row label="Owner">{report.owner_name ?? '—'}</Row>
          <Row label="Data">{datasetLabel}</Row>
          {report.can_edit ? (
            <>
              <Row label="Folder"><FolderSelect bare value={report.folder_id} onChange={onFolder} disabled={saving} /></Row>
              <Row label="Component" htmlFor="report-details-component">
                <span className="w-60"><ComponentSelect id="report-details-component" value={report.component_key ?? null} auto={report.component_auto ?? null} onChange={onComponent} disabled={saving} /></span>
              </Row>
            </>
          ) : null}
        </Section>
        <Section>
          <Row label="Shared With">{sharedWords}{report.can_share && <> · <Action onClick={onShare}>Share</Action></>}</Row>
          <Row label="Schedule">{schedule ?? 'Not scheduled'}{canSchedule && <> · <Action onClick={onSchedule}>{schedule ? 'Change' : 'Schedule'}</Action></>}</Row>
          <Row label="Alerts">{alerts.isPending ? '…' : alertCount === 0 ? 'None' : alertCount}{' · '}<Action onClick={onAlerts}>{alertCount ? 'Open' : 'Add'}</Action></Row>
          <Row label="Comments">{comments}{' · '}<Action onClick={onComments}>Open</Action></Row>
        </Section>
        <Section>
          <Row label="Version">{report.version}{' · '}<Action onClick={onVersions}>See Versions</Action></Row>
          <Row label="Last Edited">{formatDate(newest?.changed_at ?? report.updated_at)}{newest?.changed_by_name ? ` by ${newest.changed_by_name}` : ''}</Row>
          <Row label="Created">{formatDate(report.created_at)}</Row>
          {info && <Row label="Last Run">{runWords(info)}</Row>}
        </Section>
      </div>
    </Drawer>
  )
}
