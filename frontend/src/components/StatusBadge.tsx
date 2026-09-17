import { humanize } from '@/lib/format'

type Tone = 'green' | 'blue' | 'amber' | 'gray' | 'red'

const TONES: Record<Tone, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  blue: 'bg-brand-50 text-brand-700 ring-brand-600/20',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  gray: 'bg-slate-100 text-slate-700 ring-slate-500/20',
  red: 'bg-red-50 text-red-700 ring-red-600/20',
}

const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: 'green',
  COMPLETED: 'green',
  PRODUCTION_PUBLISHED: 'blue',
  SENDING: 'blue',
  SCHEDULED: 'blue',
  TEST_PUBLISHED: 'amber',
  PAUSED: 'amber',
  DRAFT: 'gray',
  ARCHIVED: 'gray',
  CANCELLED: 'red',
  FAILED: 'red',
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const tone = STATUS_TONE[status] ?? 'gray'
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>
      {label ?? humanize(status)}
    </span>
  )
}

export function Tag({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-ink-700">
      {children}
    </span>
  )
}
