/** The sticky right-hand panel: ready to run (readiness ring, what will go out), sending (a real request in flight),
 * or the test's results with Approve & Activate / Run Test Again. Once the journey is approved the whole page body
 * becomes the outcome screen (features/journeys/JourneyOutcome.tsx). */
import { CheckCircle2, Play } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import { buttonPrimary, buttonSecondary } from '@/components/Form'
import { Spinner } from '@/components/States'
import { formatNumber, formatRelative } from '@/lib/format'
import type { JourneyTestResult } from '@/lib/types'

const CHANNEL_NAME: Record<string, string> = { EMAIL: 'Email', SMS: 'SMS' }

interface SidePanelProps {
  state: 'ready' | 'sending' | 'results'
  canRun: boolean
  /** readiness checks passed / total; null while they load */
  checks: { passed: number; total: number } | null
  populationText: string
  channelsText: string
  result: JourneyTestResult | null
  /** when the result arrived (ISO) */
  resultAt: string | null
  onRunTest: () => void
  onApprove: () => void
  onRunAgain: () => void
}

const PANEL = 'sticky top-4 flex flex-col gap-5 rounded-lg border border-line bg-surface p-5'

export function TestPublishSidePanel({ state, canRun, checks, populationText, channelsText, result, resultAt, onRunTest, onApprove, onRunAgain }: SidePanelProps) {
  if (state === 'results' && result) {
    return <ResultsPanel result={result} resultAt={resultAt} onApprove={onApprove} onRunAgain={onRunAgain} />
  }

  const sending = state === 'sending'
  const allPass = checks !== null && checks.passed === checks.total
  return (
    <aside aria-label="Run Test Publish" className={PANEL}>
      <div className="flex flex-col items-center gap-3 pt-1">
        {sending ? (
          <div className="flex h-[104px] w-[104px] items-center justify-center"><Spinner size="lg" label="Sending the test" /></div>
        ) : (
          <ReadinessRing checks={checks} />
        )}
        {sending ? (
          <p className="text-sm font-semibold text-ink-900">Sending the Test…</p>
        ) : checks === null ? (
          <p className="text-sm text-ink-800">Checking readiness</p>
        ) : allPass ? (
          <p className="flex items-center gap-1.5 text-sm font-semibold text-success-text"><CheckCircle2 size={16} strokeWidth={2} aria-hidden /> Ready to Run</p>
        ) : (
          <p className="text-sm font-semibold text-warning-text">{checks.total - checks.passed} {checks.total - checks.passed === 1 ? 'Check' : 'Checks'} to Fix</p>
        )}
      </div>

      <dl className="divide-y divide-line-subtle border-y border-line-subtle text-sm">
        <Row label="Test Population">{populationText}</Row>
        <Row label="Channels">{channelsText}</Row>
        <Row label="Est. Delivery Time">&lt; 2 min</Row>
      </dl>

      <div className="flex flex-col gap-3">
        <button type="button" className={`${buttonPrimary} w-full`} disabled={!canRun || sending} onClick={onRunTest}>
          {sending ? <Spinner size="sm" tone="onBrand" /> : <Play size={16} strokeWidth={2} aria-hidden />} Run Test Publish
        </button>
        <p className="text-center text-helper text-ink-800">This sends real messages to the test population through Postal / Digivize — not a simulation.</p>
      </div>
    </aside>
  )
}

/** passed / total readiness checks as a small ring: green when all pass, amber otherwise. A status mark, not a chart. */
function ReadinessRing({ checks }: { checks: { passed: number; total: number } | null }) {
  const size = 104
  const stroke = 8
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const share = checks && checks.total > 0 ? checks.passed / checks.total : 0
  const allPass = checks !== null && checks.total > 0 && checks.passed === checks.total
  return (
    <div className="relative" style={{ width: size, height: size }} role="img" aria-label={checks ? `${checks.passed} of ${checks.total} checks passed` : 'Checking readiness'}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className="stroke-fill-subtle" />
        {share > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${circumference * share} ${circumference}`}
            className={allPass ? 'stroke-success' : 'stroke-warning'}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center" aria-hidden>
        <span className="font-display text-kpi font-semibold text-ink-900 tabular-nums">{checks ? `${checks.passed}/${checks.total}` : '—'}</span>
        <span className="mt-1 text-xs text-ink-800">checks passed</span>
      </div>
    </div>
  )
}

function ResultsPanel({ result, resultAt, onApprove, onRunAgain }: { result: JourneyTestResult; resultAt: string | null; onApprove: () => void; onRunAgain: () => void }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const flags = result.governance_flags
  const channels = Object.entries(result.by_channel ?? {})

  return (
    <aside aria-label="Test Results" className={PANEL}>
      <p role="status" className="flex items-start gap-2 rounded-md bg-success-bg px-3 py-2.5 text-helper text-success-text">
        <CheckCircle2 size={16} strokeWidth={2} aria-hidden className="mt-px shrink-0" />
        <span>Test run completed {formatRelative(resultAt, now)} for {formatNumber(result.sent_to)} customers.</span>
      </p>

      <div className="grid grid-cols-2 gap-3">
        <ResultTile label="Delivered" value={result.delivered} />
        <ResultTile label="Opened" value={result.opened} />
        <ResultTile label="Clicked" value={result.clicked} />
        <ResultTile label="Bounced" value={result.bounced} />
      </div>

      <dl className="divide-y divide-line-subtle border-y border-line-subtle text-sm">
        {channels.map(([channel, counts]) => (
          <Row key={channel} label={`${CHANNEL_NAME[channel] ?? channel} Delivered`}>
            {formatNumber(counts?.delivered)}/{formatNumber(counts?.sent)}
          </Row>
        ))}
        <Row label="Governance Flags">
          {flags.length === 0 ? <span className="text-success-text">None</span> : <span className="text-warning-text">{flags.join(', ')}</span>}
        </Row>
      </dl>

      <div className="flex flex-col gap-3">
        <button type="button" className={`${buttonPrimary} w-full`} onClick={onApprove}>Approve &amp; Activate →</button>
        <button type="button" className={`${buttonSecondary} w-full`} onClick={onRunAgain}>Run Test Again</button>
      </div>
    </aside>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="text-ink-800">{label}</dt>
      <dd className="text-right font-semibold text-ink-900 tabular-nums">{children}</dd>
    </div>
  )
}

function ResultTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line p-3">
      <p className="text-helper text-ink-800">{label}</p>
      <p className="mt-1 font-display text-kpi font-semibold text-ink-900 tabular-nums">{formatNumber(value)}</p>
    </div>
  )
}
