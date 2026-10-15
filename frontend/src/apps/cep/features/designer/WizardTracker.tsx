/** Where this template sits in the campaign wizard. Completed steps go back; later steps are shown but unreachable. */
import { Check } from 'lucide-react'
import { Link } from 'react-router-dom'

export interface WizardStep {
  label: string
  href?: string
}

export interface WizardTrackerProps {
  steps: WizardStep[]
  currentIndex: number
}

// eslint-disable-next-line react-refresh/only-export-components
export const WIZARD_STEPS: WizardStep[] = [
  { label: 'Audience' },
  { label: 'Template' },
  { label: 'Targets' },
  { label: 'Test and Publish' },
]

export function WizardTracker({ steps, currentIndex }: WizardTrackerProps) {
  return (
    <nav aria-label="Campaign Steps">
      <ol className="flex items-center gap-2">
        {steps.map((step, index) => {
          const done = index < currentIndex
          const current = index === currentIndex
          return (
            <li key={step.label} className="flex min-w-0 items-center gap-2">
              {index > 0 && <span aria-hidden className="h-px w-6 shrink-0 bg-fill-muted" />}
              {done && step.href ? (
                <Link to={step.href} className="flex items-center gap-1.5 text-xs font-medium text-ink-800 transition-colors duration-base ease-standard hover:text-ink-900">
                  <Dot done />
                  {step.label}
                </Link>
              ) : (
                <span
                  aria-current={current ? 'step' : undefined}
                  aria-disabled={!current && !done ? true : undefined}
                  className={`flex items-center gap-1.5 text-xs font-medium ${current ? 'text-ink-900' : done ? 'text-ink-800' : 'text-ink-300'}`}
                >
                  <Dot done={done} current={current} />
                  {step.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

function Dot({ done = false, current = false }: { done?: boolean; current?: boolean }) {
  if (done) {
    return (
      <span aria-hidden className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-line text-ink-800">
        <Check size={10} strokeWidth={1.5} />
      </span>
    )
  }
  return <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${current ? 'bg-brand-600' : 'bg-ink-300'}`} />
}
