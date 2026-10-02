/** Form primitives: a labelled field with hint + error wiring, and consistently styled controls. */
import { CircleAlert } from 'lucide-react'
import { useId, type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'

import { formatNumber } from '@/lib/format'
import { limitTone, type Limit } from '@/lib/fieldRules'

import { CONTROL_BASE, FILL, borderClass, controlClass, type ControlSize, type ControlTone } from './controlStyles'

interface FieldProps {
  label: string
  /** 14px semibold Gray 900 label, and the error led by a 16px alert icon (the campaign setup pop-up) */
  strong?: boolean
  /** at the end of the label row: a counter such as "12 / 2,000" */
  labelEnd?: ReactNode
  /** the length counter, from the field's rule: grey, amber in the last 10%, red at the limit */
  limit?: Limit
  hint?: string
  error?: string
  required?: boolean
  /** receives the ids to put on the control */
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode
}

export function Field({ label, hint, error, required, strong = false, labelEnd, limit, children }: FieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined

  const labelText = (
    <label htmlFor={id} className={strong ? 'block text-sm font-semibold text-ink-900' : 'block text-sm font-medium text-ink-800'}>
      {label}
      {required && <span className="ml-0.5 text-danger-plain" aria-hidden>*</span>}
    </label>
  )

  const counter = limit && limit.max !== null ? <Counter {...limit} /> : null
  const end = labelEnd && counter ? <span className="flex items-baseline gap-3">{labelEnd}{counter}</span> : (labelEnd ?? counter)
  return (
    <div>
      {end ? <div className="flex items-baseline justify-between gap-3">{labelText}{end}</div> : labelText}
      {strong ? <div className="mt-1.5">{children({ id, describedBy, invalid: Boolean(error) })}</div> : children({ id, describedBy, invalid: Boolean(error) })}
      {hint && !error && (
        <p id={hintId} className={strong ? 'mt-1.5 text-helper text-ink-800' : 'mt-1 text-xs text-ink-800'}>
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className={strong ? 'mt-1.5 flex items-start gap-1.5 text-helper font-medium text-danger-text' : 'mt-1 text-xs font-medium text-danger-text'}>
          {strong && <CircleAlert size={16} strokeWidth={1.5} aria-hidden className="mt-px shrink-0" />}
          {error}
        </p>
      )}
    </div>
  )
}

const COUNTER_TONE = { quiet: 'text-ink-800', warn: 'text-warning-text', over: 'text-danger-text font-semibold' } as const

/** "42 / 200" at the end of a label row. Reads as "42 of 200 characters" to a screen reader; nothing when the limit is unknown. */
export function Counter({ used, max, soft }: Limit) {
  if (max === null) return null
  const ceiling = soft ?? max
  const tone = limitTone({ used, max, soft })
  return (
    <span className={`cep-num shrink-0 text-xs font-medium ${COUNTER_TONE[tone]}`} aria-label={`${formatNumber(used)} of ${formatNumber(ceiling)} characters`} aria-live={tone === 'quiet' ? undefined : 'polite'}>
      {formatNumber(used)} / {formatNumber(ceiling)}
    </span>
  )
}

type Wired = { invalid?: boolean; describedBy?: string }
/** `size` is taken by the native attribute, hence controlSize */
type Styled = { controlSize?: ControlSize; tone?: ControlTone; warning?: boolean }

export function TextInput({ invalid = false, warning = false, describedBy, controlSize, tone, className = '', ...props }: InputHTMLAttributes<HTMLInputElement> & Wired & Styled & { ref?: Ref<HTMLInputElement> }) {
  return (
    <input
      {...props}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      className={`${controlClass({ size: controlSize, tone, invalid, warning })} ${className}`}
    />
  )
}

export function TextArea({ invalid = false, warning = false, describedBy, tone, className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & Wired & Omit<Styled, 'controlSize'>) {
  return (
    <textarea
      {...props}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      className={`${CONTROL_BASE} mt-1 rounded-control-lg px-3 py-2 ${FILL[tone ?? 'default']} ${borderClass(invalid, warning)} ${className}`}
    />
  )
}

export function Select({ invalid = false, warning = false, describedBy, controlSize, tone, className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & Wired & Styled) {
  return (
    <select
      {...props}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      className={`${controlClass({ size: controlSize, tone, invalid, warning })} ${className}`}
    >
      {children}
    </select>
  )
}

export function FormSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <fieldset className="rounded-lg border border-line bg-surface p-5">
      <legend className="px-1 text-sm font-semibold text-ink-900">{title}</legend>
      {description && <p className="mb-4 text-sm text-ink-800">{description}</p>}
      <div className="grid gap-4 lg:grid-cols-2">{children}</div>
    </fieldset>
  )
}

// Class-string aliases for pages that style a link or plain button; new code uses <Button>.
// Literals so fast refresh keeps working; a test holds them equal to buttonClass().
export const buttonPrimary =
  'inline-flex shrink-0 items-center justify-center gap-2 text-sm font-semibold whitespace-nowrap transition-colors duration-fast ease-standard h-10 px-4 rounded-control-lg bg-brand-600 text-white hover:bg-brand-800 active:bg-brand-800 disabled:cursor-not-allowed disabled:bg-fill-subtle disabled:text-ink-300'
export const buttonSecondary =
  'inline-flex shrink-0 items-center justify-center gap-2 text-sm font-semibold whitespace-nowrap transition-colors duration-fast ease-standard h-10 px-4 rounded-control-lg border border-brand-600 bg-surface text-brand-600 hover:border-brand-800 hover:bg-brand-100 hover:text-brand-800 active:border-brand-800 active:bg-brand-100 active:text-brand-800 disabled:cursor-not-allowed disabled:border-line disabled:bg-fill-subtle disabled:text-ink-300'
export const buttonDanger =
  'inline-flex shrink-0 items-center justify-center gap-2 text-sm font-semibold whitespace-nowrap transition-colors duration-fast ease-standard h-10 px-4 rounded-control-lg border border-danger bg-surface text-danger-text hover:bg-danger-bg active:bg-danger-bg disabled:cursor-not-allowed disabled:border-line disabled:bg-fill-subtle disabled:text-ink-300'
