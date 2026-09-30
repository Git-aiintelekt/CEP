import type { ReactNode } from 'react'

import { Inbox, type LucideIcon } from 'lucide-react'

import { ApiError } from '@/lib/api'

type SpinnerSize = 'sm' | 'md' | 'lg'
type SpinnerTone = 'default' | 'onBrand'

const SPINNER_SIZE: Record<SpinnerSize, string> = { sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-7 w-7' }
const SPINNER_TONE: Record<SpinnerTone, string> = {
  default: 'border-ink-300 border-t-brand-600',
  onBrand: 'border-brand-800 border-t-white',
}

/**
 * A 700ms ring. `size` and `tone` are the API; a className that still sets its own height or border colours
 * replaces the matching defaults instead of stacking two conflicting utilities on one element.
 */
export function Spinner({ size, tone = 'default', label = 'Loading', className = '' }: { size?: SpinnerSize; tone?: SpinnerTone; label?: string; className?: string }) {
  const sizeClass = size ? SPINNER_SIZE[size] : /(^|\s)h-/.test(className) ? '' : SPINNER_SIZE.md
  const toneClass = /(^|\s)border-t-/.test(className) ? '' : SPINNER_TONE[tone]
  return <span role="status" aria-label={label} className={`inline-block shrink-0 animate-spin rounded-full border-2 ${sizeClass} ${toneClass} ${className}`} />
}

/**
 * A grey bar standing in for a value that is still on its way: flat Gray 100, no shimmer (the design is flat, and
 * reduced-motion users see the same). Vary `width` between neighbours so a column of them doesn't read as a grid.
 */
export function SkeletonLine({ width = '70%', height }: { width?: string; height?: number }) {
  return <span aria-hidden data-skeleton className="my-1 block h-3.5 rounded-sm bg-surface-sunken" style={{ width, height }} />
}

export function FullPageSpinner({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-screen flex-col items-center justify-center gap-3 bg-surface-subtle text-sm font-semibold text-ink-800">
      <Spinner size="lg" />
      {label}
    </div>
  )
}

interface EmptyStateProps {
  title: string
  hint?: string
  action?: ReactNode
  icon?: LucideIcon
  /** card: a bordered page block. plain: centred in whatever space it fills. compact: one line in a side panel, no icon */
  variant?: 'card' | 'plain' | 'compact'
  tone?: 'default' | 'error'
}

export function EmptyState({ title, hint, action, icon: Icon = Inbox, variant = 'card', tone = 'default' }: EmptyStateProps) {
  if (variant === 'compact') {
    return (
      <div className="px-3 py-3 text-sm text-ink-800">
        <p>{title}</p>
        {hint && <p className="mt-1 text-xs text-ink-800">{hint}</p>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    )
  }

  const frame = variant === 'card' ? 'rounded-lg border border-line bg-surface px-6 py-14' : 'flex h-full flex-col items-center justify-center p-6'
  return (
    <div className={`${frame} text-center`}>
      <span aria-hidden className={`mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-sm bg-fill-subtle ${tone === 'error' ? 'text-danger' : 'text-ink-800'}`}>
        <Icon size={24} strokeWidth={1.5} />
      </span>
      <p className="text-sm font-semibold text-ink-900">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-sm text-helper text-ink-800">{hint}</p>}
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
          Try Again
        </button>
      )}
    </div>
  )
}
