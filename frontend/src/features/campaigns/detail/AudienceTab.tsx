/**
 * Audience: who the campaign reaches (or reached, once sent), the lists it is built from, why people are left out,
 * what the platform always leaves out, and a sample. Editing stays in the setup, through "Edit audience".
 */
import { ChevronDown, ChevronRight, Download, Lock } from 'lucide-react'
import { useId, useState } from 'react'
import { Link } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { Button } from '@/components/Button'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState, SkeletonLine } from '@/components/States'
import { StatusBadge, Tag } from '@/components/StatusBadge'
import { problemText } from '@/features/contact-lists/problem'
import { sourceLabel } from '@/features/contact-lists/sourceLabel'
import { exclusionReason } from '@/features/delivery/exclusionReasons'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import type { Campaign, CampaignAudience } from '@/lib/types'

import { audienceFunnel, audienceSummary, frozenFunnel, healthCounts, percentOf, reasonRows, systemRows, useCampaignAudience, type AudienceSummaryNumbers, type FunnelLine, type ReasonRow } from '../audienceNumbers'
import { CardError, CardLink, CardSubheading, DetailCard } from '../parts'
import { hasAction } from '../vocabulary'
import { setupHref } from '../setupFlow'
import { dateInZone, dateTimeInZone } from '../zone'
import { AudienceSummary } from './AudienceSummary'

type ListRow = CampaignAudience['lists'][number]
type SampleRow = CampaignAudience['sample'][number]

const oneDecimal = (value: number) => Math.round(value * 10) / 10

function Tile({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-line-subtle bg-surface-subtle p-4" data-tile={label}>
      <dt className="text-helper font-semibold text-ink-800">{label}</dt>
      <dd className="cep-num font-display text-2xl font-semibold text-ink-900">{formatNumber(value)}</dd>
      <dd className="text-helper text-ink-800">{note}</dd>
    </div>
  )
}

function HealthTiles({ campaign, numbers, audience }: { campaign: Campaign; numbers: AudienceSummaryNumbers; audience: CampaignAudience }) {
  const counts = healthCounts(numbers, audience)
  const share = (value: number) => `${oneDecimal(percentOf(value, numbers.total))}% of the people in your lists`
  return (
    <dl className="grid gap-4 md:grid-cols-3">
      <Tile label="Bounced" value={counts.bounced} note={share(counts.bounced)} />
      <Tile label="Unsubscribed or Suppressed" value={counts.unsubscribed} note={share(counts.unsubscribed)} />
      <Tile label={exclusionReason('FREQUENCY_CAP')} value={counts.frequency} note={campaign.respect_governance ? share(counts.frequency) : 'Frequency limits are off for this campaign'} />
    </dl>
  )
}

