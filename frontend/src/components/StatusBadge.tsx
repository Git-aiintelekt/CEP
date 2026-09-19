import { humanize } from '@/lib/format'

/**
 * Status is carried by a solid light tint plus a 6px dot. Status never uses the action blue, so a tag cannot be
 * mistaken for something clickable.
 */
type Tone = 'success' | 'warning' | 'danger' | 'pending' | 'neutral'

const TONES: Record<Tone, { tag: string; dot: string }> = {
  success: { tag: 'bg-line-subtle text-success-text', dot: 'bg-success' },
  warning: { tag: 'bg-warning-bg text-warning-text', dot: 'bg-warning' },
  danger: { tag: 'bg-danger-bg text-danger-text', dot: 'bg-danger' },
  pending: { tag: 'bg-line-subtle text-ink-900', dot: 'bg-ink-700' },
  neutral: { tag: 'bg-line-subtle text-ink-700', dot: 'bg-ink-300' },
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
  DRAFT: 'neutral',
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
  const tone = TONES[STATUS_TONE[status] ?? 'neutral']
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs font-semibold ${tone.tag}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      {labelFor(status, label)}
    </span>
  )
}

export function Tag({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center rounded-sm bg-line-subtle px-1.5 py-0.5 text-xs font-semibold text-ink-700">
      {children}
    </span>
  )
}
