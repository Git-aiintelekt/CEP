import { humanize } from '@/lib/format'

/** A template's status on the Templates page: Active is green; Draft and Archived share the grey treatment. Never blue. */
export function StatusTag({ status }: { status: string }) {
  const active = status === 'ACTIVE'
  return (
    <span className={`inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-sm px-2 text-xs font-semibold whitespace-nowrap ${active ? 'bg-success-bg text-success-text' : 'bg-line-subtle text-ink-700'}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-success' : 'bg-ink-300'}`} />
      {humanize(status)}
    </span>
  )
}
