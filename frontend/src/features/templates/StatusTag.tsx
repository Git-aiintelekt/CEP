import { titleize } from '@/lib/format'

const TONE: Record<string, string> = { ACTIVE: 'bg-success-bg text-success-text', DRAFT: 'bg-draft-bg text-draft-text' }

/** A template's status on the Templates page, in the campaign status colours: Active green with the live dot, Draft orange, Archived grey. */
export function StatusTag({ status }: { status: string }) {
  return (
    <span className={`inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-sm px-2 text-xs font-semibold whitespace-nowrap ${TONE[status] ?? 'bg-line-subtle text-ink-700'}`}>
      {status === 'ACTIVE' && <span aria-hidden data-live-dot className="h-1.5 w-1.5 rounded-full bg-success" />}
      {titleize(status)}
    </span>
  )
}
