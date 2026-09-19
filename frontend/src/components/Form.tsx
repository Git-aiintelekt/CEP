/** Form primitives: a labelled field with hint + error wiring, and consistently styled controls. */
import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'

const CONTROL_BASE =
  'mt-1 w-full rounded-sm border bg-surface px-3 text-sm text-ink-900 transition-colors focus-visible:border-brand-600 disabled:border-line disabled:bg-line-subtle disabled:text-ink-300'
const CONTROL = `${CONTROL_BASE} h-10`
const CONTROL_MULTILINE = `${CONTROL_BASE} py-2`

const border = (invalid: boolean) => (invalid ? 'border-danger' : 'border-line')

interface FieldProps {
  label: string
  hint?: string
  error?: string
  required?: boolean
  /** receives the ids to put on the control */
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode
}

export function Field({ label, hint, error, required, children }: FieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink-700">
        {label}
        {required && <span className="ml-0.5 text-danger-plain" aria-hidden>*</span>}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint && !error && (
        <p id={hintId} className="mt-1 text-xs text-ink-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-xs font-medium text-danger-text">
          {error}
        </p>
      )}
    </div>
  )
}

type Wired = { invalid?: boolean; describedBy?: string }

export function TextInput({ invalid = false, describedBy, className = '', ...props }: InputHTMLAttributes<HTMLInputElement> & Wired) {
  return <input {...props} aria-invalid={invalid || undefined} aria-describedby={describedBy} className={`${CONTROL} ${border(invalid)} ${className}`} />
}

export function TextArea({ invalid = false, describedBy, className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & Wired) {
  return <textarea {...props} aria-invalid={invalid || undefined} aria-describedby={describedBy} className={`${CONTROL_MULTILINE} ${border(invalid)} ${className}`} />
}

export function Select({ invalid = false, describedBy, className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & Wired) {
  return (
    <select {...props} aria-invalid={invalid || undefined} aria-describedby={describedBy} className={`${CONTROL} ${border(invalid)} ${className}`}>
      {children}
    </select>
  )
}

export function FormSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <fieldset className="rounded-lg border border-line bg-surface p-5">
      <legend className="px-1 text-sm font-semibold text-ink-900">{title}</legend>
      {description && <p className="mb-4 text-sm text-ink-500">{description}</p>}
      <div className="grid gap-4 lg:grid-cols-2">{children}</div>
    </fieldset>
  )
}

export const buttonPrimary =
  'inline-flex h-10 items-center justify-center gap-2 rounded-sm bg-brand-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-800 disabled:bg-line-subtle disabled:text-ink-300'
export const buttonSecondary =
  'inline-flex h-10 items-center justify-center gap-2 rounded-sm border border-line bg-surface px-4 text-sm font-medium text-ink-700 transition-colors hover:bg-surface-subtle disabled:border-line disabled:bg-line-subtle disabled:text-ink-300'
export const buttonDanger =
  'inline-flex h-10 items-center justify-center gap-2 rounded-sm border border-danger bg-surface px-4 text-sm font-medium text-danger-text transition-colors hover:bg-danger-bg disabled:border-line disabled:bg-line-subtle disabled:text-ink-300'
