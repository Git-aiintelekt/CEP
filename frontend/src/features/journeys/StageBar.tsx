/** The journey workspace's top bar, shared by the Build and Test Publish pages: the journey's name on the
 * left, the Setup -> Build -> Test Publish -> Approve stepper in the centre, and the page's own actions on the right.
 * Each page says which stage it is and what the others look like from there. Setup (6e) and Approve's own page aren't
 * built — Setup stays "done" (its summary lives in the Build sidebar), Approve lives on the Test Publish page. */
import { ArrowLeft, Check, Clock } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'


export type StageState = 'done' | 'current' | 'locked' | 'scheduled'

interface StageBarProps {
  journeyName: string
  /** which stage this page is */
  stage: 'build' | 'test-publish' | 'approve'
  /** Test Publish: has a test run completed at least once? decides whether "Test Publish" shows done or current */
  testDone?: boolean
  /** Approve's own state once a decision has been made; on the Test Publish page it defaults from testDone */
  approveState?: StageState
  /** the journey is live (ACTIVE): every done step's tick turns green */
  live?: boolean
  /** the right-hand slot: the page's own status and actions */
  actions?: ReactNode
}

export function StageBar({ journeyName, stage, testDone = false, approveState, live = false, actions }: StageBarProps) {
  const stages: { key: string; label: string; state: StageState }[] = [
    { key: 'setup', label: 'Setup', state: 'done' },
    { key: 'build', label: 'Build', state: stage === 'build' ? 'current' : 'done' },
    {
      key: 'test',
      label: 'Test Publish',
      state: stage === 'build' ? 'locked' : stage === 'test-publish' ? (testDone ? 'done' : 'current') : 'done',
    },
    { key: 'approve', label: 'Approve', state: approveState ?? (stage === 'test-publish' && testDone ? 'current' : 'locked') },
  ]
  const found = stages.findIndex((item) => item.state === 'current' || item.state === 'scheduled')
  const currentIndex = found === -1 ? stages.length - 1 : found
  return (
    <div data-stage-bar className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 border-b border-line bg-surface px-5 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <Link to="/journeys" aria-label="Back to Journeys" title="Back to Journeys"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control-md text-ink-800 hover:bg-surface-hover hover:text-ink-900">
          <ArrowLeft size={16} strokeWidth={1.5} aria-hidden />
        </Link>
        <p className="min-w-0 truncate text-sm font-semibold text-ink-900" title={journeyName}>{journeyName}</p>
      </div>
      {/* below 1100px the full stepper runs under the right-hand actions: show where you are instead */}
      <p className="text-sm whitespace-nowrap text-ink-800 min-[1100px]:hidden">
        Step {currentIndex + 1} of {stages.length} · <span className="font-semibold text-ink-900">{stages[currentIndex].label}</span>
      </p>
      <nav aria-label="Journey Stages" className="hidden min-[1100px]:block">
        <ol className="flex items-center gap-2">
          {stages.map((item, index) => (
            <li key={item.key} className="flex items-center gap-2">
              {index > 0 && <span aria-hidden className="h-px w-6 bg-line" />}
              <StageStep number={index + 1} label={item.label} state={item.state} live={live} />
            </li>
          ))}
        </ol>
      </nav>
      <div className="flex min-w-0 items-center justify-end gap-3">{actions}</div>
    </div>
  )
}

function StageStep({ number, label, state, live }: { number: number; label: string; state: StageState; live: boolean }) {
  const circle =
    state === 'done' ? (live ? 'border-success bg-success text-on-brand' : 'border-brand-600 bg-brand-600 text-on-brand')
    : state === 'current' ? 'border-link bg-brand-100 text-brand-800'
    : state === 'scheduled' ? 'border-warning bg-warning-bg text-warning-text'
    : 'border-line bg-surface text-ink-300'
  const text = state === 'current' ? 'font-semibold text-ink-900' : state === 'locked' ? 'text-ink-300' : 'text-ink-800'
  return (
    <span className="flex items-center gap-2" aria-current={state === 'current' ? 'step' : undefined}>
      <span className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold ${state === 'current' ? 'ring-1 ring-focus' : ''} ${circle}`} aria-hidden>
        {state === 'done' ? <Check size={14} strokeWidth={2} /> : state === 'scheduled' ? <Clock size={12} strokeWidth={1.5} /> : number}
      </span>
      <span className={`text-sm whitespace-nowrap ${text}`}>{label}</span>
    </span>
  )
}