function ListsCard({ campaign, audience, zone }: { campaign: Campaign; audience: CampaignAudience; zone: string }) {
  const [problem, setProblem] = useState('')
  const attached = new Map(campaign.contact_list_details.map((list) => [list.id, list.attached_at]))
  const rows = [...audience.lists].sort((a, b) => Number(a.role === 'EXCLUDE') - Number(b.role === 'EXCLUDE'))

  async function exportCsv() {
    setProblem('')
    try {
      const blob = await api.download(`/campaigns/${campaign.id}/audience/export/`)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${campaign.code ?? campaign.name}-audience.csv`
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      setProblem(`The export was not produced. ${problemText(error)}`)
    }
  }

  const columns: Column<ListRow>[] = [
    { key: 'list', header: 'List', render: (list) => {
      const when = attached.get(list.id)
      return (
        <div className="flex min-w-0 flex-col gap-0.5 md:py-2">
          <Link to={`/contact-lists/${list.id}`} className="text-card-title font-semibold text-brand-800 hover:underline">{list.name}</Link>
          <span className="text-helper font-normal text-ink-800">{list.role === 'EXCLUDE' ? 'Excluded' : 'Send To'}{when ? ` · attached ${dateInZone(when, zone)}` : ''}</span>
        </div>
      )
    } },
    { key: 'source', header: 'Source', render: (list) => (
      <span className="inline-flex flex-wrap items-center gap-2">
        <Tag>{sourceLabel(list.source_type)}</Tag>
        {list.list_environment === 'TEST' && <StatusBadge status="TEST" label="Test" />}
      </span>
    ) },
    { key: 'updated', header: 'Updated', render: (list) => dateInZone(list.updated_at, zone) },
    { key: 'contacts', header: 'Contacts', align: 'right', render: (list) => formatNumber(list.member_count) },
  ]

  return (
    <DetailCard title="Contact Lists" flush={rows.length > 0}
      actions={rows.length > 0 && <Button size="sm" iconStart={Download} onClick={() => void exportCsv()}>Export CSV</Button>}>
      {problem && <p role="alert" className="mb-3 text-sm font-medium text-danger-text md:mx-6 md:mt-4">{problem}</p>}
      {rows.length === 0
        ? <p className="text-sm text-ink-800">No contact list is attached yet. Attach at least one before publishing.</p>
        : <DataTable columns={columns} rows={rows} rowKey={(list) => `${list.role}-${list.id}`} caption="Contact Lists" framed={false} inset="card" primary="list" />}
    </DetailCard>
  )
}

function Funnel({ label, lines, footnote }: { label: string; lines: FunnelLine[]; footnote?: string }) {
  return (
    <div className="min-w-0">
      <h4 className="mb-2 text-helper font-semibold text-ink-800">{label}</h4>
      <dl aria-label={label}>
        {lines.map((line) => (
          <div key={line.label} className={`flex items-baseline justify-between gap-4 border-b border-line-subtle py-2 text-sm last:border-0 ${line.strong ? 'font-semibold text-ink-900' : 'text-ink-800'}`}>
            <dt>{line.label}</dt>
            <dd className="cep-num shrink-0 text-right">{line.minus && line.value > 0 ? '−' : ''}{formatNumber(line.value)}</dd>
          </div>
        ))}
      </dl>
      {footnote && <p className="mt-2 text-helper text-ink-800">{footnote}</p>}
    </div>
  )
}

function ReasonList({ rows, label, muted = false }: { rows: ReasonRow[]; label: string; muted?: boolean }) {
  return (
    <ul aria-label={label}>
      {rows.map((row) => (
        <li key={row.key} data-reason={row.key} className="flex items-start justify-between gap-4 border-b border-line-subtle py-3 first:pt-0 last:border-0 last:pb-0">
          <span className="min-w-0">
            <span className={`block text-sm font-semibold ${muted ? 'text-ink-800' : 'text-ink-900'}`}>{row.label}</span>
            <span className="block text-helper text-ink-800">{row.text}</span>
          </span>
          <span className={`cep-num shrink-0 text-sm ${muted ? 'text-ink-800' : 'text-ink-900'}`}>{formatNumber(row.count)}</span>
        </li>
      ))}
    </ul>
  )
}

function ExclusionsCard({ numbers, audience, zone }: { numbers: AudienceSummaryNumbers; audience: CampaignAudience; zone: string }) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  const reasons = reasonRows(numbers, audience)
  const frozen = numbers.sent ? audience.frozen : undefined
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <section className="rounded-lg border border-line bg-surface" aria-label="Exclusions">
      <h2>
        <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}
          className={`flex w-full items-center gap-3 px-6 py-4 text-left transition-colors duration-fast ease-standard hover:bg-surface-subtle ${open ? 'rounded-t-lg' : 'rounded-lg'}`}>
          <Chevron size={16} strokeWidth={1.5} aria-hidden className="shrink-0 text-ink-800" />
          <span className="cep-num min-w-0 flex-1 text-sm font-semibold text-ink-900">{formatNumber(numbers.excluded)} excluded of {formatNumber(numbers.total)} in your lists</span>
          <span className="shrink-0 text-helper font-semibold text-brand-800">{open ? 'Hide Breakdown' : 'View Breakdown'}</span>
        </button>
      </h2>
      {open && (
        <div id={bodyId} className="flex flex-col gap-6 border-t border-line-subtle p-6">
          <div>
            <CardSubheading className="mb-3">How the Number Is Worked Out</CardSubheading>
            {frozen ? (
              <div className="grid gap-6 md:grid-cols-2">
                <Funnel label="At the Last Send" lines={frozenFunnel(frozen, audience.channel)} footnote={`Frozen ${dateTimeInZone(frozen.generated_at, zone)}. Later changes to the contact lists do not touch it.`} />
                <Funnel label="If It Were Sent Today" lines={audienceFunnel(audience)} footnote={audience.note || undefined} />
              </div>
            ) : <Funnel label="Today's Estimate" lines={audienceFunnel(audience)} />}
          </div>
          <div>
            <CardSubheading className="mb-3">Reasons</CardSubheading>
            {reasons.length ? <ReasonList rows={reasons} label="Reasons people are left out" /> : <p className="text-sm text-ink-800">Nobody is left out by this campaign’s lists or send rules.</p>}
          </div>
          {!frozen && audience.note && <p className="text-helper text-ink-800">{audience.note}</p>}
        </div>
      )}
    </section>
  )
}

function SystemCard({ numbers, audience }: { numbers: AudienceSummaryNumbers; audience: CampaignAudience }) {
  const rows = systemRows(numbers, audience)
  return (
    <DetailCard title="System Exclusions" muted icon={<Lock size={16} strokeWidth={1.5} aria-hidden className="shrink-0 text-ink-300" />} tag={<Tag>Always Applied</Tag>}>
      {rows.length ? <ReasonList rows={rows} label="System Exclusions" muted /> : <p className="text-sm text-ink-800">Nobody is excluded by system rules.</p>}
    </DetailCard>
  )
}

function SampleCard({ audience }: { audience: CampaignAudience }) {
  const columns: Column<SampleRow>[] = [
    { key: 'customer', header: 'Customer', render: (person) => person.party_id },
    { key: 'name', header: 'Name', render: (person) => <span className="text-ink-900">{[person.first_name, person.last_name].filter(Boolean).join(' ') || '—'}</span> },
    { key: 'address', header: audience.channel === 'EMAIL' ? 'Email' : 'Mobile', render: (person) => person.address ?? '—' },
    { key: 'today', header: 'Today', render: (person) => <Tag tone={person.status === 'MARKETABLE' ? 'success' : 'warning'}>{person.status_label}</Tag> },
  ]
  return (
    <DetailCard title="Sample of the Audience" description="As of today: up to ten people, the ones who can be reached first." flush={audience.sample.length > 0}>
      {audience.sample.length === 0 ? <p className="text-sm text-ink-800">Nobody to show yet.</p>
        : <DataTable columns={columns} rows={audience.sample} rowKey={(person) => person.party_id} caption="Sample of the Audience" framed={false} inset="card" primary="name" />}
    </DetailCard>
  )
}

export function AudienceTab({ campaign, zone }: { campaign: Campaign; zone: string }) {
  const { can } = useAuth()
  const audience = useCampaignAudience(campaign)
  const editable = can('campaign.edit') && hasAction(campaign, 'edit') && !campaign.is_journey_generated

  if (campaign.campaign_type === 'E_RECEIPT') {
    return <EmptyState title="No audience to attach" hint="An e-receipt goes to the customer of each purchase. The point of sale or the web shop asks for every receipt." />
  }

  const summaryActions = editable && <CardLink to={setupHref(campaign.id, { step: 'audience' })}>Edit Audience</CardLink>
  if (audience.isPending) {
    return (
      <DetailCard title="Audience" actions={summaryActions}>
        <div className="flex flex-col gap-3" aria-busy><SkeletonLine width="40%" /><SkeletonLine width="100%" /><SkeletonLine width="64%" /></div>
      </DetailCard>
    )
  }
  if (audience.isError) {
    return (
      <DetailCard title="Audience" actions={summaryActions}>
        <CardError what="the audience" error={audience.error} onRetry={() => void audience.refetch()} />
      </DetailCard>
    )
  }

  const data = audience.data
  const numbers = audienceSummary(campaign, data)
  return (
    <div className="flex flex-col gap-6">
      <DetailCard title="Audience" actions={summaryActions}>
        <div className="flex flex-col gap-6">
          <AudienceSummary numbers={numbers} />
          <HealthTiles campaign={campaign} numbers={numbers} audience={data} />
        </div>
      </DetailCard>
      <ListsCard campaign={campaign} audience={data} zone={zone} />
      <ExclusionsCard numbers={numbers} audience={data} zone={zone} />
      <SystemCard numbers={numbers} audience={data} />
      <SampleCard audience={data} />
    </div>
  )
}
