/** Form primitives: a labelled field with hint + error wiring, and consistently styled controls. */
import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'

const CONTROL =
  'mt-1 w-full rounded-lg border bg-surface px-3 py-2 text-sm text-ink-900 disabled:bg-slate-50 disabled:text-ink-500'

const border = (invalid: boolean) => (invalid ? 'border-red-400' : 'border-line')

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
        {required && <span className="ml-0.5 text-red-600" aria-hidden>*</span>}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint && !error && (
        <p id={hintId} className="mt-1 text-xs text-ink-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-xs font-medium text-red-700">
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
  return <textarea {...props} aria-invalid={invalid || undefined} aria-describedby={describedBy} className={`${CONTROL} ${border(invalid)} ${className}`} />
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
    <fieldset className="rounded-xl border border-line bg-surface p-5">
      <legend className="px-1 text-sm font-semibold text-ink-900">{title}</legend>
      {description && <p className="mb-4 text-sm text-ink-500">{description}</p>}
      <div className="grid gap-4 md:grid-cols-2">{children}</div>
    </fieldset>
  )
}

export const buttonPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60'
export const buttonSecondary =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-ink-700 hover:bg-slate-50 disabled:opacity-60'
export const buttonDanger =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-surface px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60'
