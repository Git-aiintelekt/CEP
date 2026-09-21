import type { LucideIcon } from 'lucide-react'

import { humanize } from '@/lib/format'

/**
 * Status is a solid light tint with matching text, at the design's 22px. The dot the design system asks for is
 * not in the design: see the "design overrides design system" list.
 */
type Tone = 'success' | 'warning' | 'danger' | 'pending' | 'neutral' | 'brand'

const TONES: Record<Tone, string> = {
  success: 'bg-success-bg text-success-text',
  warning: 'bg-warning-bg text-warning-text',
  danger: 'bg-danger-bg text-danger-text',
  pending: 'bg-line-subtle text-ink-900',
  neutral: 'bg-line-subtle text-ink-700',
  brand: 'bg-brand-100 text-brand-800',
}

const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: 'success',
  COMPLETED: 'success',
  PRODUCTION_PUBLISHED: 'success',
  SENDING: 'pending',
  PREPARING: 'pending',
  SCHEDULED: 'pending',
  TEST_PUBLISHED: 'warning',
  PAUSED: 'warning',
  DRAFT: 'brand',
  ARCHIVED: 'neutral',
  CANCELLED: 'danger',
  FAILED: 'danger',
}

/** The campaign status vocabulary is locked; these spellings win over whatever wording the API sends. */
const LOCKED_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  TEST_PUBLISHED: 'Test Published',
  PRODUCTION_PUBLISHED: 'Production Published',
  SCHEDULED: 'Scheduled',
}

function labelFor(status: string, label?: string): string {
  const plain = humanize(status)
  const isPlainWording = !label || label.toLowerCase() === plain.toLowerCase()
  if (isPlainWording && LOCKED_LABEL[status]) return LOCKED_LABEL[status]
  return label ?? plain
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <span className={`inline-flex h-[22px] shrink-0 items-center rounded-sm px-2 text-xs font-semibold whitespace-nowrap ${TONES[STATUS_TONE[status] ?? 'neutral']}`}>
      {labelFor(status, label)}
    </span>
  )
}

export type TagTone = 'neutral' | 'warning' | 'error' | 'brand'

const TAG_TONE: Record<TagTone, string> = {
  neutral: 'bg-line-subtle text-ink-700',
  warning: 'bg-warning-bg text-warning-text',
  error: 'bg-danger-bg text-danger-text',
  // brand is for merge-field tokens only, never a status
  brand: 'bg-brand-100 text-brand-800',
}

export function Tag({ children, tone = 'neutral', icon: Icon }: { children: string; tone?: TagTone; icon?: LucideIcon }) {
  return (
    <span className={`inline-flex h-[22px] shrink-0 items-center gap-1 rounded-sm px-2 text-xs font-semibold whitespace-nowrap ${TAG_TONE[tone]}`}>
      {Icon && <Icon size={12} strokeWidth={1.5} aria-hidden />}
      {children}
    </span>
  )
}
