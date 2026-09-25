import type { LucideIcon } from 'lucide-react'

import { titleize } from '@/lib/format'

/**
 * Status is a solid light tint with matching text, at the design's 22px. Only live statuses, the ones going out now,
 * carry the green dot; the rest have none (the design overrides the design system there). Draft is orange; Scheduled is blue, the one approved exception to "status tags never blue"
 * (2026-09-24); the rest follow severity: green done or live, amber held back, red stopped, grey archived.
 */
type Tone = 'success' | 'warning' | 'danger' | 'pending' | 'neutral' | 'brand' | 'draft'

const TONES: Record<Tone, string> = {
  success: 'bg-success-bg text-success-text',
  warning: 'bg-warning-bg text-warning-text',
  danger: 'bg-danger-bg text-danger-text',
  pending: 'bg-line-subtle text-ink-900',
  neutral: 'bg-line-subtle text-ink-700',
  brand: 'bg-brand-100 text-brand-800',
  draft: 'bg-draft-bg text-draft-text',
}

const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: 'success',
  PRODUCTION: 'success', // contact list type
  TEST: 'warning',
  COMPLETED: 'success',
  PRODUCTION_PUBLISHED: 'success',
  SENDING: 'pending',
  PREPARING: 'pending',
  SCHEDULED: 'brand',
  TEST_PUBLISHED: 'warning',
  PAUSED: 'warning',
  DRAFT: 'draft',
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
  const plain = titleize(status)
  const isPlainWording = !label || label.toLowerCase() === plain.toLowerCase()
  if (isPlainWording && LOCKED_LABEL[status]) return LOCKED_LABEL[status]
  return label ?? plain
}

const LIVE = new Set(['ACTIVE', 'SENDING', 'PREPARING'])

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <span className={`inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-sm px-2 text-xs font-semibold whitespace-nowrap ${TONES[STATUS_TONE[status] ?? 'neutral']}`}>
      {LIVE.has(status) && <span aria-hidden data-live-dot className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />}
      {labelFor(status, label)}
    </span>
  )
}

export type TagTone = 'neutral' | 'success' | 'warning' | 'error' | 'brand'

const TAG_TONE: Record<TagTone, string> = {
  neutral: 'bg-line-subtle text-ink-700',
  success: 'bg-success-bg text-success-text',
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
