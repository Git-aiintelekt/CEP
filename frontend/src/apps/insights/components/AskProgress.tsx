/**
 * The steps of a prompt while Ask for a Report builds the report (docs/mockups/ask-for-report-name-and-progress.html, option A):
 * each one ticked as it finishes, the one under way with the time taken so far, the ones still to come greyed, a step that failed
 * with its reason. The steps are the server's own (apps/insights/ask_progress.py), read every second while the box waits.
 */
import { Check, X } from 'lucide-react'

import { Spinner } from '@/components/States'
import type { AskStep } from '../types'

function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

export function AskProgress({ steps, elapsed, label = 'Building the report' }: { steps: AskStep[]; elapsed?: number; label?: string }) {
  return (
    <ol aria-label={label} className="flex flex-col gap-2 rounded-md border border-line-subtle bg-surface-subtle px-3 py-2.5 text-sm">
      {steps.map((step) => (
        <li key={step.key} className={`flex items-start gap-2.5 ${step.state === 'wait' ? 'text-ink-700' : 'text-ink-900'}`} aria-current={step.state === 'now' ? 'step' : undefined}>
          <span aria-hidden className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
            {step.state === 'done' ? <span className="flex h-4 w-4 items-center justify-center rounded-full bg-success-bg text-success-text"><Check size={11} strokeWidth={2.5} /></span>
              : step.state === 'failed' ? <span className="flex h-4 w-4 items-center justify-center rounded-full bg-danger-bg text-danger-text"><X size={11} strokeWidth={2.5} /></span>
              : step.state === 'now' ? <Spinner size="sm" />
              : <span className="h-3.5 w-3.5 rounded-full border border-line-control" />}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className={step.state === 'now' ? 'font-semibold' : ''}>
              <span className="sr-only">{{ done: 'Done: ', now: 'Under way: ', wait: 'Still to come: ', failed: 'Stopped: ' }[step.state]}</span>{step.label}
            </span>
            {step.detail && <span className={`text-xs ${step.state === 'failed' ? 'text-danger-text' : 'text-ink-800'}`}>{step.detail}</span>}
          </span>
          {step.state === 'now' && elapsed !== undefined && <span className="cep-num text-xs text-ink-800">{clock(elapsed)}</span>}
        </li>
      ))}
    </ol>
  )
}
