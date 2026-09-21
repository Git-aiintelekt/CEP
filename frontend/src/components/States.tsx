import type { ReactNode } from 'react'

import { Inbox } from 'lucide-react'

import { ApiError } from '@/lib/api'

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block animate-spin rounded-full border-2 border-ink-300 border-t-brand-600 ${className}`}
    />
  )
}

export function FullPageSpinner({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-screen items-center justify-center gap-3 text-sm text-ink-500">
      <Spinner /> {label}
    </div>
  )
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-6 py-14 text-center">
      <span aria-hidden className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-line-subtle text-ink-700">
        <Inbox size={24} strokeWidth={1.5} />
      </span>
      <p className="text-sm font-medium text-ink-900">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-md text-sm text-ink-500">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry, title }: { error: unknown; onRetry?: () => void; title?: string }) {
  const forbidden = error instanceof ApiError && error.status === 403
  const fieldErrors = error instanceof ApiError ? Object.entries(error.fieldErrors) : []
  const message = fieldErrors.length > 0 ? 'Fix the following first:' : error instanceof Error ? error.message : 'The request did not complete. Try again in a moment.'
  return (
    <div role="alert" className="rounded-lg border border-danger bg-danger-bg px-5 py-4 text-sm text-danger-text">
      <p className="font-medium">{title ?? (forbidden ? 'You do not have permission to do this' : 'Could not load this data')}</p>
      <p className="mt-1 text-danger-text">{message}</p>
      {fieldErrors.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-danger-text">
          {fieldErrors.map(([field, text]) => (
            <li key={field}>{text}</li>
          ))}
        </ul>
      )}
      {onRetry && !forbidden && (
        <button type="button" onClick={onRetry} className="mt-3 font-medium underline underline-offset-2">
          Try again
        </button>
      )}
    </div>
  )
}
