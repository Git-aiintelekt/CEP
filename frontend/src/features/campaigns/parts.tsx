/** Small building blocks the campaign screens share: choice cards, the step rail, panels, tiles and meters. */
import { Check } from 'lucide-react'
import type { ReactNode } from 'react'

import { formatNumber } from '@/lib/format'

/** One of a small set of options, shown as a card (the prototype's "Campaign type" and "Channel" pickers). Put them in a role="radiogroup". */
export function ChoiceCard({ selected, onSelect, title, text, icon, badge, disabled = false }: {
  selected: boolean; onSelect: () => void; title: string; text: string; icon?: ReactNode; badge?: string; disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={`flex h-full flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:bg-line-subtle disabled:text-ink-300 ${
        selected ? 'border-brand-600 bg-callout-bg' : 'border-line bg-surface hover:bg-surface-subtle'
      }`}
    >
      <span className="flex items-center gap-2 text-sm font-semibold text-ink-900">
        {icon && <span className={selected ? 'text-brand-600' : 'text-ink-700'}>{icon}</span>}
        {title}
      </span>
      <span className="text-xs text-ink-500">{text}</span>
      {badge && <span className="mt-1 rounded-sm bg-line-subtle px-1.5 py-0.5 text-[11px] font-semibold text-ink-700">{badge}</span>}
    </button>
  )
}

export function ChoiceGroup({ label, error, columns = 'sm:grid-cols-2', children }: { label: string; error?: string; columns?: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-sm font-medium text-ink-700">{label}</p>
      <div role="radiogroup" aria-label={label} className={`mt-1 grid gap-3 ${columns}`}>{children}</div>
      {error && <p className="mt-1 text-xs font-medium text-danger-text">{error}</p>}
    </div>
  )
}

/**
 * The seven steps. A step that was reached can be revisited; the ones ahead open through "Continue", so nothing is skipped unchecked.
 * `completed` is how many steps were gone through: those show a check whichever step is open, so the rail says where the setup stands.
 */
export function StepRail({ steps, current, reached, completed, onGo }: { steps: readonly string[]; current: number; reached: number; completed: number; onGo: (index: number) => void }) {
  return (
    <nav aria-label="Campaign setup steps">
      <ol className="flex flex-wrap gap-x-1 gap-y-2 lg:flex-col lg:gap-1">
        {steps.map((label, index) => {
          const done = index < completed
          const open = index <= reached
          return (
            <li key={label}>
              <button
                type="button"
                disabled={!open}
                aria-current={index === current ? 'step' : undefined}
                onClick={() => onGo(index)}
                className={`flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed ${
                  index === current ? 'bg-callout-bg font-semibold text-ink-900' : open ? 'text-ink-700 hover:bg-surface-subtle' : 'text-ink-300'
                }`}
              >
                <span
                  aria-hidden
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                    index === current ? 'border-brand-600 bg-brand-600 text-white' : done ? 'border-success bg-surface text-success-text' : 'border-line text-ink-500'
                  }`}
                >
                  {done ? <Check size={14} strokeWidth={2} /> : index + 1}
                </span>
                <span className="min-w-0 flex-1 whitespace-nowrap">{label}</span>
                {done && <span className="sr-only">, completed</span>}
                {done && index === current && <span aria-hidden className="hidden text-xs font-medium text-success-text lg:inline">Done</span>}
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export function Panel({ title, description, actions, children, className = '' }: { title?: string; description?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-line bg-surface p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-ink-900">{title}</h2>}
            {description && <p className="mt-0.5 max-w-2xl text-sm text-ink-500">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

export function StatTile({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <dt className="text-xs font-semibold text-ink-700">{label}</dt>
      <dd className="cep-num mt-1 font-display text-2xl font-semibold text-ink-900">{value}</dd>
      {note && <p className="mt-0.5 text-xs text-ink-500">{note}</p>}
    </div>
  )
}

/** Progress against a target. Past 100% the bar stays full and the number says by how much. */
export function Meter({ label, actual, target, percent, money = false }: { label: string; actual: number; target: number; percent: number; money?: boolean }) {
  const show = (value: number) => (money ? value.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) : formatNumber(value))
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium text-ink-900">{label}</span>
        <span className="cep-num text-ink-700">{show(actual)} of {show(target)} · {percent}%</span>
      </div>
      <div role="progressbar" aria-label={`${label} against target`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(percent))} className="mt-1.5 h-2 overflow-hidden rounded-full bg-line-subtle">
        <div className={`h-full rounded-full ${percent >= 100 ? 'bg-success' : 'bg-brand-600'}`} style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
    </div>
  )
}

export function Definition({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-ink-700">{label}</dt>
      <dd className="mt-1 text-sm text-ink-900">{children}</dd>
    </div>
  )
}

export function CheckRow({ id, checked, onChange, label, hint, disabled }: { id: string; checked: boolean; onChange: (value: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-600" aria-describedby={hint ? `${id}-hint` : undefined} />
      <div>
        <label htmlFor={id} className="text-sm font-medium text-ink-900">{label}</label>
        {hint && <p id={`${id}-hint`} className="text-xs text-ink-500">{hint}</p>}
      </div>
    </div>
  )
}
