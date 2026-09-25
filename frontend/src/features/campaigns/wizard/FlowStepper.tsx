/**
 * The setup's steps across the top: numbered circles joined by lines, a Blue 600 tick for a step that's done, the
 * current one ringed. A step that was reached can be revisited; the ones ahead open through Continue. Every step keeps
 * its name; while the flow bar is under 1340px wide (it narrows with the global nav open) the connectors, gaps and
 * type get smaller so the four names still fit. Under xl it folds into "Step 2 of 4 · Content", which opens a menu of
 * the same steps, with a progress bar.
 */
import { Check, ChevronDown } from 'lucide-react'
import { useId, useRef, useState } from 'react'

import { MenuRow } from '@/components/MenuRow'
import { Popover } from '@/components/Popover'

export interface StepperProps {
  steps: readonly string[]
  current: number
  /** the furthest step that can be opened */
  reached: number
  /** how many steps are done */
  completed: number
  onGo: (index: number) => void
}

type StepState = 'done' | 'current' | 'ahead'

const stateOf = (index: number, current: number, completed: number): StepState => (index === current ? 'current' : index < completed ? 'done' : 'ahead')

const CIRCLE: Record<StepState, string> = {
  done: 'border-brand-600 bg-brand-600 text-white',
  current: 'border-brand-600 bg-brand-100 text-brand-800',
  ahead: 'border-line bg-surface text-ink-300',
}

function StepCircle({ state, number, small = false }: { state: StepState; number: number; small?: boolean }) {
  return (
    <span aria-hidden data-marker={state}
      className={`flex shrink-0 items-center justify-center rounded-full border-[1.5px] font-semibold ${small ? 'h-5 w-5 text-xs' : 'h-6 w-6 text-helper'} ${CIRCLE[state]}`}>
      {state === 'done' ? <Check size={small ? 12 : 14} strokeWidth={2.5} /> : number}
    </span>
  )
}

/** a short label under its trigger on hover or keyboard focus, only where `show` applies; screen readers get the name from the trigger */
export function HoverTip({ label, show }: { label: string; show: string }) {
  return (
    <span aria-hidden data-tooltip
      className={`pointer-events-none absolute top-full left-1/2 z-30 mt-2 hidden -translate-x-1/2 rounded-sm bg-ink-900 px-2 py-1 text-xs font-medium whitespace-nowrap text-white ${show}`}>
      {label}
    </span>
  )
}

const LABEL: Record<StepState, string> = { done: 'text-ink-700', current: 'font-semibold text-ink-900', ahead: 'text-ink-500' }

export function FlowStepper({ steps, current, reached, completed, onGo }: StepperProps) {
  return (
    <nav aria-label="Setup Steps">
      <ol className="flex items-center">
        {steps.map((label, index) => {
          const state = stateOf(index, current, completed)
          const done = index < completed
          return (
            <li key={label} className="flex shrink-0 items-center">
              {index > 0 && <span aria-hidden data-connector className="mx-4 h-px w-14 shrink-0 bg-line-subtle @max-[1339px]:mx-2 @max-[1339px]:w-5" />}
              <button type="button" disabled={index > reached} aria-current={state === 'current' ? 'step' : undefined} onClick={() => onGo(index)}
                className="group relative flex items-center gap-3 rounded-control-md px-2 py-1 whitespace-nowrap transition-colors duration-fast ease-standard enabled:hover:bg-surface-subtle disabled:cursor-default @max-[1339px]:gap-2 @max-[1339px]:px-1">
                <StepCircle state={state} number={index + 1} />
                <span data-step-label className={`text-card-title @max-[1339px]:text-sm ${LABEL[state]}`}>{label}</span>
                {done && <span className="sr-only">, completed</span>}
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/** under xl: one line that opens a menu of the steps */
export function FlowStepMenu({ steps, current, reached, completed, onGo }: StepperProps) {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const pick = (index: number) => {
    setOpen(false)
    onGo(index)
    trigger.current?.focus()
  }
  return (
    <div className="relative">
      <button ref={trigger} type="button" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen(!open)}
        onKeyDown={(event) => { if (event.key === 'Escape' && open) { event.preventDefault(); setOpen(false) } }}
        className="flex items-center gap-1.5 rounded-control-sm px-1.5 py-1 text-helper font-semibold text-ink-900 hover:bg-surface-subtle">
        Step {current + 1} of {steps.length} · {steps[current]}
        <ChevronDown size={16} strokeWidth={1.5} aria-hidden className="shrink-0 text-ink-500" />
      </button>
      {open && (
        <Popover id={menuId} label="Setup Steps" width={240} placement="bottom-start"
          onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus() } }}>
          {steps.map((label, index) => (
            <MenuRow key={label} divider={false} title={label} disabled={index > reached} selected={index === current}
              leading={<StepCircle state={stateOf(index, current, completed)} number={index + 1} small />} onClick={() => pick(index)} />
          ))}
        </Popover>
      )}
    </div>
  )
}

/** the 4px bar under the top bar on narrow screens */
export function FlowProgress({ current, total }: { current: number; total: number }) {
  return (
    <div role="progressbar" aria-label="Setup progress" aria-valuemin={1} aria-valuemax={total} aria-valuenow={current + 1} className="h-1 w-full bg-line">
      <div className="h-full rounded-r-xs bg-brand-600" style={{ width: `${((current + 1) / total) * 100}%` }} />
    </div>
  )
}
