/**
 * Engine Health on the Sending Engines page: a tag with one line of reason in the engine's row, and a drawer with the checks
 * in plain words. Health is not a live lifecycle status, so its tags borrow the status colours without the dot: Healthy the
 * Active green, Attention (and No Receipts Yet) the Paused yellow, Failing the Failed rose, Quiet neutral grey.
 */
import { Drawer } from '@/components/Drawer'
import { statusColours } from '@/components/statusColours'
import { buttonClass } from '@/components/buttonStyles'
import { formatDateTime } from '@/lib/format'
import type { EngineHealth, EngineHealthCheck, EngineHealthStatus } from '@/lib/types'

const LOOK: Record<EngineHealthStatus, { label: string; colour: string }> = {
  HEALTHY: { label: 'Healthy', colour: 'ACTIVE' },
  ATTENTION: { label: 'Attention', colour: 'PAUSED' },
  FAILING: { label: 'Failing', colour: 'FAILED' },
  QUIET: { label: 'Quiet', colour: 'NEUTRAL' },
}

function healthLabel(health: EngineHealth): string {
  return health.standing ? 'No Receipts Yet' : LOOK[health.status].label
}

export function HealthTag({ health }: { health: EngineHealth }) {
  return (
    <span className={`inline-flex h-[22px] shrink-0 items-center rounded-sm px-2 text-xs font-medium whitespace-nowrap ${statusColours(LOOK[health.status].colour)}`}>
      {healthLabel(health)}
    </span>
  )
}

/** the summary's first sentence: what is wrong; what to do about it is in the drawer */
function firstSentence(text: string): string {
  const end = text.indexOf('. ')
  return end === -1 ? text : text.slice(0, end + 1)
}

/** The Health column: the tag, why in one line, and See Health when something needs a look. */
export function HealthCell({ health, onOpen }: { health: EngineHealth; onOpen: () => void }) {
  const problem = health.status === 'FAILING' || health.status === 'ATTENTION'
  return (
    <span className="flex max-w-[22rem] flex-col items-start gap-1">
      <HealthTag health={health} />
      <span className="text-xs text-ink-800">{health.summary ? firstSentence(health.summary) : `Checked ${formatDateTime(health.checked_at)}`}</span>
      {problem && <button type="button" className={buttonClass({ variant: 'link', size: 'sm' })} onClick={onOpen}>See Health</button>}
    </span>
  )
}

const VALUE_TONE: Partial<Record<EngineHealthCheck['state'], string>> = { failing: 'text-danger-plain', attention: 'text-warning-text' }
const STATE_WORD: Partial<Record<EngineHealthCheck['state'], string>> = { failing: 'Failing', attention: 'Needs attention', quiet: 'Not judged', off: 'Does not apply' }

export function EngineHealthDrawer({ name, health, onClose }: { name: string; health: EngineHealth; onClose: () => void }) {
  return (
    <Drawer title={`${name} · Health`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <HealthTag health={health} />
          <span className="text-sm text-ink-800">Checked {formatDateTime(health.checked_at)} · every 10 minutes</span>
        </div>
        <dl className="divide-y divide-line border-y border-line">
          {health.checks.map((check) => (
            <div key={check.key} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 py-3">
              <dt className="text-sm font-medium text-ink-900">{check.label}</dt>
              <dd className={`cep-num text-right text-sm font-semibold ${VALUE_TONE[check.state] ?? 'text-ink-900'}`}>
                {check.value}
                {STATE_WORD[check.state] && <span className="sr-only"> ({STATE_WORD[check.state]})</span>}
              </dd>
              <dd className="col-span-2 text-sm text-ink-800">{check.summary}</dd>
              {check.line && <dd className="col-span-2 text-xs text-ink-800">{check.line}</dd>}
            </div>
          ))}
        </dl>
        <p className="text-xs text-ink-800">The platform team is told when an engine fails. Thresholds are set by the platform team.</p>
      </div>
    </Drawer>
  )
}
