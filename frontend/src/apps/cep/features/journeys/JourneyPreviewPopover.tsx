/** The List page's row-click preview: opens near the clicked row (not centred), reusing the Build/Test Publish
 * pages' own endpoints for its facts rather than adding new ones — the entry rule's human description already
 * exists on GET .../readiness/ (apps/journeys/publish.py's _entry_summary), and "ever enrolled" / "in journey"
 * already exist on GET .../performance/ (the nightly rollup, apps/journeys/engine/rollup.py). */
import { useQuery } from '@tanstack/react-query'
import { Archive, CalendarClock, CircleDashed, FlaskConical, Pause, Play } from 'lucide-react'
import { useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { Popover } from '@/components/Popover'
import { StatusBadge, Tag } from '@/components/StatusBadge'
import { api } from '@/lib/api'
import { formatDate, formatNumber } from '@/lib/format'
import type { Journey, JourneyReadiness, JourneyVersion } from '@/lib/types'

import { CHANNEL_META } from './channelMeta'
import { FAMILY_META } from './triggerFamily'

const STATUS_ICON = { DRAFT: CircleDashed, TEST: FlaskConical, APPROVED: CalendarClock, ACTIVE: Play, PAUSED: Pause, ARCHIVED: Archive } as const

const POPOVER_WIDTH = 360
const GAP = 6
const EDGE = 8

function placeNear(anchor: DOMRect, viewport: { width: number; height: number }) {
  const left = Math.max(EDGE, Math.min(anchor.left, viewport.width - POPOVER_WIDTH - EDGE))
  const roomBelow = viewport.height - anchor.bottom - GAP
  const flipped = roomBelow < 280 && anchor.top > roomBelow
  return flipped ? { left, bottom: viewport.height - anchor.top + GAP } : { left, top: anchor.bottom + GAP }
}

interface Performance {
  summary: { active_enrollment_count: number; completed_count: number; exited_count: number } | null
}

/** Also used by JourneyDetailsPage for the statuses its own notice banner doesn't have specific prototype copy for
 * (Test / Approved / Archived) — same wording everywhere rather than inventing a second version of it. */
export function activityLine(journey: Journey, version: JourneyVersion | undefined, enrolled: number | null): string {
  const date = (value: string | null) => formatDate(value)
  switch (journey.status) {
    case 'DRAFT':
      return 'Still being designed.'
    case 'TEST':
      return 'Testing in progress.'
    case 'APPROVED':
      return journey.scheduled_activate_at ? `Approved · goes live ${date(journey.scheduled_activate_at)}` : 'Approved · activating now.'
    case 'ACTIVE':
      return `Published ${date(version?.published_at ?? journey.updated_at)}`
    case 'PAUSED':
      return `Paused ${date(journey.updated_at)} · new enrollments halted, ${enrolled === null ? 'some' : formatNumber(enrolled)} contacts held in place`
    case 'ARCHIVED':
      return `Archived ${date(journey.updated_at)}`
    default:
      return ''
  }
}

export function JourneyPreviewPopover({ journey, anchor, onClose, onViewDetails }: { journey: Journey; anchor: HTMLElement; onClose: () => void; onViewDetails: () => void }) {
  const [at, setAt] = useState<{ left: number; top?: number; bottom?: number } | null>(null)

  useLayoutEffect(() => {
    const place = () => setAt(placeNear(anchor.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }))
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchor])

  const versions = useQuery({ queryKey: ['journeys', 'versions', journey.id], queryFn: ({ signal }) => api.get<JourneyVersion[]>(`/journeys/${journey.id}/versions/`, undefined, signal) })
  const version = versions.data?.find((item) => item.id === journey.current_version) ?? versions.data?.slice().sort((a, b) => b.version_number - a.version_number)[0]
  const readiness = useQuery({
    queryKey: ['journeys', 'readiness', journey.id, version?.version_number],
    queryFn: ({ signal }) => api.get<JourneyReadiness>(`/journeys/${journey.id}/versions/${version!.version_number}/readiness/`, undefined, signal),
    enabled: version !== undefined,
  })
  const performance = useQuery({
    queryKey: ['journeys', 'performance', journey.id],
    queryFn: ({ signal }) => api.get<Performance>(`/journeys/${journey.id}/performance/`, undefined, signal),
  })

  const trigger = readiness.data?.items.find((item) => item.key === 'entry_rules')?.description
  const summary = performance.data?.summary ?? null
  const everEnrolled = summary ? summary.active_enrollment_count + summary.completed_count + summary.exited_count : null
  const family = journey.trigger_family ? FAMILY_META[journey.trigger_family] : null
  const StatusIcon = STATUS_ICON[journey.status as keyof typeof STATUS_ICON] ?? CircleDashed

  return createPortal(
    <Popover
      label={`Preview: ${journey.name}`}
      onClose={onClose}
      width={POPOVER_WIDTH}
      placement="none"
      style={{ position: 'fixed', ...at }}
      className={at === null ? 'invisible' : ''}
    >
      <div className="p-4">
        <h2 className="text-sm font-semibold text-ink-900">{journey.name}</h2>

        <div className="mt-2 flex items-start gap-2 text-sm text-ink-900">
          <StatusIcon size={16} strokeWidth={1.5} aria-hidden className="mt-0.5 shrink-0 text-ink-800" />
          <div className="min-w-0">
            <StatusBadge status={journey.status} />
            <p className="mt-1 text-helper text-ink-800">{activityLine(journey, version, summary?.active_enrollment_count ?? null)}</p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {family && <Tag icon={family.icon}>{family.label}</Tag>}
          {journey.channels.map((channel) => {
            const meta = CHANNEL_META[channel]
            return <Tag key={channel} icon={meta?.icon}>{meta?.label ?? channel}</Tag>
          })}
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-line-subtle pt-3 text-sm">
          <div className="col-span-2">
            <dt className="text-xs font-semibold text-ink-800">Trigger</dt>
            <dd className="text-ink-900">{trigger ?? (readiness.isPending ? 'Loading…' : 'Not set yet.')}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-ink-800">Enrolled</dt>
            <dd className="cep-num text-ink-900">{everEnrolled === null ? '–' : formatNumber(everEnrolled)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-ink-800">Progress</dt>
            <dd className="cep-num text-ink-900">{summary === null ? '–' : `${formatNumber(summary.active_enrollment_count)} in journey`}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-xs font-semibold text-ink-800">Owner</dt>
            <dd className="text-ink-900">{journey.owner_user_name ?? 'Unassigned'}</dd>
          </div>
        </dl>

        <div className="mt-4 flex justify-end">
          <button type="button" className="text-sm font-semibold text-brand-800 hover:underline" onClick={onViewDetails}>View Details</button>
        </div>
      </div>
    </Popover>,
    document.body,
  )
}
