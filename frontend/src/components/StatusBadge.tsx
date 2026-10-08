import type { LucideIcon } from 'lucide-react'

import { titleize } from '@/lib/format'

import { statusColours } from './statusColours'

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
    <span className={`inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-sm px-2 text-xs font-medium whitespace-nowrap ${statusColours(status)}`}>
      {LIVE.has(status) && <span aria-hidden data-live-dot className="h-1.5 w-1.5 shrink-0 rounded-full bg-tag-active-dot" />}
      {labelFor(status, label)}
    </span>
  )
}

export type TagTone = 'neutral' | 'success' | 'warning' | 'error' | 'brand'

const TAG_TONE: Record<TagTone, string> = {
  neutral: 'bg-fill-subtle text-ink-800',
  success: 'bg-success-bg text-success-text',
  warning: 'bg-warning-bg text-warning-text',
  error: 'bg-danger-bg text-danger-text',
  // brand is for merge-field tokens only, never a status
  brand: 'bg-brand-100 text-brand-800',
}

export function Tag({ children, tone = 'neutral', icon: Icon }: { children: string; tone?: TagTone; icon?: LucideIcon }) {
  return (
    <span className={`inline-flex h-[22px] shrink-0 items-center gap-1 rounded-sm px-2 text-xs font-medium whitespace-nowrap ${TAG_TONE[tone]}`}>
      {Icon && <Icon size={12} strokeWidth={1.5} aria-hidden />}
      {children}
    </span>
  )
}
