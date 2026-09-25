/**
 * Every run of the campaign, newest first. On Overview until there are results; on the Performance tab after that, where
 * each production run opens in place to show what happened in it (the latest one open to begin with).
 */
import { useEffect } from 'react'

import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/States'
import { StatusBadge, Tag } from '@/components/StatusBadge'
import { RunResults } from '@/features/delivery/RunResults'
import { formatNumber, titleize } from '@/lib/format'
import type { Campaign, CampaignRun } from '@/lib/types'

import { DetailCard } from '../parts'
import { dateTimeInZone } from '../zone'

const runColumns = (zone: string): Column<CampaignRun>[] => [
  { key: 'number', header: 'Run', render: (run) => <span className="font-medium text-ink-900">#{run.run_number}{run.sequence_label ? ` · ${run.sequence_label}` : ''}</span> },
  { key: 'type', header: 'Type', render: (run) => titleize(run.run_type) },
  { key: 'status', header: 'Status', render: (run) => <StatusBadge status={run.status} /> },
  { key: 'mode', header: 'Mode', render: (run) => <Tag>{run.test_mode ? 'Test' : 'Production'}</Tag> },
  { key: 'scheduled', header: 'Scheduled', render: (run) => dateTimeInZone(run.scheduled_at, zone) },
  { key: 'started', header: 'Started', render: (run) => dateTimeInZone(run.started_at, zone) },
  { key: 'completed', header: 'Completed', render: (run) => dateTimeInZone(run.completed_at, zone) },
]

const plural = (count: number, word: string) => `${formatNumber(count)} ${word}${count === 1 ? '' : 's'}`

export function RunsCard({ campaign, zone, live, expandable = false, focusRun }: { campaign: Campaign; zone: string; live: boolean; expandable?: boolean; focusRun?: string }) {
  // the run asked for opens (instead of the latest) and comes into view with focus on its button; the cards above it
  // are still loading, so it's kept in view while the page settles, until the person scrolls or two seconds pass
  useEffect(() => {
    if (!focusRun) return
    const row = [...document.querySelectorAll<HTMLElement>('[data-row-key]')].find((element) => element.dataset.rowKey === focusRun)
    if (!row) return
    const bring = () => row.scrollIntoView?.({ block: 'start' })
    bring()
    row.querySelector<HTMLElement>('button[aria-expanded]')?.focus({ preventScroll: true })
    if (typeof ResizeObserver === 'undefined') return
    const settle = new ResizeObserver(bring)
    settle.observe(row.closest('[role="tabpanel"]') ?? document.body)
    const stop = () => settle.disconnect()
    const timer = window.setTimeout(stop, 2000)
    window.addEventListener('wheel', stop, { once: true })
    window.addEventListener('touchmove', stop, { once: true })
    return () => {
      stop()
      window.clearTimeout(timer)
      window.removeEventListener('wheel', stop)
      window.removeEventListener('touchmove', stop)
    }
  }, [focusRun])
  const runs = [...campaign.runs].sort((a, b) => b.run_number - a.run_number)
  const production = runs.filter((run) => !run.test_mode)
  return (
    <DetailCard title="Runs" flush={runs.length > 0}
      tag={live && <span className="text-xs text-ink-500">updating every few seconds</span>}
      actions={runs.length > 0 && <span className="cep-num text-ink-500">{plural(runs.length, 'run')} · {formatNumber(production.length)} production, {formatNumber(runs.length - production.length)} test</span>}>
      {runs.length === 0
        ? <EmptyState variant="plain" title="No runs yet" hint="Publishing the campaign creates run #1 and the send engine starts it. Recurring and drip campaigns add a run per send." />
        : <DataTable key={focusRun} columns={runColumns(zone)} rows={runs} rowKey={(run) => run.id} caption="Campaign runs" framed={false} inset="card" primary="number"
            expand={expandable ? {
              canExpand: (run) => !run.test_mode,
              label: (run) => `Results of run #${run.run_number}`,
              initiallyOpen: focusRun ? [focusRun] : production[0] ? [production[0].id] : [],
              render: (run) => <RunResults run={run} zone={zone} channel={campaign.channel} />,
            } : undefined} />}
    </DetailCard>
  )
}
