import { Check } from 'lucide-react'

interface StepperProps {
  steps: readonly string[]
  /** 0-based index of the current step */
  current: number
  label?: string
}

/**
 * A pop-up's progress: equal segments, each a 4px pill bar with its name under it. Done segments keep a brand bar and a
 * check before the name, the current one is bold and marked aria-current="step", upcoming ones sit on a hairline bar.
 */
export function Stepper({ steps, current, label = 'Progress' }: StepperProps) {
  return (
    <ol aria-label={label} className="m-0 flex list-none gap-2 p-0">
      {steps.map((step, index) => {
        const done = index < current
        const now = index === current
        return (
          <li key={step} aria-current={now ? 'step' : undefined} className="flex flex-1 flex-col gap-2" data-step-state={done ? 'done' : now ? 'current' : 'ahead'}>
            <span aria-hidden className={`h-1 rounded-pill ${done || now ? 'bg-brand-600' : 'bg-line-subtle'}`} />
            <span className={`flex items-center gap-1 text-xs ${now ? 'font-semibold text-ink-900' : 'text-ink-800'}`}>
              {done && <Check size={12} strokeWidth={2} aria-hidden />}
              {step}
              {done && <span className="sr-only">, done</span>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
