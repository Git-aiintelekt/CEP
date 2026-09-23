/** Form primitives: a labelled field with hint + error wiring, and consistently styled controls. */
import { useId, type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'

import { CONTROL_BASE, FILL, borderClass, controlClass, type ControlSize, type ControlTone } from './controlStyles'

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
      className={`${CONTROL_BASE} mt-1 px-3 py-2 ${FILL[tone ?? 'default']} ${borderClass(invalid, warning)} ${className}`}
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
      {description && <p className="mb-4 text-sm text-ink-500">{description}</p>}
      <div className="grid gap-4 lg:grid-cols-2">{children}</div>
    </fieldset>
  )
}

// Class-string aliases for pages that style a link or plain button; new code uses <Button>.
// Literals so fast refresh keeps working; a test holds them equal to buttonClass().
export const buttonPrimary =
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-sm text-sm font-semibold whitespace-nowrap transition-colors duration-fast ease-standard h-10 px-4 bg-brand-600 text-white hover:bg-brand-800 active:bg-brand-800 disabled:cursor-not-allowed disabled:bg-line-subtle disabled:text-ink-300'
export const buttonSecondary =
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-sm text-sm font-semibold whitespace-nowrap transition-colors duration-fast ease-standard h-10 px-4 border border-line bg-surface text-ink-900 hover:bg-surface-subtle active:bg-line-subtle disabled:cursor-not-allowed disabled:border-line disabled:bg-line-subtle disabled:text-ink-300'
export const buttonDanger =
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-sm text-sm font-semibold whitespace-nowrap transition-colors duration-fast ease-standard h-10 px-4 border border-danger bg-surface text-danger-text hover:bg-danger-bg active:bg-danger-bg disabled:cursor-not-allowed disabled:border-line disabled:bg-line-subtle disabled:text-ink-300'
