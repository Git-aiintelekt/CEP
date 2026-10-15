import { StatusBadge } from '@/components/StatusBadge'

/** A template's status on the Templates page, in the campaign status colours: Active with the live dot, Draft sand, Archived dashed. */
export function StatusTag({ status }: { status: string }) {
  return <StatusBadge status={status} />
}
